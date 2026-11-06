import { describe, expect, it } from 'vitest';
import type { AnalysisRecord, VoiceStats } from '@/types';
import { buildQuickPrompts, type SuggestTranslate } from './assistantSuggestions';

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
  mode: AnalysisRecord['mode'] = 'reading',
  avgF0 = 160,
): AnalysisRecord {
  return {
    id,
    createdAt,
    durationSec: 10,
    sampleHz: 30,
    series: { t: [0, 1], f0: [150, 170], rmsDb: [-20, -21], f1: [600, 610], f2: [1700, 1710] },
    stats: stats({ avgF0 }),
    mode,
  };
}

/** 假翻译：保留 key 与参数，便于断言分支 */
const tr: SuggestTranslate = (key, params) => (
  params ? `${key}(${Object.values(params).join(',')})` : String(key)
);

const now = new Date(2026, 10, 5, 12).getTime();
const DAY = 86_400_000;

describe('空会话快捷提问', () => {
  it('没有记录时给 4 个通用问题', () => {
    const items = buildQuickPrompts([], tr, now);
    expect(items.map((x) => x.id)).toEqual(['start', 'vfp', 'plan', 'compare']);
    expect(items.every((x) => !!x.text && !!x.hint)).toBe(true);
  });

  it('近 7 天有多条记录时问趋势，并带条数', () => {
    const items = buildQuickPrompts([
      rec('a', now - 1 * DAY),
      rec('b', now - 2 * DAY),
      rec('c', now - 3 * DAY),
    ], tr, now);
    expect(items[0].id).toBe('trend');
    expect(items[0].hint).toContain('assistant.sugg.byRecords');
    expect(items[0].hint).toContain('3');
  });

  it('只有一条记录时退化为「最新一条」提问', () => {
    const items = buildQuickPrompts([rec('a', now - 30 * DAY)], tr, now);
    expect(items[0].id).toBe('trend');
    expect(items[0].text).toBe('assistant.sugg.latest');
    expect(items[0].hint).toBe('assistant.sugg.byLatest');
  });

  it('音高问题取最新一条的平均基频（四舍五入）', () => {
    const items = buildQuickPrompts([
      rec('old', now - 5 * DAY, 'reading', 200),
      rec('new', now - 1 * DAY, 'reading', 139.6),
    ], tr, now);
    const pitch = items.find((x) => x.id === 'pitch');
    expect(pitch?.text).toBe('assistant.sugg.pitch(140)');
    expect(pitch?.hint).toContain('assistant.sugg.byLatestDate');
  });

  it('有两次同模式记录时，对比问题带上模式名', () => {
    const items = buildQuickPrompts([
      rec('a', now - 1 * DAY, 'sustained'),
      rec('b', now - 2 * DAY, 'sustained'),
      rec('c', now - 3 * DAY, 'reading'),
    ], tr, now);
    const compare = items.find((x) => x.id === 'compare');
    expect(compare?.text).toContain('assistant.sugg.compareMode');
    expect(compare?.text).toContain('mode.sustained');
  });

  it('模式都不重复时用通用对比问题', () => {
    const items = buildQuickPrompts([
      rec('a', now - 1 * DAY, 'sustained'),
      rec('b', now - 2 * DAY, 'reading'),
    ], tr, now);
    expect(items.find((x) => x.id === 'compare')?.text).toBe('assistant.sugg.compare');
  });

  it('永远返回 4 个互不重复的 id', () => {
    const items = buildQuickPrompts([
      rec('a', now - 1 * DAY),
      rec('b', now - 2 * DAY),
    ], tr, now);
    expect(items).toHaveLength(4);
    expect(new Set(items.map((x) => x.id)).size).toBe(4);
  });
});
