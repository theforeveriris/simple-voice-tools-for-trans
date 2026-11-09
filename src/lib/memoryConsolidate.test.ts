import { describe, expect, it } from 'vitest';
import { findConsolidationGroups, parseConsolidatedLines } from './memoryConsolidate';
import type { MemoryItem } from './memory';

function item(id: string, text: string, over: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id,
    text,
    kind: 'preference',
    pinned: false,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe('memoryConsolidate', () => {
  it('groups similar memories within the same scope', () => {
    const groups = findConsolidationGroups([
      item('a', '用户喜欢音高练习'),
      item('b', '用户喜欢音高练习和长音'),
      item('c', '用户喜欢共鸣练习'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('does not merge across chat scopes or skip all-pinned groups', () => {
    const groups = findConsolidationGroups([
      item('a', '用户喜欢音高练习', { scope: 'chat', chatId: 'c1' }),
      item('b', '用户喜欢音高练习', { scope: 'chat', chatId: 'c2' }),
      item('c', '用户喜欢共鸣练习', { pinned: true }),
      item('d', '用户喜欢共鸣练习', { pinned: true }),
    ]);
    expect(groups).toEqual([]);
  });

  it('skips superseded memories', () => {
    expect(findConsolidationGroups([
      item('a', '用户喜欢音高练习', { status: 'superseded' }),
      item('b', '用户喜欢音高练习'),
    ])).toEqual([]);
  });

  it('parses 1–2 clean lines from model output', () => {
    expect(parseConsolidatedLines('1. 用户喜欢音高练习\n- 每周练三次\n多余')) .toEqual([
      '用户喜欢音高练习',
      '每周练三次',
    ]);
    expect(parseConsolidatedLines('  \n')).toEqual([]);
  });
});
