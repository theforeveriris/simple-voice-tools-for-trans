import { describe, expect, it } from 'vitest';
import type { AnalysisRecord, VoiceStats } from '@/types';
import { ASSISTANT_COMMAND_TOOL, buildContextReport, buildStatsReport, normalizeModeArg, normalizeRangeSelector, selectorLabel } from './assistantCommandRuntime';

function stats(overrides: Partial<VoiceStats> = {}): VoiceStats {
  return {
    durationSec: 10,
    sampleHz: 30,
    totalSamples: 30,
    voicedSamples: 20,
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
    f1Range: [550, 650],
    f2Range: [1600, 1800],
    avgDb: -24,
    peakDb: -12,
    jitterPct: 1,
    shimmerPct: 2,
    hnrDb: 18,
    cppsDb: 8,
    ...overrides,
  };
}

function rec(
  id: string,
  createdAt: number,
  mode: AnalysisRecord['mode'],
  s: Partial<VoiceStats> = {},
): AnalysisRecord {
  return {
    id,
    createdAt,
    durationSec: s.durationSec ?? 10,
    sampleHz: 30,
    series: {
      t: [0, 1],
      f0: [150, 160],
      rmsDb: [-20, -21],
      f1: [600, 610],
      f2: [1700, 1710],
    },
    stats: stats(s),
    mode,
    note: id === 'b' ? '晨间练习' : undefined,
  };
}

const records = [
  rec('a', new Date(2026, 10, 1, 9).getTime(), 'reading', { avgF0: 160, medianF0: 160, inTargetPct: 70 }),
  rec('b', new Date(2026, 10, 4, 9).getTime(), 'sustained', { avgF0: 150, medianF0: 150, inTargetPct: 80 }),
  rec('c', new Date(2026, 10, 5, 9).getTime(), 'glide', { avgF0: 140, medianF0: 140, inTargetPct: null }),
];

describe('buildStatsReport', () => {
  it('聚合条数、均值、中位、P10–P90、靶标与模式分布', () => {
    const report = buildStatsReport(records, ['all']);
    expect(report.title).toBe('统计');
    expect(report.text).toContain('范围：全部 · 3 条');
    expect(report.text).toContain('平均 F0 150 Hz');
    expect(report.text).toContain('中位 150 Hz');
    expect(report.text).toContain('P10–P90 130–210 Hz');
    expect(report.text).toContain('靶标命中 75%（2 条有靶标）');
    expect(report.text).toContain('模式：朗读 1 · 长音 1 · 滑音 1');
    expect(report.recordIds).toEqual(['a', 'b', 'c']);
  });

  it('last:N 与 mode 选择器', () => {
    expect(buildStatsReport(records, ['last:2']).text).toContain('2 条');
    const sustained = buildStatsReport(records, ['mode:sustained']);
    expect(sustained.text).toContain('1 条');
    expect(sustained.text).toContain('平均 F0 150 Hz');
  });

  it('range + mode 取交集，支持工具参数别名', () => {
    expect(normalizeRangeSelector('last_7d')).toBe('week');
    expect(normalizeModeArg('朗读')).toBe('reading');
    const report = buildStatsReport(records, [normalizeRangeSelector('all')], undefined, normalizeModeArg('朗读'));
    expect(report.recordIds).toEqual(['a']);
    expect(report.text).toContain('范围：全部 · 模式：朗读 · 1 条');
    expect(report.text).toContain('平均 F0 160 Hz');
  });

  it('无匹配记录时返回空结果', () => {
    const report = buildStatsReport(records, ['date:2020-01-01']);
    expect(report.recordIds).toEqual([]);
    expect(report.text).toContain('没有符合条件');
  });

  it('selectorLabel 覆盖常用范围', () => {
    expect(selectorLabel(['week'])).toBe('最近 7 天');
    expect(selectorLabel(['last:5'])).toBe('最近 5 条');
    expect(selectorLabel(['mode:sustained'])).toContain('长音');
  });
});

describe('ASSISTANT_COMMAND_TOOL', () => {
  it('exposes only the safe command set to the model', () => {
    expect(ASSISTANT_COMMAND_TOOL.name).toBe('run_command');
    const params = ASSISTANT_COMMAND_TOOL.parameters as {
      properties?: { command?: { enum?: string[] } };
    };
    expect(params.properties?.command?.enum).toEqual([
      'stats', 'context', 'attach', 'detach', 'open',
    ]);
  });
});

describe('buildContextReport', () => {
  it('列出 pinned、基线、当前页、记忆与隐私', () => {
    const report = buildContextReport({
      records,
      pinnedRecordIds: ['a', 'b'],
      currentPage: { tab: 'analysis', recordId: 'a' },
      chatTitle: '训练复盘',
      messageCount: 12,
      privacy: 'private',
      memoryOff: true,
      baselineRecordId: 'c',
    });
    expect(report.text).toContain('对话：训练复盘');
    expect(report.text).toContain('消息 12 条');
    expect(report.text).toContain('记忆 关闭');
    expect(report.text).toContain('隐私 私密');
    expect(report.text).toContain('已引用 2 条记录');
    expect(report.text).toContain('晨间练习');
    expect(report.text).toContain('当前页面：analysis');
    expect(report.recordIds).toEqual(['a', 'b', 'a', 'c']);
  });

  it('没有引用时给出 attach 提示', () => {
    const report = buildContextReport({ records, chatTitle: '', messageCount: 0 });
    expect(report.text).toContain('新对话');
    expect(report.text).toContain('已引用记录：无');
    expect(report.recordIds).toEqual([]);
  });
});
