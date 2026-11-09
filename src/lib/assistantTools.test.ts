import { describe, expect, it } from 'vitest';
import type { AnalysisRecord, VoiceStats } from '@/types';
import { runAssistantDataTool } from './assistantTools';

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

function record(id: string, createdAt: number, mode: AnalysisRecord['mode'], overrides: Partial<VoiceStats> = {}): AnalysisRecord {
  return {
    id,
    createdAt,
    durationSec: 30,
    sampleHz: 30,
    series: { t: [], f0: [], rmsDb: [], f1: [], f2: [] },
    stats: stats(overrides),
    mode,
  };
}

const ctx = {
  records: [
    record('a', Date.UTC(2026, 10, 1, 10), 'reading', { medianF0: 160, inTargetPct: 60 }),
    record('b', Date.UTC(2026, 10, 3, 10), 'sustained', { medianF0: 175, inTargetPct: 80 }),
    record('c', Date.UTC(2026, 10, 5, 10), 'reading', { medianF0: 180, inTargetPct: 85 }),
  ],
  settings: { targetEnabled: true, targetF0Min: 165, targetF0Max: 255 },
};

describe('runAssistantDataTool', () => {
  it('queries records by mode and returns newest first', async () => {
    const out = await runAssistantDataTool('query_records', { mode: 'reading' }, ctx);
    expect(out).not.toBeNull();
    expect(out!.summary).toBe('查询记录：2 条');
    expect(out!.recordIds).toEqual(['c', 'a']);
    expect(out!.text).toContain('id=c');
    expect(out!.text).toContain('id=a');
    expect(out!.text).not.toContain('id=b');
  });

  it('limits results and reports the total', async () => {
    const out = await runAssistantDataTool('query_records', { limit: 1 }, ctx);
    expect(out!.text).toContain('共 3 条');
    expect(out!.recordIds).toEqual(['c']);
    expect(out!.text).toContain('还有 2 条未显示');
  });

  it('returns record details and chart kinds', async () => {
    const out = await runAssistantDataTool('get_record', { id: 'b' }, ctx);
    expect(out!.summary).toBe('读取记录：1 条');
    expect(out!.text).toContain('记录 id=b');
    expect(out!.text).toContain('可用图表：pitch / formant / energy / vowel');
  });

  it('compares two records', async () => {
    const out = await runAssistantDataTool('compare_records', { a: 'a', b: 'b' }, ctx);
    expect(out!.summary).toBe('对比记录：2 条');
    expect(out!.text).toContain('F0 中位：160 → 175 Hz（+15）');
    expect(out!.text).toContain('靶标命中率：60 → 80 %（+20）');
    expect(out!.recordIds).toEqual(['a', 'b']);
  });

  it('marks small deltas as measurement noise', async () => {
    const closeCtx = {
      ...ctx,
      records: [
        record('a', Date.UTC(2026, 10, 1, 10), 'reading', { medianF0: 160 }),
        record('b', Date.UTC(2026, 10, 3, 10), 'reading', { medianF0: 166 }),
      ],
    };
    const out = await runAssistantDataTool('compare_records', { a: 'a', b: 'b' }, closeCtx);
    expect(out!.text).toContain('基本持平，在测量波动范围内');
  });

  it('computes trends with code-side stats', async () => {
    const out = await runAssistantDataTool('get_trends', { metric: 'f0', lastN: 2 }, ctx);
    expect(out!.summary).toBe('趋势：F0 中位 · 2 条');
    expect(out!.text).toContain('均值 177.5 Hz');
    expect(out!.text).toContain('记录 id：b, c');

    const previous = await runAssistantDataTool('get_trends', { metric: 'f0', lastN: 2, compare: 'previous' }, ctx);
    expect(previous!.text).toContain('均值相比上一周期 +17.5 Hz');

    const withBaseline = {
      ...ctx,
      settings: { ...ctx.settings, baselineRecordId: 'a' },
    };
    const baseline = await runAssistantDataTool('get_trends', { metric: 'f0', lastN: 2, compare: 'baseline' }, withBaseline);
    expect(baseline!.text).toContain('均值相比基线 +17.5 Hz');
  });

  it('reports invalid trend metrics', async () => {
    const out = await runAssistantDataTool('get_trends', { metric: 'pitch' }, ctx);
    expect(out!.summary).toBe('趋势：参数无效');
    expect(out!.text).toContain('metric 无效');
  });

  it('searches related conversations and returns chat refs', async () => {
    const withChats = {
      ...ctx,
      chats: [
        {
          id: 'c1',
          title: '六周音高计划',
          createdAt: Date.UTC(2026, 10, 1),
          updatedAt: Date.UTC(2026, 10, 1),
          messages: [
            { role: 'user' as const, content: '上次说的音高练习是什么？' },
            { role: 'assistant' as const, content: '从长音开始。' },
          ],
        },
      ],
      currentChatId: 'current',
    };
    const out = await runAssistantDataTool('search_chats', { query: '音高练习' }, withChats);
    expect(out!.summary).toBe('参考对话：1 个');
    expect(out!.text).toContain('六周音高计划');
    expect(out!.chatRefs?.[0]).toMatchObject({ chatId: 'c1', messageIndex: 0 });
  });

  it('handles unknown ids and empty queries', async () => {
    expect((await runAssistantDataTool('get_record', { id: 'missing' }, ctx))!.summary).toBe('读取记录：未找到');
    expect((await runAssistantDataTool('query_records', { from: '2030-01-01' }, ctx))!.summary).toBe('查询记录：0 条');
    expect((await runAssistantDataTool('search_docs', { query: '  ' }, ctx))!.summary).toBe('读取文档：0 篇');
  });

  it('returns null for unknown tools', async () => {
    expect(await runAssistantDataTool('drop_database', {}, ctx)).toBeNull();
  });
});
