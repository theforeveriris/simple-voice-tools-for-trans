import { describe, expect, it } from 'vitest';
import type { AnalysisRecord, VoiceStats } from '@/types';
import { buildSuggestPrompts, parseSuggestions, suggestFingerprint } from './assistantSuggestAi';

function stats(overrides: Partial<VoiceStats> = {}): VoiceStats {
  return {
    durationSec: 12,
    sampleHz: 30,
    totalSamples: 30,
    voicedSamples: 20,
    avgF0: 140,
    medianF0: 140,
    minF0: 100,
    maxF0: 180,
    p10F0: 110,
    p90F0: 170,
    stdF0: 20,
    malePct: 60,
    femalePct: 30,
    transitionPct: 10,
    avgF1: 415,
    avgF2: 1325,
    f1Range: [400, 430],
    f2Range: [1300, 1350],
    avgDb: -24,
    peakDb: -12,
    jitterPct: 1,
    shimmerPct: 2,
    hnrDb: 18,
    cppsDb: 8,
    ...overrides,
  };
}

function rec(id: string, createdAt: number, avgF0 = 140): AnalysisRecord {
  return {
    id,
    createdAt,
    durationSec: 12,
    sampleHz: 30,
    series: { t: [0, 1], f0: [150, 170], rmsDb: [-20, -21], f1: [600, 610], f2: [1700, 1710] },
    stats: stats({ avgF0 }),
    mode: 'reading',
  };
}

describe('AI 快捷提问提示词', () => {
  const now = new Date(2026, 10, 5, 12).getTime();

  it('把目标、条数与最近记录写进用户消息', () => {
    const { system, user } = buildSuggestPrompts(
      [rec('a', now), rec('b', now - 86_400_000, 150)],
      { userGoal: 'mtf' },
      '简体中文',
    );
    expect(system).toContain('20 个字');
    expect(system).toContain('简体中文');
    expect(system).toContain('JSON');
    expect(user).toContain('女性化（MtF）');
    expect(user).toContain('记录总数：2');
    expect(user).toContain('avgF0 150Hz');
    expect(user).toContain('F2−F1 910Hz');
  });

  it('最多只列 6 条最近的记录，新的在前', () => {
    const records = Array.from({ length: 9 }, (_, i) => rec(`r${i}`, now - i * 1000, 100 + i));
    const { user } = buildSuggestPrompts(records, { userGoal: 'other' }, 'en');
    const lines = user.split('\n').filter((l) => /^\d+\. /.test(l));
    expect(lines).toHaveLength(6);
    expect(lines[0]).toContain('avgF0 100Hz');
    expect(user).toContain('未指定');
  });

  it('指纹随记录内容与目标变化', () => {
    const a = [rec('a', now)];
    const fp1 = suggestFingerprint(a, 'mtf', 'zh-CN');
    const fp2 = suggestFingerprint(a, 'ftm', 'zh-CN');
    const fp3 = suggestFingerprint([rec('a', now, 200)], 'mtf', 'zh-CN');
    const fp4 = suggestFingerprint(a, 'mtf', 'en');
    expect(fp1).not.toBe(fp2);
    expect(fp1).not.toBe(fp3);
    expect(fp1).not.toBe(fp4);
    expect(suggestFingerprint([...a], 'mtf', 'zh-CN')).toBe(fp1);
  });
});

describe('解析模型返回的快捷提问', () => {
  it('解析 JSON 数组并补问号', () => {
    expect(parseSuggestions('["这周音高有变化吗","给我今天的练习计划"]'))
      .toEqual(['这周音高有变化吗？', '给我今天的练习计划？']);
  });

  it('容忍代码块与解释文字', () => {
    const text = '好的：\n```json\n["140 Hz 正常吗？","对比最近两次测试"]\n```';
    expect(parseSuggestions(text)).toEqual(['140 Hz 正常吗？', '对比最近两次测试？']);
  });

  it('非 JSON 时按行解析并去掉编号/引号', () => {
    const text = '1. "这周音高有变化吗"\n- 给我一份练习计划\n• 对比最近两次长音';
    expect(parseSuggestions(text)).toEqual([
      '这周音高有变化吗？',
      '给我一份练习计划？',
      '对比最近两次长音？',
    ]);
  });

  it('过滤空行、过短过长与重复项', () => {
    const text = ['', '哈', '这一周的音高有没有变化呢', '这一周的音高有没有变化呢？', 'x'.repeat(60)].join('\n');
    expect(parseSuggestions(text)).toEqual(['这一周的音高有没有变化呢？']);
  });

  it('最多返回 max 条', () => {
    const text = JSON.stringify(['问题一是什么', '问题二是什么', '问题三是什么', '问题四是什么', '问题五是什么']);
    expect(parseSuggestions(text, 4)).toHaveLength(4);
    expect(parseSuggestions('', 4)).toEqual([]);
  });
});
