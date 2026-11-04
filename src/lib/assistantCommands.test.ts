import { describe, expect, it } from 'vitest';
import type { AnalysisRecord, VoiceStats } from '@/types';
import {
  buildCommandCompletions,
  filterCommands,
  parseAssistantCommand,
  parseTestMode,
  resolveRecordSelector,
  resolveRecordSelectors,
  reviewRangeDays,
} from './assistantCommands';

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

function rec(id: string, createdAt: number, mode: AnalysisRecord['mode'] = 'reading'): AnalysisRecord {
  return {
    id,
    createdAt,
    durationSec: 10,
    sampleHz: 30,
    series: {
      t: [0, 1, 2],
      f0: [150, 160, 170],
      rmsDb: [-20, -21, -22],
      f1: [600, 610, 620],
      f2: [1700, 1710, 1720],
    },
    stats: stats(),
    mode,
  };
}

const now = new Date(2026, 10, 5, 12).getTime();
const records = [
  rec('a', new Date(2026, 10, 1, 9).getTime()),
  rec('b', new Date(2026, 10, 4, 9).getTime(), 'sustained'),
  rec('c', new Date(2026, 10, 5, 9).getTime(), 'glide'),
];

describe('Slash 命令解析', () => {
  it('解析标准命令与参数', () => {
    expect(parseAssistantCommand('/record sustained')).toMatchObject({ id: 'record', args: ['sustained'] });
    expect(parseAssistantCommand('/attach last:3 latest')).toMatchObject({ id: 'attach', args: ['last:3', 'latest'] });
  });

  it('支持中文别名与快捷命令', () => {
    expect(parseAssistantCommand('/录音 长音')).toMatchObject({ id: 'record', args: ['长音'] });
    expect(parseAssistantCommand('/分析页 latest')).toMatchObject({ id: 'open', args: ['analysis', 'latest'] });
    expect(parseAssistantCommand('/记录')).toMatchObject({ id: 'open', args: ['records'] });
    expect(parseAssistantCommand('/设置')).toMatchObject({ id: 'open', args: ['settings'] });
  });

  it('双斜杠按普通文本处理', () => {
    expect(parseAssistantCommand('//hello')).toBeNull();
    expect(parseAssistantCommand('hello')).toBeNull();
  });

  it('未知命令返回 unknown', () => {
    expect(parseAssistantCommand('/wat')).toMatchObject({ id: 'unknown', unknownName: '/wat' });
  });

  it('菜单按前缀过滤', () => {
    expect(filterCommands('/rec').map((c) => c.id)).toEqual(['record']);
    expect(filterCommands('/').length).toBeGreaterThan(5);
  });

  it('测试模式支持中英文', () => {
    expect(parseTestMode(undefined)).toBe('reading');
    expect(parseTestMode('长音')).toBe('sustained');
    expect(parseTestMode('glide')).toBe('glide');
    expect(parseTestMode('??')).toBeNull();
  });
});

describe('记录选择器', () => {
  it('latest / last / id / baseline', () => {
    expect(resolveRecordSelector('latest', records, undefined, now).map((r) => r.id)).toEqual(['c']);
    expect(resolveRecordSelector('last:2', records, undefined, now).map((r) => r.id)).toEqual(['b', 'c']);
    expect(resolveRecordSelector('id:b', records, undefined, now).map((r) => r.id)).toEqual(['b']);
    expect(resolveRecordSelector('baseline', records, 'a', now).map((r) => r.id)).toEqual(['a']);
  });

  it('today / week / mode', () => {
    expect(resolveRecordSelector('today', records, undefined, now).map((r) => r.id)).toEqual(['c']);
    expect(resolveRecordSelector('week', records, undefined, now).map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(resolveRecordSelector('mode:sustained', records, undefined, now).map((r) => r.id)).toEqual(['b']);
  });

  it('date / range', () => {
    expect(resolveRecordSelector('date:2026-11-04', records, undefined, now).map((r) => r.id)).toEqual(['b']);
    expect(resolveRecordSelector('range:2026-11-01..2026-11-04', records, undefined, now).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('多选择器取并集并去重', () => {
    expect(resolveRecordSelectors(['last:2', 'latest'], records, undefined, now).map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('review 范围回退到 week', () => {
    expect(reviewRangeDays(undefined).key).toBe('week');
    expect(reviewRangeDays('today').days).toBe(1);
    expect(reviewRangeDays('all').days).toBe(0);
  });
});

describe('命令补全', () => {
  const tr = (key: string) => key;

  it('命令名补全', () => {
    const items = buildCommandCompletions('/rec', records, tr);
    expect(items.map((i) => i.label)).toContain('/record');
    expect(items.find((i) => i.label === '/record')?.insert).toBe('/record ');
  });

  it('录音模式补全', () => {
    expect(buildCommandCompletions('/record ', records, tr).map((i) => i.label))
      .toEqual(['reading', 'sustained', 'glide']);
    expect(buildCommandCompletions('/record s', records, tr).map((i) => i.label))
      .toEqual(['sustained']);
  });

  it('open 页面与记录 id 补全', () => {
    expect(buildCommandCompletions('/open ', records, tr).map((i) => i.label))
      .toEqual(['analysis', 'records', 'settings']);
    const analysis = buildCommandCompletions('/open analysis ', records, tr);
    expect(analysis.map((i) => i.label)).toContain('latest');
    expect(analysis.some((i) => i.label.startsWith('id:'))).toBe(true);
  });

  it('review 范围与 help 命令补全', () => {
    expect(buildCommandCompletions('/review ', records, tr).map((i) => i.label))
      .toEqual(['today', 'week', 'month', 'all']);
    expect(buildCommandCompletions('/help ', records, tr).map((i) => i.label))
      .toContain('/attach');
  });

  it('attach 选择器按前缀过滤', () => {
    expect(buildCommandCompletions('/attach last:', records, tr).map((i) => i.label))
      .toEqual(['last:5']);
  });
});
