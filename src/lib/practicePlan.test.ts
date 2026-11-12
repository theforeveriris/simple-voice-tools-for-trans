import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisRecord } from '@/types';

const h = vi.hoisted(() => ({ stored: null as unknown }));
vi.mock('@/lib/storage/idb', () => ({
  idbGetKV: async () => h.stored ?? undefined,
  idbPutKV: async (_key: string, value: unknown) => {
    h.stored = value;
  },
}));

async function fresh() {
  vi.resetModules();
  return import('./practicePlan');
}

function record(over: Partial<AnalysisRecord> = {}): AnalysisRecord {
  return {
    id: 'r1',
    createdAt: Date.now(),
    durationSec: 60,
    sampleHz: 30,
    series: { t: [], f0: [], rmsDb: [], f1: [], f2: [] },
    stats: { durationSec: 60 } as never,
    mode: 'sustained',
    ...over,
  };
}

beforeEach(() => {
  h.stored = null;
});

describe('practice plan', () => {
  it('creates a plan with default steps and tracks weekly progress', async () => {
    const m = await fresh();
    const plan = m.createPracticePlan({ title: '六周音高', focus: 'pitch', weeks: 6, daysPerWeek: 3, minutesPerSession: 10 });
    expect(plan.steps.length).toBe(3);
    const p0 = m.planProgress(plan, []);
    expect(p0).toMatchObject({ done: 0, target: 3, pct: 0 });
    expect(p0.nextStep?.id).toBe('s1');

    const log = m.logPractice({ stepId: 's1', at: Date.now() });
    expect(log).not.toBeNull();
    expect(m.planProgress(plan, m.getPracticePlanState().logs).done).toBe(1);
    expect(m.logPractice({ stepId: 's1', at: Date.now() })).toBeNull();
    expect(m.planSummaryForPrompt(plan, m.getPracticePlanState().logs)).toContain('本周完成：1/3');
  });

  it('updates and clears the active plan', async () => {
    const m = await fresh();
    m.createPracticePlan({ title: 'A', focus: 'habit', weeks: 4, daysPerWeek: 2, minutesPerSession: 5 });
    const next = m.updatePracticePlan({ title: 'B', status: 'paused' });
    expect(next?.title).toBe('B');
    expect(next?.status).toBe('paused');
    m.clearPracticePlan();
    expect(m.getPracticePlanState().plan).toBeNull();
  });

  it('auto-logs a matching recording and parks non-matching ones', async () => {
    const m = await fresh();
    m.createPracticePlan({ title: 'P', focus: 'pitch', weeks: 4, daysPerWeek: 3, minutesPerSession: 10 });
    expect(m.autoLogPracticeForRecord(record())).toBe('logged');
    expect(m.getPracticePlanState().logs).toHaveLength(1);
    expect(m.autoLogPracticeForRecord(record({ id: 'r2', mode: 'reading' }))).toBe('pending');
    expect(m.getPracticePlanState().pendingRecordId).toBe('r2');
    m.setPendingPracticeRecord(undefined);
    expect(m.getPracticePlanState().pendingRecordId).toBeUndefined();
  });
});
