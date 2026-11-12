/**
 * 录音草稿：录音过程中把 MediaRecorder 的音频块持续写入 IndexedDB。
 *
 * 目的不是替代正常保存，而是覆盖「App/WebView 被系统杀掉、浏览器崩溃、
 * 切后台太久」这类拿不到 stop() 的场景。成功保存的草稿会在下次启动时
 * 通过 recordId 对账后静默清理；只有找不到对应记录的草稿才会提示恢复。
 */

import {
  idbDeleteKV, idbDeleteKVByPrefix, idbGetRecord, idbGetKV, idbPutKV,
} from '@/lib/storage/idb';
import type { AnalysisRecord, TestMode } from '@/types';

const META_KEY = 'recording:draft:meta';
const CHUNK_PREFIX = 'recording:draft:chunk:';

export interface RecordingDraftMeta {
  id: string;
  startedAt: number;
  mode: TestMode;
  mimeType: string;
  chunkCount: number;
  totalBytes: number;
  targetRange: [number, number] | null;
  /** stop() 生成记录后写入；下次启动据此判断是否已经正常保存 */
  recordId?: string;
}

export interface RecordingDraft {
  meta: RecordingDraftMeta;
  audio: Blob;
}

let activeMeta: RecordingDraftMeta | null = null;
let queue: Promise<void> = Promise.resolve();
let writeWarned = false;

function chunkKey(id: string, index: number): string {
  return `${CHUNK_PREFIX}${id}:${index}`;
}

function enqueue(task: () => Promise<void>): Promise<void> {
  // 磁盘满 / 隐私模式等失败不能变成未处理的 rejection，也不能卡死后续写入
  queue = queue.then(task).catch((err) => {
    // 配额耗尽时每个块都会失败，只提示一次，避免刷屏
    if (!writeWarned) {
      writeWarned = true;
      console.warn('录音草稿写入失败:', err);
    }
  });
  return queue;
}

/** 开始新录音：先清掉所有旧草稿块（包括 meta 丢失留下的孤儿），再写新元数据 */
export async function startRecordingDraft(meta: Omit<RecordingDraftMeta, 'chunkCount' | 'totalBytes'>): Promise<void> {
  activeMeta = { ...meta, chunkCount: 0, totalBytes: 0 };
  writeWarned = false;
  await enqueue(async () => {
    await idbDeleteKVByPrefix(CHUNK_PREFIX);
    await idbDeleteKV(META_KEY);
    if (activeMeta) await idbPutKV(META_KEY, activeMeta);
  });
}

/** 每 1 秒的 MediaRecorder 数据块 */
export function appendRecordingDraftChunk(index: number, chunk: Blob): void {
  if (!activeMeta) return;
  const meta = activeMeta;
  void enqueue(async () => {
    await idbPutKV(chunkKey(meta.id, index), chunk);
    if (!activeMeta || activeMeta.id !== meta.id) return;
    activeMeta = {
      ...activeMeta,
      chunkCount: Math.max(activeMeta.chunkCount, index + 1),
      totalBytes: activeMeta.totalBytes + chunk.size,
    };
    await idbPutKV(META_KEY, activeMeta);
  });
}

/** stop() 生成记录后调用；不在这里删草稿，留给下次启动对账 */
export function markRecordingDraftRecordId(recordId: string): void {
  if (!activeMeta) return;
  const meta = activeMeta;
  void enqueue(async () => {
    if (!activeMeta || activeMeta.id !== meta.id) return;
    activeMeta = { ...activeMeta, recordId };
    await idbPutKV(META_KEY, activeMeta);
  });
}

/** 读回草稿；调用方负责在恢复/丢弃后 clearRecordingDraft() */
export async function loadRecordingDraft(): Promise<RecordingDraft | null> {
  await queue;
  const meta = await idbGetKV<RecordingDraftMeta>(META_KEY).catch(() => undefined);
  if (!meta) return null;
  const chunks: Blob[] = [];
  for (let index = 0; index < meta.chunkCount; index++) {
    const chunk = await idbGetKV<Blob>(chunkKey(meta.id, index)).catch(() => undefined);
    if (chunk) chunks.push(chunk);
  }
  if (chunks.length === 0) return null;
  return {
    meta,
    audio: new Blob(chunks, { type: meta.mimeType || 'audio/webm' }),
  };
}

/** 是否存在未完成草稿（设置页清理入口用，不读取音频块） */
export async function hasRecordingDraft(): Promise<boolean> {
  await queue;
  const meta = await idbGetKV<RecordingDraftMeta>(META_KEY).catch(() => undefined);
  return Boolean(meta);
}

/** 草稿对应的记录是否已经正常落库（用于成功保存后的静默清理） */
export async function draftRecordExists(meta: RecordingDraftMeta): Promise<boolean> {
  if (!meta.recordId) return false;
  const record = await idbGetRecord<AnalysisRecord>(meta.recordId).catch(() => undefined);
  return record != null;
}

/** 正常保存成功后延迟对账清理；记录尚未落库时保留草稿，交给下次启动恢复 */
export async function clearRecordingDraftIfSaved(): Promise<void> {
  await queue;
  const meta = await idbGetKV<RecordingDraftMeta>(META_KEY).catch(() => undefined);
  if (!meta) return;
  if (await draftRecordExists(meta)) await clearRecordingDraft(meta.id);
}

/**
 * 清理草稿。
 * @param targetId 指定要删的草稿 id；不传则清当前 meta。
 *   指定 id 时不会误删排队期间刚开始的新录音。
 */
export async function clearRecordingDraft(targetId?: string): Promise<void> {
  const id = targetId ?? activeMeta?.id;
  await enqueue(async () => {
    if (id) {
      await idbDeleteKVByPrefix(`${CHUNK_PREFIX}${id}:`);
      const meta = await idbGetKV<RecordingDraftMeta>(META_KEY).catch(() => undefined);
      if (meta && meta.id !== id) return; // 期间已开始新录音：保留新 meta
      await idbDeleteKV(META_KEY);
      if (activeMeta?.id === id) activeMeta = null;
      return;
    }
    await idbDeleteKVByPrefix(CHUNK_PREFIX);
    await idbDeleteKV(META_KEY);
    activeMeta = null;
  });
}

/** 录音过短等不落记录的场景：立即丢弃，不等下次启动 */
export function discardRecordingDraft(): void {
  // 捕获当前草稿 id，避免清理任务排队期间误伤下一次录音
  void clearRecordingDraft(activeMeta?.id);
  activeMeta = null;
}
