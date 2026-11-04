import { describe, expect, it } from 'vitest';
import type { AnalysisRecord, VoiceStats } from '@/types';
import {
  buildAggregateSection,
  buildAssistantContext,
  buildAssistantProfile,
  buildBaselineSection,
  buildRawSection,
  formatRecordLine,
  type AssistantContextSettings,
} from './assistantContext';
import type { SustainedMetrics } from '@/lib/audio/sustained';

function makeStats(overrides: Partial<VoiceStats> = {}): VoiceStats {
  return {
    durationSec: 12,
    sampleHz: 30,
    totalSamples: 90,
    voicedSamples: 60,
    avgF0: 160,
    medianF0: 160,
    minF0: 120,
    maxF0: 220,
    p10F0: 130,
    p90F0: 210,
    stdF0: 20,
    malePct: 20,
    femalePct: 70,
    transitionPct: 10,
    avgF1: 600,
    avgF2: 1700,
    f2f1GapHz: 1100,
    f1Range: [550, 650],
    f2Range: [1600, 1800],
    avgDb: -24,
    peakDb: -12,
    jitterPct: 1.1,
    shimmerPct: 2.2,
    hnrDb: 18,
    cppsDb: 8,
    h1h2Db: -5,
    h2h4Db: 4,
    h1a3Db: -12,
    breathiness: 0.3,
    nasalityDb: -6,
    spectralTiltDbOct: -12,
    inTargetPct: 60,
    ...overrides,
  };
}

function makeRecord(
  id: string,
  createdAt: number,
  stats: Partial<VoiceStats> = {},
  overrides: Partial<AnalysisRecord> = {},
): AnalysisRecord {
  return {
    id,
    createdAt,
    durationSec: 12,
    sampleHz: 30,
    series: {
      t: [0, 1, 2, 3],
      f0: [150, 155, 160, 165],
      rmsDb: [-20, -21, -22, -23],
      f1: [600, 610, 620, 630],
      f2: [1700, 1710, 1720, 1730],
    },
    stats: makeStats(stats),
    mode: 'reading',
    ...overrides,
  };
}

function makeSettings(
  overrides: Partial<AssistantContextSettings> = {},
): AssistantContextSettings {
  return {
    userGoal: 'mtf',
    ageGroup: 'adult',
    targetEnabled: true,
    targetF0Min: 165,
    targetF0Max: 255,
    formantTargetEnabled: true,
    formantTargetF1: 500,
    formantTargetF2: 1800,
    formantTargetRadius: 120,
    bandBounds: [85, 165, 180, 255],
    baselineRecordId: 'base',
    ...overrides,
  };
}

const sustained = (mptSec: number): SustainedMetrics => ({
  mptSec,
  cvPct: 2.1,
  decayDbPerSec: -0.3,
});

describe('助手用户画像', () => {
  it('把训练方向、年龄段、靶标、共振峰目标与音区边界显式注入', () => {
    const text = buildAssistantProfile(makeSettings());
    expect(text).toContain('女性化（MtF）');
    expect(text).toContain('成人');
    expect(text).toContain('165–255 Hz（已启用）');
    expect(text).toContain('F1 500 ± 120 Hz');
    expect(text).toContain('F2 1800 ± 120 Hz');
    expect(text).toContain('85 / 165 / 180 / 255 Hz（自定义');
    expect(text).toContain('不要自行假设');
  });

  it('靶标关闭时明确说明，不伪造目标', () => {
    const text = buildAssistantProfile(makeSettings({
      targetEnabled: false,
      formantTargetEnabled: false,
    }));
    expect(text).toContain('目标音高区间：未启用');
    expect(text).toContain('共振峰目标区：未启用');
  });
});

describe('历史聚合', () => {
  const records = [
    makeRecord('r1', new Date(2026, 0, 5, 9).getTime(), {
      avgF0: 150, p10F0: 120, p90F0: 190, inTargetPct: 40, cppsDb: 6, jitterPct: 1.5,
    }),
    makeRecord('r2', new Date(2026, 0, 7, 9).getTime(), {
      avgF0: 158, p10F0: 125, p90F0: 198, inTargetPct: 55, cppsDb: 7, jitterPct: 1.3,
    }, { mode: 'sustained', durationSec: 20 }),
    makeRecord('r3', new Date(2026, 0, 14, 9).getTime(), {
      avgF0: 168, p10F0: 135, p90F0: 210, inTargetPct: 78, cppsDb: 9, jitterPct: 1.0,
    }),
  ];
  const sustainedMap = new Map<string, SustainedMetrics | null>([
    ['r1', null],
    ['r2', sustained(14.2)],
    ['r3', null],
  ]);

  it('输出整体、按模式、按周、趋势与最佳/最弱周', () => {
    const text = buildAggregateSection(records, sustainedMap, 8, true);
    expect(text).toContain('历史聚合（共 3 条');
    expect(text).toContain('按模式');
    expect(text).toContain('持续发声：1 条');
    expect(text).toContain('MPT 14.2s');
    expect(text).toContain('按周（最近 2 周）');
    expect(text).toContain('趋势（首周 → 末周');
    expect(text).toContain('最佳 / 最弱周（按靶标达成率）');
    expect(text).toContain('靶标 78%');
  });

  it('按模式聚合携带 F2−F1、气声、鼻化等新指标', () => {
    const text = buildAggregateSection(records, sustainedMap, 8, true);
    expect(text).toContain('F2−F1 1100Hz');
    expect(text).toContain('气声 0.30');
    expect(text).toContain('鼻化 -6.0dB');
    expect(text).toContain('Shimmer 2.20%');
  });

  it('靶标关闭时最佳/最弱周回退到 CPPS', () => {
    const text = buildAggregateSection(records, sustainedMap, 8, false);
    expect(text).toContain('最佳 / 最弱周（按CPPS）');
  });
});

describe('记录明细', () => {
  it('包含图表 id、持续发声、嗓音质量与环境字段', () => {
    const rec = makeRecord('r9', new Date(2026, 1, 2, 21, 5).getTime(), {
      inTargetPct: 72,
    }, {
      mode: 'sustained',
      note: '晨起\n嗓音',
      env: { noiseFloorDb: -52.4, hourOfDay: 21, micLabel: 'USB Mic | Test', inputGainDb: 3 },
    });
    const line = formatRecordLine(rec, sustained(16.4));
    expect(line).toContain('id r9');
    expect(line).toContain('持续发声');
    expect(line).toContain('MPT 16.4s');
    expect(line).toContain('F2−F1 1100Hz');
    expect(line).toContain('气声 0.30');
    expect(line).toContain('鼻化 -6.0dB');
    expect(line).toContain('底噪 -52.4dB');
    expect(line).toContain('麦克风「USB Mic / Test」');
    expect(line).toContain('备注「晨起 / 嗓音」');
    expect(line).not.toContain('\n');
  });

  it('预算不足时不塞入明细，但聚合仍可用', () => {
    const records = [makeRecord('r1', Date.now())];
    expect(buildRawSection(records, new Map(), 1)).toBe('');
  });
});

describe('钉选基线', () => {
  const baseline = makeRecord('base', new Date(2026, 0, 1).getTime(), {
    avgF0: 150, cppsDb: 6, inTargetPct: 40, breathiness: 0.4, nasalityDb: -8,
  }, { mode: 'sustained' });
  const latest = makeRecord('latest', new Date(2026, 0, 10).getTime(), {
    avgF0: 162, cppsDb: 8, inTargetPct: 70, breathiness: 0.2, nasalityDb: -5,
  }, { mode: 'sustained' });

  it('复用 Δ 口径并补齐新指标', () => {
    const text = buildBaselineSection([baseline, latest], 'base');
    expect(text).toContain('当前记录：latest');
    expect(text).toContain('基线记录：base');
    expect(text).toContain('deltaAvgF0: +12.0 Hz');
    expect(text).toContain('deltaInTargetPct: +30%');
    expect(text).toContain('deltaF2F1GapHz: 0 Hz');
    expect(text).toContain('deltaBreathiness: -0.20');
    expect(text).toContain('deltaNasalityDb: +3.0 dB');
    expect(text).toContain('deltaMptSec');
  });

  it('模式不同会提示 Δ 仅供参考', () => {
    const reading = { ...latest, mode: 'reading' as const };
    expect(buildBaselineSection([baseline, reading], 'base')).toContain('模式不同');
  });
});

describe('上下文预算', () => {
  const records = [
    makeRecord('r1', new Date(2026, 0, 5).getTime()),
    makeRecord('r2', new Date(2026, 0, 12).getTime()),
  ];

  it('无记录时仍注入画像', () => {
    const ctx = buildAssistantContext([], makeSettings(), 2048);
    expect(ctx.profile).toContain('训练方向');
    expect(ctx.history).toBe('');
  });

  it('预算极小也不丢掉画像和聚合', () => {
    const ctx = buildAssistantContext(records, makeSettings(), 300);
    expect(ctx.profile).toContain('训练方向');
    expect(ctx.history).toBeTruthy();
  });

  it('正常预算下同时包含画像、聚合、基线与明细', () => {
    const withBaseline = [
      makeRecord('base', new Date(2026, 0, 1).getTime()),
      ...records,
    ];
    const ctx = buildAssistantContext(withBaseline, makeSettings(), 4096);
    expect(ctx.profile).toContain('女性化');
    expect(ctx.history).toContain('历史聚合');
    expect(ctx.history).toContain('钉选基线对比');
    expect(ctx.history).toContain('最近记录明细');
    expect(ctx.profile).not.toMatch(/undefined|NaN/);
    expect(ctx.history).not.toMatch(/undefined|NaN/);
  });
});
