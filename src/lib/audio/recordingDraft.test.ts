import { describe, it, expect, beforeEach, vi } from 'vitest';

/** 内存版 kv + 记录表，避免测试依赖真实 IndexedDB */
const h = vi.hoisted(() => ({
  kv: new Map<string, unknown>(),
  records: [] as { id: string }[],
}));

vi.mock('@/lib/storage/idb', () => ({
  idbGetKV: async (key: string) => h.kv.get(key),
  idbPutKV: async (key: string, value: unknown) => {
    h.kv.set(key, value);
  },
  idbDeleteKV: async (key: string) => {
    h.kv.delete(key);
  },
  idbGetAllRecords: async () => h.records,
}));

import {
  clearRecordingDraft,
  draftRecordExists,
  hasRecordingDraft,
  loadRecordingDraft,
  markRecordingDraftRecordId,
  startRecordingDraft,
  appendRecordingDraftChunk,
} from './recordingDraft';

const meta = {
  id: 'draft-1',
  startedAt: 1_760_000_000_000,
  mode: 'reading' as const,
  mimeType: 'audio/webm',
  targetRange: [100, 200] as [number, number],
};

describe('recordingDraft', () => {
  beforeEach(async () => {
    h.kv.clear();
    h.records.length = 0;
    await clearRecordingDraft();
    h.kv.clear();
  });

  it('写入元数据与音频块后可重组 Blob', async () => {
    await startRecordingDraft(meta);
    appendRecordingDraftChunk(0, new Blob(['abc']));
    appendRecordingDraftChunk(1, new Blob(['defg']));

    expect(await hasRecordingDraft()).toBe(true);
    const draft = await loadRecordingDraft();
    expect(draft).not.toBeNull();
    expect(draft?.meta.chunkCount).toBe(2);
    expect(draft?.meta.totalBytes).toBe(7);
    expect(draft?.audio.size).toBe(7);
    expect(draft?.audio.type).toBe('audio/webm');
    expect(await draft?.audio.text()).toBe('abcdefg');
    expect(draft?.meta.targetRange).toEqual([100, 200]);
  });

  it('开始新录音会覆盖并清掉旧草稿块', async () => {
    await startRecordingDraft(meta);
    appendRecordingDraftChunk(0, new Blob(['old']));
    await loadRecordingDraft();

    await startRecordingDraft({ ...meta, id: 'draft-2' });
    appendRecordingDraftChunk(0, new Blob(['new']));

    const draft = await loadRecordingDraft();
    expect(draft?.meta.id).toBe('draft-2');
    expect(await draft?.audio.text()).toBe('new');
    // 旧草稿块已被删除
    expect(h.kv.has('recording:draft:chunk:draft-1:0')).toBe(false);
  });

  it('recordId 对账：记录存在才算已保存', async () => {
    await startRecordingDraft(meta);
    appendRecordingDraftChunk(0, new Blob(['abc']));
    markRecordingDraftRecordId('record-1');
    const draft = await loadRecordingDraft();
    expect(draft?.meta.recordId).toBe('record-1');
    expect(await draftRecordExists(draft!.meta)).toBe(false);

    h.records.push({ id: 'record-1' });
    expect(await draftRecordExists(draft!.meta)).toBe(true);
  });

  it('清理后元数据与音频块一并删除', async () => {
    await startRecordingDraft(meta);
    appendRecordingDraftChunk(0, new Blob(['abc']));
    await loadRecordingDraft();

    await clearRecordingDraft();
    expect(await hasRecordingDraft()).toBe(false);
    expect(await loadRecordingDraft()).toBeNull();
    expect(h.kv.size).toBe(0);
  });

  it('没有音频块时视为无草稿', async () => {
    await startRecordingDraft(meta);
    expect(await loadRecordingDraft()).toBeNull();
  });
});
