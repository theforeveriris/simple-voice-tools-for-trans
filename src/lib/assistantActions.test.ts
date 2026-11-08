import { describe, expect, it } from 'vitest';
import type { AnalysisRecord, AppSettings } from '@/types';
import { createAssistantAction } from './assistantActions';

const settings = {
  targetF0Min: 120,
  targetF0Max: 220,
  targetEnabled: false,
  baselineRecordId: undefined,
  assistantWrites: 'confirm',
} as unknown as AppSettings;

const record = {
  id: 'r1',
  createdAt: Date.UTC(2026, 10, 8, 10),
  mode: 'reading',
  stats: {},
} as unknown as AnalysisRecord;

const ctx = { settings, records: [record] };

describe('createAssistantAction', () => {
  it('creates a target change with before snapshot', () => {
    const res = createAssistantAction('setTarget', { min: 165, max: 255 }, ctx);
    expect(res.error).toBeUndefined();
    expect(res.action?.kind).toBe('setTarget');
    expect(res.action?.args).toEqual({ min: 165, max: 255 });
    expect(res.action?.before).toMatchObject({ min: 120, max: 220, enabled: false });
    expect(res.action?.summary).toContain('120–220 Hz → 165–255 Hz');
  });

  it('rejects invalid target ranges', () => {
    expect(createAssistantAction('setTarget', { min: 300, max: 200 }, ctx).error).toContain('目标音高');
    expect(createAssistantAction('setTarget', { min: 10, max: 500 }, ctx).error).toContain('目标音高');
  });

  it('sets an existing record as baseline', () => {
    const res = createAssistantAction('setBaseline', { recordId: 'r1' }, ctx);
    expect(res.action?.kind).toBe('setBaseline');
    expect(res.action?.summary).toContain('2026/11/8');
    expect(createAssistantAction('setBaseline', { recordId: 'missing' }, ctx).error).toContain('没有找到');
  });

  it('creates an export action and rejects empty ranges', () => {
    const res = createAssistantAction('export', { scope: 'last7' }, ctx);
    expect(res.action?.kind).toBe('export');
    expect(res.action?.summary).toContain('1 条');
    expect(createAssistantAction('export', { scope: 'last7' }, { settings, records: [] }).error).toContain('没有记录');
  });

  it('respects the write permission setting', () => {
    const off = { ...ctx, settings: { ...settings, assistantWrites: 'off' } as unknown as AppSettings };
    expect(createAssistantAction('setTarget', { min: 150, max: 250 }, off).error).toContain('关闭');
  });
});
