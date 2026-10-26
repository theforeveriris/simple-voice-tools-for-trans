import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildRecordsPayload, parseRecordsPayload, BACKUP_FORMAT_VERSION, buildFullBackupZip } from './backup';
import { useHistoryStore } from '@/store/useHistoryStore';
import type { AnalysisRecord } from '@/types';

// buildFullBackupZip 会读音频与背景图：测试里只要 KV 为空、音频为 null
vi.mock('@/lib/storage/idb', () => ({
  idbGetKV: async () => undefined,
  idbPutAudio: async () => {},
}));

function makeRecord(id: string): AnalysisRecord {
  return {
    id,
    createdAt: 1700000000000,
    durationSec: 3.2,
    sampleHz: 30,
    series: { t: [0, 0.1], f0: [120, null], rmsDb: [-30, -60], f1: [500, null], f2: [1500, null] },
    stats: {
      durationSec: 3.2, sampleHz: 30, totalSamples: 2, voicedSamples: 1,
      avgF0: 120, medianF0: 120, minF0: 120, maxF0: 120, p10F0: 120, p90F0: 120, stdF0: 0,
      malePct: 100, femalePct: 0, transitionPct: 0,
      avgF1: 500, avgF2: 1500, f1Range: [500, 500], f2Range: [1500, 1500],
      avgDb: -45, peakDb: -30,
    },
  };
}

describe('buildRecordsPayload', () => {
  it('app 标识、版本 2、exportedAt 存在、records 原样透传', () => {
    const records = [makeRecord('a'), makeRecord('b')];
    const payload = buildRecordsPayload(records);
    expect(payload.app).toBe('simple-voice-tools-for-trans');
    expect(payload.version).toBe(2);
    expect(payload.version).toBe(BACKUP_FORMAT_VERSION);
    expect(typeof payload.exportedAt).toBe('string');
    expect(Number.isNaN(Date.parse(payload.exportedAt))).toBe(false);
    expect(payload.records).toBe(records);
  });
});

describe('parseRecordsPayload', () => {
  it('build → parse 往返一致（版本 2）', () => {
    const records = [makeRecord('a'), makeRecord('b')];
    const json = JSON.stringify(buildRecordsPayload(records));
    const parsed = parseRecordsPayload(json);
    expect(parsed.version).toBe(2);
    expect(parsed.records).toEqual(records);
  });

  it('裸数组（最早版本）接受，version 为 null', () => {
    const records = [makeRecord('a')];
    const parsed = parseRecordsPayload(JSON.stringify(records));
    expect(parsed.version).toBeNull();
    expect(parsed.records).toEqual(records);
  });

  it('缺少 version 的 {records:[...]}（v1）接受，version 为 null', () => {
    const parsed = parseRecordsPayload(JSON.stringify({ records: [makeRecord('a')] }));
    expect(parsed.version).toBeNull();
    expect(parsed.records.length).toBe(1);
  });

  it('显式 version 2 接受', () => {
    const parsed = parseRecordsPayload('{"version":2,"records":[]}');
    expect(parsed.version).toBe(2);
    expect(parsed.records).toEqual([]);
  });

  it('更高版本（99）拒绝并抛 Error', () => {
    expect(() => parseRecordsPayload('{"version":99,"records":[]}')).toThrow(Error);
  });

  it('非法 JSON 抛 Error', () => {
    expect(() => parseRecordsPayload('{not-json')).toThrow(Error);
  });

  it('缺少 records 数组的载荷抛 Error', () => {
    expect(() => parseRecordsPayload('{"version":2,"foo":1}')).toThrow(Error);
    expect(() => parseRecordsPayload('null')).toThrow(Error);
  });
});

describe('完整备份的内容指纹', () => {
  const records = [makeRecord('a'), makeRecord('b')];

  beforeEach(() => {
    useHistoryStore.setState({
      records,
      getAllRecords: async () => records,
      getAudio: async () => null,
    });
  });

  it('内容不变时指纹稳定（不受每次打包都变的 exportedAt 影响）', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const a = await buildFullBackupZip();
      vi.setSystemTime(new Date('2026-02-03T04:05:06Z'));
      const b = await buildFullBackupZip();
      expect(a?.sha256).toBeTruthy();
      expect(b?.sha256).toBe(a?.sha256);
    } finally {
      vi.useRealTimers();
    }
  });

  it('记录变化时指纹随之变化', async () => {
    const a = await buildFullBackupZip();
    useHistoryStore.setState({ getAllRecords: async () => [records[0]] });
    const b = await buildFullBackupZip();
    expect(b?.sha256).not.toBe(a?.sha256);
  });
});
