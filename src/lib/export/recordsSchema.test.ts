import { describe, it, expect } from 'vitest';
import { validateRecordsJson, validateRecordsPayload, asAnalysisRecords } from './recordsSchema';

const goodRecord = {
  id: 'rec-1',
  createdAt: 1700000000000,
  durationSec: 5,
  sampleHz: 30,
  mode: 'reading',
  series: {
    t: [0, 0.1, 0.2],
    f0: [150, 160, null],
    rmsDb: [-20, -19, -21],
    f1: [700, null, 710],
    f2: [1200, 1210, null],
  },
  stats: {
    durationSec: 5, sampleHz: 30, totalSamples: 3, voicedSamples: 2,
    avgF0: 155, medianF0: 155, minF0: 150, maxF0: 160, p10F0: 150, p90F0: 160, stdF0: 5,
    malePct: 10, femalePct: 60, transitionPct: 30,
    avgF1: 705, avgF2: 1205, f1Range: [700, 710], f2Range: [1200, 1210],
    avgDb: -20, peakDb: -15,
    cppsDb: null,
  },
};

const payload = (records: unknown[], extra: Record<string, unknown> = {}) => ({
  app: 'simple-voice-tools-for-trans', version: 2, exportedAt: '2026-01-01T00:00:00Z', records, ...extra,
});

describe('validateRecordsJson', () => {
  it('合法 payload → ok', () => {
    const res = validateRecordsJson(JSON.stringify(payload([goodRecord])));
    expect(res.ok).toBe(true);
    expect(res.recordCount).toBe(1);
    expect(res.issues).toHaveLength(0);
  });

  it('坏 JSON → parseError', () => {
    const res = validateRecordsJson('{oops');
    expect(res.ok).toBe(false);
    expect(res.parseError).toBeTruthy();
  });

  it('缺 records 数组 → ok=false', () => {
    const res = validateRecordsPayload({ app: 'simple-voice-tools-for-trans' });
    expect(res.ok).toBe(false);
    expect(res.issues[0].path).toBe('records');
  });

  it('app 标识不对 → 报告', () => {
    const res = validateRecordsPayload(payload([goodRecord], { app: 'other-app' }));
    expect(res.issues.some((x) => x.path === 'app')).toBe(true);
  });

  it('历史 app 标识（旧名）→ 仍接受', () => {
    const res = validateRecordsPayload(payload([goodRecord], { app: 'simple-voice-tools' }));
    expect(res.issues.some((x) => x.path === 'app')).toBe(false);
  });

  it('记录缺必备字段 → 报告路径', () => {
    const bad = { ...goodRecord } as Record<string, unknown>;
    delete bad.stats;
    const res = validateRecordsPayload(payload([bad]));
    expect(res.ok).toBe(false);
    expect(res.issues.some((x) => x.path === 'records[0]' && x.message.includes('stats'))).toBe(true);
  });

  it('series 列长不一致 → 报告', () => {
    const bad = {
      ...goodRecord,
      series: { ...goodRecord.series, f0: [150, null] },
    };
    const res = validateRecordsPayload(payload([bad]));
    expect(res.issues.some((x) => x.path.includes('series.f0'))).toBe(true);
  });

  it('t 非升序 → 报告', () => {
    const bad = {
      ...goodRecord,
      series: { ...goodRecord.series, t: [0.2, 0.1, 0] },
    };
    const res = validateRecordsPayload(payload([bad]));
    expect(res.issues.some((x) => x.path.includes('series.t'))).toBe(true);
  });

  it('百分比越界 → 报告', () => {
    const bad = { ...goodRecord, stats: { ...goodRecord.stats, malePct: 120 } };
    const res = validateRecordsPayload(payload([bad]));
    expect(res.issues.some((x) => x.path.includes('stats.malePct'))).toBe(true);
  });

  it('可空字段接受 null', () => {
    const res = validateRecordsPayload(payload([goodRecord]));
    expect(res.ok).toBe(true);
  });

  it('env.hourOfDay 越界 → 报告', () => {
    const bad = { ...goodRecord, env: { hourOfDay: 25 } };
    const res = validateRecordsPayload(payload([bad]));
    expect(res.issues.some((x) => x.path.includes('env.hourOfDay'))).toBe(true);
  });

  it('additionalProperties 允许未知字段（向前兼容）', () => {
    const bad = { ...goodRecord, futureField: { x: 1 } };
    const res = validateRecordsPayload(payload([bad]));
    expect(res.ok).toBe(true);
  });

  it('asAnalysisRecords 提取记录数组', () => {
    const recs = asAnalysisRecords(payload([goodRecord]));
    expect(recs).toHaveLength(1);
    expect(recs[0].id).toBe('rec-1');
  });
});
