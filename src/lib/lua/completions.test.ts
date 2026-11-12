import { describe, expect, it } from 'vitest';
import { buildLuaFilterCompletions } from './completions';

const sample = {
  mode: 'sustained',
  note: '晨间练习',
  durationSec: 12,
  dateStr: '2026/11/9 14:04',
  stats: {
    avgF0: 145.26,
    medianF0: 143.2,
    inTargetPct: 82,
    avgF1: null,
  },
};

describe('buildLuaFilterCompletions', () => {
  it('输入 lua → 给出 lua: 前缀和示例', () => {
    const items = buildLuaFilterCompletions('lua');
    expect(items[0]).toMatchObject({ kind: 'prefix', insert: 'lua:' });
    expect(items.some((i) => i.kind === 'example')).toBe(true);
  });

  it('输入 lua: → 示例 + 字段（常用字段在前）', () => {
    const items = buildLuaFilterCompletions('lua:');
    expect(items.some((i) => i.kind === 'example')).toBe(true);
    expect(items.find((i) => i.label === 'stats.avgF0')?.kind).toBe('field');
    expect(items.find((i) => i.label === 'record.mode')?.kind).toBe('field');
  });

  it('字段前缀过滤，且只替换末尾 token', () => {
    const items = buildLuaFilterCompletions('lua:stats.avgF0 < 150 and stats.m');
    expect(items.some((i) => i.label === 'stats.medianF0')).toBe(true);
    expect(items.every((i) => i.kind === 'field')).toBe(true);
    const item = items.find((i) => i.label === 'stats.medianF0')!;
    expect(item.insert).toBe('lua:stats.avgF0 < 150 and stats.medianF0 ');
  });

  it('record 字段前缀', () => {
    const items = buildLuaFilterCompletions('lua:record.m');
    expect(items.map((i) => i.label)).toContain('record.mode');
  });

  it('末尾是空格 / 运算符 / 数字时不弹字段菜单', () => {
    expect(buildLuaFilterCompletions('lua:stats.avgF0 ')).toEqual([]);
    expect(buildLuaFilterCompletions('lua:stats.avgF0 < ')).toEqual([]);
    expect(buildLuaFilterCompletions('lua:stats.avgF0 < 150')).toEqual([]);
  });

  it('非 lua 查询不弹补全', () => {
    expect(buildLuaFilterCompletions('')).toEqual([]);
    expect(buildLuaFilterCompletions('hello')).toEqual([]);
    expect(buildLuaFilterCompletions('lua something')).toEqual([]);
  });

  it('字段项带当前记录的示例值', () => {
    const avg = buildLuaFilterCompletions('lua:stats.avgF0', sample).find((i) => i.label === 'stats.avgF0');
    expect(avg?.detail).toBe('145.3');
    const mode = buildLuaFilterCompletions('lua:record.mode', sample).find((i) => i.label === 'record.mode');
    expect(mode?.detail).toBe('sustained');
    const nullField = buildLuaFilterCompletions('lua:stats.avgF1', sample).find((i) => i.label === 'stats.avgF1');
    expect(nullField?.detail).toBeUndefined();
  });

  it('示例选中后写入完整表达式', () => {
    const example = buildLuaFilterCompletions('lua:').find((i) => i.kind === 'example')!;
    expect(example.insert.startsWith('lua:')).toBe(true);
    expect(example.label).toBe(example.insert);
  });
});
