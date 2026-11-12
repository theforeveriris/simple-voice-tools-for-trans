import { describe, it, expect, beforeEach, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import type { AnalysisRecord } from '@/types';

const kv = vi.hoisted(() => new Map<string, unknown>());

vi.mock('@/lib/storage/idb', () => ({
  idbGetKV: async (key: string) => kv.get(key),
  idbPutKV: async (key: string, value: unknown) => {
    kv.set(key, structuredClone(value));
  },
  idbDeleteKV: async (key: string) => {
    kv.delete(key);
  },
  idbPutAudio: async () => {},
  idbGetAllRecords: async () => [],
  idbPutRecord: async () => {},
  idbPutRecords: async () => {},
  idbDeleteRecord: async () => {},
  idbClearRecords: async () => {},
  idbGetAudio: async () => null,
  idbDeleteAudio: async () => {},
  idbClearAudio: async () => {},
}));

import {
  enableBackupEncryption, disableBackupEncryption, lockBackupEncryption,
  encryptForBackup, BackupLockedError,
} from './crypto';
import { getLastBackupVerify, inspectBackupBytes } from './integrity';
import { BACKUP_FORMAT_VERSION } from '@/lib/export/backup';

function makeRecord(id: string): AnalysisRecord {
  return {
    id,
    createdAt: 1_700_000_000_000,
    durationSec: 1,
    sampleHz: 30,
    series: { t: [0], f0: [120], rmsDb: [-30], f1: [500], f2: [1500] },
    stats: {
      durationSec: 1, sampleHz: 30, totalSamples: 1, voicedSamples: 1,
      avgF0: 120, medianF0: 120, minF0: 120, maxF0: 120, p10F0: 120, p90F0: 120, stdF0: 0,
      malePct: 100, femalePct: 0, transitionPct: 0,
      avgF1: 500, avgF2: 1500, f1Range: [500, 500], f2Range: [1500, 1500],
      avgDb: -30, peakDb: -30,
    },
  };
}

function payload(records: AnalysisRecord[]): Uint8Array {
  return strToU8(JSON.stringify({
    app: 'simple-voice-tools-for-trans',
    version: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    records,
  }));
}

function zip(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files);
}

describe('备份完整性检查', () => {
  beforeEach(async () => {
    kv.clear();
    lockBackupEncryption();
    await disableBackupEncryption();
  });

  it('结构正常：记录、音频、体积与版本', async () => {
    const bytes = zip({
      'records.json': payload([makeRecord('a'), makeRecord('b')]),
      'audio/a.webm': new Uint8Array([1, 2, 3]),
    });
    const { result, records } = await inspectBackupBytes(bytes);
    expect(result.ok).toBe(true);
    expect(result.encrypted).toBe(false);
    expect(result.records).toBe(2);
    expect(result.audio).toBe(1);
    expect(result.audioBytes).toBe(3);
    expect(result.version).toBe(BACKUP_FORMAT_VERSION);
    expect(records).toHaveLength(2);
    expect((await getLastBackupVerify())?.ok).toBe(true);
  });

  it('缺少 records.json → 失败并给出问题', async () => {
    const { result } = await inspectBackupBytes(zip({ 'audio/a.webm': new Uint8Array([1]) }));
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('非 ZIP 字节 → 失败而不是抛异常', async () => {
    const { result } = await inspectBackupBytes(strToU8('not a zip'));
    expect(result.ok).toBe(false);
  });

  it('重复 id 与孤儿音频记为警告，但仍可读', async () => {
    const bytes = zip({
      'records.json': payload([makeRecord('a'), makeRecord('a')]),
      'audio/missing.webm': new Uint8Array([1]),
    });
    const { result } = await inspectBackupBytes(bytes);
    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(2);
  });

  it('加密备份：解锁后可验证，锁定时抛 BackupLockedError', async () => {
    await enableBackupEncryption('correct-horse');
    const plain = zip({ 'records.json': payload([makeRecord('a')]) });
    const encrypted = await encryptForBackup(plain);

    const { result } = await inspectBackupBytes(encrypted);
    expect(result.encrypted).toBe(true);
    expect(result.ok).toBe(true);

    lockBackupEncryption();
    await expect(inspectBackupBytes(encrypted)).rejects.toBeInstanceOf(BackupLockedError);
  });
});
