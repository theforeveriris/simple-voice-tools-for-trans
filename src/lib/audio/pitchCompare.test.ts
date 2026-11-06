import { describe, it, expect } from 'vitest';
import { compareWithRecord, type AltPitchSeries } from './pitchCompare';
import type { AnalysisRecord, RecordSeries } from '@/types';

/**
 * 回归：音高算法对比的时间轴对齐。
 *
 * 背景：记录曲线（实时录音）与备选曲线（离线重算）的时间戳语义不同，
 * 离线时间戳整体晚一个分析窗长（64ms）。最近帧匹配因此会系统性选中
 * 基准曲线的后两帧 → 语调起伏大的嗓音（男声）相邻帧常差 20–80 cents，
 * 错开两帧即超出 ±50 cents 阈值，一致率被压到 20–30%。
 *
 * 补偿后两条曲线按同一语义对齐，一致率应回到 100%（同源曲线）。
 */
function makeSeries(f0: (number | null)[], frameSec = 1 / 30): RecordSeries {
  return {
    t: f0.map((_, i) => Number((i * frameSec).toFixed(4))),
    f0: f0.map((v) => v),
    rmsDb: f0.map(() => -20),
    f1: f0.map(() => null),
    f2: f0.map(() => null),
  };
}

function makeRecord(f0: (number | null)[]): AnalysisRecord {
  const series = makeSeries(f0);
  return {
    id: 'test',
    createdAt: 0,
    durationSec: series.t.length / 30,
    sampleHz: 30,
    series,
    stats: {} as AnalysisRecord['stats'],
  } as AnalysisRecord;
}

/** 离线重算序列：t = (k*1067 + 2048)/32000 = k*33.344ms + 64ms */
const HOP = 1067;
const WIN = 2048;
const SR = 32000;

function makeAlt(f0: (number | null)[], algo: 'pyin' | 'mpm' = 'pyin'): AltPitchSeries {
  const t: number[] = [];
  for (let k = 0; k < f0.length; k++) {
    t.push(Number(((k * HOP + WIN) / SR).toFixed(6)));
  }
  return { algo, t, f0: [...f0] };
}

describe('compareWithRecord 时间轴对齐', () => {
  it('同源曲线：一致率应为 100%（错位两帧会掉到 90% 以下）', () => {
    // 平缓曲线（女声型）
    const gentle = Array.from({ length: 60 }, (_, i) => 220 + Math.round(Math.sin(i / 6) * 8));
    // 起伏曲线（男声型）：相邻帧常差 20–80 cents
    const rough = Array.from({ length: 60 }, (_, i) => 110 + Math.round(Math.sin(i / 1.5) * 28) + (i % 3) * 6);

    for (const [label, curve] of [['平缓', gentle], ['起伏', rough]] as const) {
      const r = compareWithRecord(makeRecord(curve), makeAlt(curve));
      expect(r.agreePct, `${label} 曲线一致率`).toBe(100);
      expect(r.medAbsCents).toBeLessThanOrEqual(1);
    }
  });

  it('未补偿时会系统性错开两帧（守住回归点）', () => {
    const rough = Array.from({ length: 60 }, (_, i) => 110 + Math.round(Math.sin(i / 1.5) * 28) + (i % 3) * 6);
    const record = makeRecord(rough);
    // 模拟「未补偿」：直接用离线原始时间戳做最近帧匹配
    const rawT = Array.from({ length: rough.length }, (_, k) => (k * HOP + WIN) / SR);
    const devs: number[] = [];
    for (let i = 0; i < rough.length; i++) {
      const a = rough[i];
      if (a == null) continue;
      // 最近帧（无补偿）
      let best = 0;
      let bestD = Infinity;
      for (let j = 0; j < record.series.t.length; j++) {
        const d = Math.abs(record.series.t[j] - rawT[i]);
        if (d < bestD) { bestD = d; best = j; }
      }
      const b = record.series.f0[best];
      if (b == null) continue;
      devs.push(Math.abs(1200 * Math.log2(a / b)));
    }
    const rawAgree = devs.length
      ? (devs.filter((d) => d <= 50).length / devs.length) * 100
      : 0;
    // 未补偿时错开两帧 → 起伏曲线的一致率明显低于 100%
    expect(rawAgree).toBeLessThan(95);
    // 补偿后应回到 100%
    const compensated = compareWithRecord(record, makeAlt(rough));
    expect(compensated.agreePct).toBe(100);
  });

  it('真实误检（倍频）只影响出错的那几帧', () => {
    const curve = Array.from({ length: 60 }, (_, i) => 110 + Math.round(Math.sin(i / 1.5) * 20));
    const alt = makeAlt(curve);
    // 第 10 帧被备选算法误判为倍频
    alt.f0[10] = (curve[10] ?? 110) * 2;
    const r = compareWithRecord(makeRecord(curve), alt);
    expect(r.agreePct).toBeGreaterThan(95);
    expect(r.medAbsCents).toBeLessThanOrEqual(50);
  });
});
