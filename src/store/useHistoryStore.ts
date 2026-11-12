/**
 * 历史记录状态管理
 * 分析记录与录音音频持久化在 IndexedDB（绕开 localStorage 容量限制），
 * 音频以 Blob 单独存放、与分析记录同 id 关联。
 * 首次运行时自动迁移旧版 localStorage（svt:history:v1）中的记录。
 */

import { create } from 'zustand';
import { toast } from 'sonner';
import type { AnalysisRecord } from '@/types';
import { MAX_HISTORY } from '@/constants';
import { t } from '@/i18n';
import {
  idbGetAllRecords, idbPutRecord, idbPutRecords, idbClearRecords,
  idbGetAudio, idbPutAudio, idbClearAudio,
  idbGetAllTrash, idbMoveRecordToTrash, idbRestoreTrashBatch, idbPurgeTrash,
  idbDeleteTrash, idbClearTrash, type TrashedRecord,
} from '@/lib/storage/idb';

/** 回收站保留时长：30 天 */
export const TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 旧版 localStorage 键（v0.2 存储，首次运行迁移后移除） */
const LEGACY_KEY = 'svt:history:v1';
const MIGRATED_KEY = 'svt:idb-migrated';

let storageWarned = false;
function warnStorage() {
  if (storageWarned) return;
  storageWarned = true;
  toast.warning(t('toast.storageUnavailable'));
}

/** 将内存记录写库；返回是否成功，调用方可在失败时保留恢复草稿 */
function persist(fn: () => Promise<void>): Promise<boolean> {
  return fn().then(
    () => true,
    (err) => {
      console.error('历史记录写入失败:', err);
      warnStorage();
      return false;
    },
  );
}

interface HistoryState {
  records: AnalysisRecord[];
  /** 回收站（删除后保留 30 天，音频也保留） */
  trash: TrashedRecord<AnalysisRecord>[];
  /** 全量记录条数（含未进入内存视图的部分），用于列表截断提示 */
  totalCount: number;
  /** IDB 数据是否已加载完成 */
  ready: boolean;
  /** 应用启动时调用：加载数据 + 旧版迁移 */
  hydrate: () => Promise<void>;
  /** 新增一条记录（最新在数组头部），可附带音频 Blob；返回是否落库成功 */
  addRecord: (record: AnalysisRecord, audioBlob?: Blob) => Promise<boolean>;
  /** 删除一条记录（移入回收站，30 天后自动清理） */
  removeRecord: (id: string) => void;
  /** 从回收站恢复记录（音频仍在）；返回是否持久化成功 */
  restoreTrash: (ids: string[]) => Promise<boolean>;
  /** 永久删除回收站条目（连同音频）；返回是否持久化成功 */
  deleteTrashForever: (ids: string[]) => Promise<boolean>;
  /** 清空回收站；返回是否持久化成功 */
  clearTrash: () => Promise<boolean>;
  /** 清空全部（含音频与回收站） */
  clearAll: () => void;
  /** 更新一条记录（备注编辑等） */
  updateRecord: (record: AnalysisRecord) => void;
  /** 批量导入（按 id 去重合并，对 IDB 全量去重），返回实际导入条数 */
  importRecords: (incoming: AnalysisRecord[]) => Promise<number>;
  /** 读取某条记录的音频（无音频返回 null） */
  getAudio: (id: string) => Promise<Blob | null>;
  /**
   * 全量记录（导出/备份专用）。
   * 界面视图有 MAX_HISTORY 截断，IDB 中保留全部记录；
   * 备份必须走本方法，否则超出截断窗口的记录会被静默漏掉。
   * IDB 不可用时降级为内存记录。
   */
  getAllRecords: () => Promise<AnalysisRecord[]>;
}

/** 全量清空进行中：阻止回收站恢复/清理把刚清掉的数据又写回来 */
let historyClearing = false;

function dedupeSorted(records: AnalysisRecord[]): AnalysisRecord[] {
  const map = new Map(records.map((r) => [r.id, r]));
  return [...map.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_HISTORY);
}

export const useHistoryStore = create<HistoryState>()((set, get) => ({
  records: [],
  trash: [],
  totalCount: 0,
  ready: false,

  hydrate: async () => {
    let loaded: AnalysisRecord[] = [];
    try {
      loaded = await idbGetAllRecords<AnalysisRecord>();
    } catch (err) {
      console.error('IndexedDB 读取失败:', err);
      set({ ready: true, totalCount: get().records.length });
      return;
    }

    // 旧版 localStorage 迁移：一次性导入并移除旧键
    // （localStorage 在部分隐私模式下会抛异常，需整体兜底，不能让迁移失败阻断加载）
    try {
      if (loaded.length === 0 && !localStorage.getItem(MIGRATED_KEY)) {
        const raw = localStorage.getItem(LEGACY_KEY);
        const legacy = raw ? (JSON.parse(raw) as { state?: { records?: AnalysisRecord[] } }) : null;
        const legacyRecords = legacy?.state?.records;
        if (Array.isArray(legacyRecords) && legacyRecords.length > 0) {
          loaded = legacyRecords;
          await idbPutRecords(legacyRecords);
        }
      }
      localStorage.setItem(MIGRATED_KEY, '1');
      localStorage.removeItem(LEGACY_KEY);
    } catch (err) {
      console.error('旧数据迁移失败:', err);
    }

    // 回收站：读取后顺手清理超过 30 天的条目（连同音频）
    let trash: TrashedRecord<AnalysisRecord>[] = [];
    try {
      trash = await idbGetAllTrash<AnalysisRecord>();
    } catch (err) {
      console.error('回收站读取失败:', err);
    }
    const now = Date.now();
    const expired = trash.filter((item) => now - item.deletedAt > TRASH_TTL_MS);
    if (expired.length > 0) {
      trash = trash.filter((item) => now - item.deletedAt <= TRASH_TTL_MS);
      void idbPurgeTrash(expired.map((item) => item.id)).catch(() => undefined);
    }
    trash.sort((a, b) => b.deletedAt - a.deletedAt);

    // 与内存中已有记录合并（水合前可能有新写入，如 ?demo=1 的示例数据）
    set((state) => {
      const all = [...new Map([...loaded, ...state.records].map((r) => [r.id, r])).values()]
        .sort((a, b) => b.createdAt - a.createdAt);
      return {
        records: all.slice(0, MAX_HISTORY),
        totalCount: all.length,
        trash,
        ready: true,
      };
    });
  },

  addRecord: (record, audioBlob) => {
    set((state) => ({
      records: dedupeSorted([record, ...state.records]),
      // 撤销删除 / 重新导入时清掉同 id 的回收站条目
      trash: state.trash.filter((item) => item.id !== record.id),
      totalCount: state.totalCount + 1,
    }));
    return persist(async () => {
      await idbPutRecord(record);
      if (audioBlob) await idbPutAudio(record.id, audioBlob);
      // 回收站清理失败不影响记录/音频已保存的事实
      await idbDeleteTrash(record.id).catch(() => undefined);
    });
  },

  removeRecord: (id) => {
    const record = get().records.find((r) => r.id === id);
    if (!record) return;
    const deletedAt = Date.now();
    set((state) => ({
      records: state.records.filter((r) => r.id !== id),
      // 同步递减，否则列表清空后仍显示「已截断，共 N 条」
      totalCount: Math.max(0, state.totalCount - 1),
      trash: [{ id, deletedAt, record }, ...state.trash.filter((item) => item.id !== id)],
    }));
    // 音频留在 audio 仓库：恢复时不需要重写，30 天后才随回收站一起删
    persist(() => idbMoveRecordToTrash({ id, deletedAt, record }));
  },

  restoreTrash: async (ids) => {
    if (historyClearing) return false;
    const wanted = new Set(ids);
    const items = get().trash.filter((item) => wanted.has(item.id));
    if (items.length === 0) return true;
    try {
      await idbRestoreTrashBatch(items);
    } catch (err) {
      console.error('恢复记录失败:', err);
      warnStorage();
      return false;
    }
    // 恢复事务期间用户可能点了「清空全部」：清空优先，不把记录写回内存
    if (historyClearing) return false;
    const restored = items.map((item) => item.record);
    set((state) => ({
      records: dedupeSorted([...restored, ...state.records]),
      totalCount: state.totalCount + restored.length,
      trash: state.trash.filter((item) => !wanted.has(item.id)),
    }));
    return true;
  },

  deleteTrashForever: async (ids) => {
    if (historyClearing) return false;
    try {
      await idbPurgeTrash(ids);
    } catch (err) {
      console.error('永久删除失败:', err);
      warnStorage();
      return false;
    }
    const unwanted = new Set(ids);
    set((state) => ({ trash: state.trash.filter((item) => !unwanted.has(item.id)) }));
    return true;
  },

  clearTrash: async () => {
    if (historyClearing) return false;
    const ids = get().trash.map((item) => item.id);
    if (ids.length === 0) return true;
    try {
      await idbPurgeTrash(ids);
    } catch (err) {
      console.error('清空回收站失败:', err);
      warnStorage();
      return false;
    }
    set({ trash: [] });
    return true;
  },

  clearAll: () => {
    // totalCount 同步归零，否则列表清空后仍显示「已截断，共 N 条」提示
    historyClearing = true;
    set({ records: [], trash: [], totalCount: 0 });
    void persist(async () => {
      await idbClearRecords();
      await idbClearAudio();
      await idbClearTrash();
    }).finally(() => {
      historyClearing = false;
    });
  },

  updateRecord: (record) => {
    set((state) => ({
      records: state.records.map((r) => (r.id === record.id ? record : r)),
    }));
    persist(() => idbPutRecord(record));
  },

  importRecords: async (incoming) => {
    // 对「IDB 全量 + 内存」去重：内存视图只有最新 MAX_HISTORY 条，
    // 只按内存判断会把窗口外的老记录当成新增，导致 totalCount 虚高、重复写库
    const existing = new Map((await get().getAllRecords()).map((r) => [r.id, r]));
    const added: AnalysisRecord[] = [];
    for (const rec of incoming) {
      if (!rec || typeof rec !== 'object' || !rec.id || !rec.series || !rec.stats) continue;
      if (!Array.isArray(rec.series.t) || !Array.isArray(rec.series.f0) || !Array.isArray(rec.series.rmsDb)) continue;
      if (typeof rec.createdAt !== 'number' || typeof rec.stats.durationSec !== 'number') continue;
      if (!existing.has(rec.id)) {
        existing.set(rec.id, rec);
        added.push(rec);
      }
    }
    if (added.length > 0) {
      const merged = [...existing.values()].sort((a, b) => b.createdAt - a.createdAt);
      const addedIds = new Set(added.map((record) => record.id));
      set((state) => ({
        records: merged.slice(0, MAX_HISTORY),
        totalCount: merged.length,
        // 同 id 已在回收站时，导入后以活记录为准
        trash: state.trash.filter((item) => !addedIds.has(item.id)),
      }));
      persist(async () => {
        await idbPutRecords(added);
        for (const record of added) await idbDeleteTrash(record.id);
      });
    }
    return added.length;
  },

  getAudio: (id) =>
    idbGetAudio(id).catch((err) => {
      console.error('音频读取失败:', err);
      return null;
    }),

  getAllRecords: async () => {
    try {
      const loaded = await idbGetAllRecords<AnalysisRecord>();
      // 合并内存中尚未落库（或刚落库）的记录，按 id 去重
      const map = new Map(loaded.map((r) => [r.id, r]));
      for (const r of get().records) map.set(r.id, r);
      return [...map.values()].sort((a, b) => b.createdAt - a.createdAt);
    } catch {
      // IDB 不可用：至少导出内存中的记录
      return get().records;
    }
  },
}));
