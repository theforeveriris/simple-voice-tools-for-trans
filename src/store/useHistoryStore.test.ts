import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AnalysisRecord } from '@/types';

/** 内存版 IndexedDB 记录仓库：只实现 store 实际用到的方法 */
const h = vi.hoisted(() => {
  const records = new Map<string, unknown>();
  const trash = new Map<string, unknown>();
  return { records, trash, puts: 0 };
});

vi.mock('@/lib/storage/idb', () => ({
  idbGetAllRecords: async () => [...h.records.values()],
  idbPutRecord: async (r: { id: string }) => { h.records.set(r.id, r); },
  idbPutRecords: async (rs: { id: string }[]) => { h.puts++; for (const r of rs) h.records.set(r.id, r); },
  idbDeleteRecord: async (id: string) => { h.records.delete(id); },
  idbClearRecords: async () => { h.records.clear(); },
  idbGetAllTrash: async () => [...h.trash.values()],
  idbPutTrash: async (item: { id: string }) => { h.trash.set(item.id, item); },
  idbDeleteTrash: async (id: string) => { h.trash.delete(id); },
  idbClearTrash: async () => { h.trash.clear(); },
  idbGetAudio: async () => null,
  idbPutAudio: async () => {},
  idbDeleteAudio: async () => {},
  idbClearAudio: async () => {},
}));

import { useHistoryStore } from './useHistoryStore';

function rec(id: string, createdAt: number): AnalysisRecord {
  return {
    id,
    createdAt,
    durationSec: 1,
    sampleHz: 30,
    series: { t: [], f0: [], rmsDb: [], f1: [], f2: [] },
    stats: { durationSec: 1, sampleHz: 30 },
  } as unknown as AnalysisRecord;
}

beforeEach(() => {
  h.records.clear();
  h.trash.clear();
  h.puts = 0;
  useHistoryStore.setState({ records: [], trash: [], totalCount: 0, ready: false });
});

describe('removeRecord', () => {
  it('同步递减 totalCount，避免删除后仍显示「已截断，共 N 条」', () => {
    useHistoryStore.setState({ records: [rec('a', 2), rec('b', 1)], totalCount: 5 });
    useHistoryStore.getState().removeRecord('a');
    expect(useHistoryStore.getState().records.map((r) => r.id)).toEqual(['b']);
    expect(useHistoryStore.getState().totalCount).toBe(4);
  });

  it('删除不存在的 id 不改动计数', () => {
    useHistoryStore.setState({ records: [rec('a', 1)], totalCount: 3 });
    useHistoryStore.getState().removeRecord('zzz');
    expect(useHistoryStore.getState().totalCount).toBe(3);
    expect(useHistoryStore.getState().records).toHaveLength(1);
  });
});

describe('回收站', () => {
  it('删除移入回收站，恢复后回到列表且总数还原', () => {
    useHistoryStore.setState({ records: [rec('a', 2), rec('b', 1)], trash: [], totalCount: 2 });
    useHistoryStore.getState().removeRecord('a');
    expect(useHistoryStore.getState().records.map((r) => r.id)).toEqual(['b']);
    expect(useHistoryStore.getState().trash.map((item) => item.id)).toEqual(['a']);
    expect(useHistoryStore.getState().totalCount).toBe(1);

    useHistoryStore.getState().restoreTrash(['a']);
    expect(useHistoryStore.getState().records.map((r) => r.id)).toEqual(['a', 'b']);
    expect(useHistoryStore.getState().trash).toHaveLength(0);
    expect(useHistoryStore.getState().totalCount).toBe(2);
  });

  it('永久删除与清空回收站', () => {
    useHistoryStore.setState({ records: [rec('a', 2), rec('b', 1)], trash: [], totalCount: 2 });
    useHistoryStore.getState().removeRecord('a');
    useHistoryStore.getState().removeRecord('b');
    expect(useHistoryStore.getState().trash).toHaveLength(2);

    useHistoryStore.getState().deleteTrashForever(['a']);
    expect(useHistoryStore.getState().trash.map((item) => item.id)).toEqual(['b']);

    useHistoryStore.getState().clearTrash();
    expect(useHistoryStore.getState().trash).toHaveLength(0);
  });
});

describe('importRecords', () => {
  it('对 IDB 全量去重（内存窗口截断不会误判为新增），totalCount 为真实合并总数', async () => {
    // IDB 里有 3 条；内存视图只保留了其中 1 条（模拟 MAX_HISTORY 截断）
    const all = [rec('old1', 30), rec('old2', 20), rec('last', 10)];
    for (const r of all) h.records.set(r.id, r);
    useHistoryStore.setState({ records: [rec('old1', 30)], totalCount: 3, ready: true });

    // 重复导入同一批：窗口外的 old2 已存在于 IDB，不应算作新增
    const again = await useHistoryStore.getState().importRecords([rec('old1', 30), rec('old2', 20)]);
    expect(again).toBe(0);
    expect(useHistoryStore.getState().totalCount).toBe(3);
    expect(h.puts).toBe(0);

    // 真正的新记录
    const added = await useHistoryStore.getState().importRecords([rec('fresh', 40)]);
    expect(added).toBe(1);
    expect(useHistoryStore.getState().totalCount).toBe(4);
    expect(useHistoryStore.getState().records.map((r) => r.id)).toEqual(['fresh', 'old1', 'old2', 'last']);
  });

  it('忽略缺少 id/series/stats 的脏记录', async () => {
    const added = await useHistoryStore.getState().importRecords([
      { id: 'bad' } as unknown as AnalysisRecord,
      null as unknown as AnalysisRecord,
      rec('good', 1),
    ]);
    expect(added).toBe(1);
    expect(useHistoryStore.getState().records.map((r) => r.id)).toEqual(['good']);
  });
});
