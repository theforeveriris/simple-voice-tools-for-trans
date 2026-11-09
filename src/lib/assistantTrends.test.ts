import { describe, expect, it } from 'vitest';
import type { AnalysisRecord, VoiceStats } from '@/types';
import {
  computeTrend,
  formatTrendText,
  trendMetricValue,
  type TrendMetric,
} from './assistantTrends';

function stats(overrides: Partial<VoiceStats> = {}): VoiceStats {
  return {
    durationSec: 30,
    sampleHz: 30,
    totalSamples: 900,
    voicedSamples: 700,
    avgF0: 170,
    medianF0: 168,
    minF0: 120,
    maxF0: 220,
    p10F0: 145,
    p90F0: 195,
    stdF0: 18,
    malePct: 10,
    femalePct: 60,
    transitionPct: 30,
    avgF1: 880,
    avgF2: 1980,
    f2f1GapMedianHz: 1100,
    f1Range: [800, 950],
    f2Range: [1800, 2100],
    avgDb: -20,
    peakDb: -8,
    inTargetPct: 72,
    breathiness: 0.32,
    ...overrides,
  };
}

function record(
  id: string,
  day: number,
  overrides: Partial<VoiceStats> = {},
  mode: AnalysisRecord['mode'] = 'reading',
): AnalysisRecord {
  return {
    id,
    createdAt: Date.UTC(2026, 9, day, 10),
    durationSec: overrides.durationSec ?? 30,
    sampleHz: 30,
    series: { t: [], f0: [], rmsDb: [], f1: [], f2: [] },
    stats: stats(overrides),
    mode,
  };
}

describe('assistantTrends', () => {
  const records = [
    record('a', 1, { medianF0: 160, inTargetPct: 60 }),
    record('b', 3, { medianF0: 170, inTargetPct: 80 }),
    record('c', 5, { medianF0: 180, inTargetPct: 85 }),
    record('d', 7, { medianF0: 190, inTargetPct: 90 }),
  ];

  it('extracts metric values and skips missing data', () => {
    expect(trendMetricValue(records[0], 'f0')).toBe(160);
    expect(trendMetricValue(records[0], 'jitter')).toBeNull();
    expect(trendMetricValue(record('x', 1, { jitterPct: 1.2 }), 'jitter')).toBe(1.2);
  });

  it('computes stats for the last N records', () => {
    const result = computeTrend(records, 'f0', { lastN: 3 });
    expect(result.selected).toBe(3);
    expect(result.count).toBe(3);
    expect(result.recordIds).toEqual(['b', 'c', 'd']);
    expect(result.mean).toBe(180);
    expect(result.median).toBe(180);
    expect(result.min).toBe(170);
    expect(result.max).toBe(190);
    expect(result.delta).toBe(20);
    expect(result.percent).toBeCloseTo(11.76, 1);
    expect(result.slopePerWeek).toBeCloseTo(35, 0);
    expect(result.targetHitRate).toBeCloseTo(85, 0);
  });

  it('filters by mode and date', () => {
    const mixed = [
      ...records,
      record('s1', 2, { medianF0: 100 }, 'sustained'),
      record('s2', 4, { medianF0: 110 }, 'sustained'),
    ];
    const result = computeTrend(mixed, 'f0', { lastN: 8, mode: 'sustained' });
    expect(result.recordIds).toEqual(['s1', 's2']);
    expect(result.mean).toBe(105);

    const dated = computeTrend(mixed, 'f0', { from: '2026-10-03', to: '2026-10-05' });
    expect(dated.recordIds).toEqual(['b', 's2', 'c']);
  });

  it('compares with the previous period and baseline', () => {
    const previous = computeTrend(records, 'f0', { lastN: 2, compare: 'previous' });
    expect(previous.mean).toBe(185);
    expect(previous.previousDelta).toBe(20);

    const baseline = computeTrend(records, 'f0', { lastN: 2, compare: 'baseline', baselineRecordId: 'a' });
    expect(baseline.baselineDelta).toBe(25);
  });

  it('reports coverage when some records lack the metric', () => {
    const sparse = [
      record('a', 1, { medianF0: 160 }),
      record('b', 2, { medianF0: 170, jitterPct: 1.1 }),
      record('c', 3, { medianF0: 180 }),
    ];
    const result = computeTrend(sparse, 'jitter', { lastN: 3 });
    expect(result.selected).toBe(3);
    expect(result.count).toBe(1);
    expect(result.coverage).toBeCloseTo(1 / 3, 2);
  });

  it('formats a compact text block', () => {
    const result = computeTrend(records, 'f0', { lastN: 4 });
    const text = formatTrendText(result, { lastN: 4 });
    expect(text).toContain('F0 中位');
    expect(text).toContain('均值 175.0 Hz');
    expect(text).toContain('靶标命中率均值 78.8%');
    expect(text).toContain('记录 id：a, b, c, d');
  });

  it('handles empty data without throwing', () => {
    const result = computeTrend([], 'f0', { lastN: 8 });
    expect(result.count).toBe(0);
    expect(result.mean).toBeNull();
    expect(formatTrendText(result)).toContain('没有可用于计算的记录');
  });

  it('is type-safe for metric names', () => {
    const metric: TrendMetric = 'cpps';
    expect(trendMetricValue(record('x', 1, { cppsDb: 12.3 }), metric)).toBe(12.3);
  });
});
