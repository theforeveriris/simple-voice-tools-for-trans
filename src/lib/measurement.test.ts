import { describe, expect, it } from 'vitest';
import type { AnalysisRecord, VoiceStats } from '@/types';
import { assessRecordQuality, deltaIsSignificant, MDC } from './measurement';

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

function record(overrides: Partial<VoiceStats> = {}, env?: AnalysisRecord['env']): AnalysisRecord {
  return {
    id: 'r1',
    createdAt: Date.UTC(2026, 10, 1),
    durationSec: overrides.durationSec ?? 30,
    sampleHz: 30,
    series: { t: [], f0: [], rmsDb: [], f1: [], f2: [] },
    stats: stats(overrides),
    mode: 'reading',
    env,
  };
}

describe('assessRecordQuality', () => {
  it('accepts a clean recording', () => {
    expect(assessRecordQuality(record()).level).toBe('ok');
  });

  it('flags short recordings', () => {
    const q = assessRecordQuality(record({ durationSec: 2 }));
    expect(q.level).toBe('bad');
    expect(q.reasons.join(' ')).toContain('过短');
  });

  it('flags noisy environments and clipping', () => {
    const q = assessRecordQuality(record({ peakDb: -0.2 }, { noiseFloorDb: -25 }));
    expect(q.level).toBe('bad');
    expect(q.reasons.join(' ')).toContain('底噪');
    expect(q.reasons.join(' ')).toContain('削波');
  });

  it('flags sparse voiced content and missing pitch', () => {
    const q = assessRecordQuality(record({ voicedSamples: 60, medianF0: 0 }));
    expect(q.level).toBe('bad');
    expect(q.reasons.join(' ')).toContain('有声帧');
    expect(q.reasons.join(' ')).toContain('基频');
  });

  it('warns on moderately short / noisy recordings', () => {
    const q = assessRecordQuality(record({ durationSec: 4 }, { noiseFloorDb: -36 }));
    expect(q.level).toBe('warn');
    expect(q.reasons.join(' ')).toContain('偏短');
    expect(q.reasons.join(' ')).toContain('建议安静环境');
  });
});

describe('MDC', () => {
  it('treats small deltas as measurement noise', () => {
    expect(deltaIsSignificant('medianF0', 5)).toBe(false);
    expect(deltaIsSignificant('medianF0', 15)).toBe(true);
    expect(deltaIsSignificant('jitter', 0.2)).toBe(false);
    expect(deltaIsSignificant('jitter', 0.8)).toBe(true);
  });

  it('has a conservative value for every metric', () => {
    for (const value of Object.values(MDC)) expect(value).toBeGreaterThan(0);
  });
});
