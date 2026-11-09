import { describe, expect, it } from 'vitest';
import { searchChats } from './chatSearch';
import type { ChatConversation } from './llmChats';

function chat(id: string, title: string, contents: string[], createdAt = Date.UTC(2026, 10, 1)): ChatConversation {
  return {
    id,
    title,
    createdAt,
    updatedAt: createdAt,
    messages: contents.map((content, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content })),
  };
}

describe('searchChats', () => {
  const chats = [
    chat('c1', '六周音高计划', ['我想练音高，每周三次', '可以从长音开始']),
    chat('c2', '共鸣练习', ['上次说的那个共鸣练习是什么？', '用元音 a 做滑音']),
    chat('c3', '饮食记录', ['今天吃了什么', '不建议记录饮食']),
  ];

  it('matches titles and message text', () => {
    expect(searchChats(chats, '音高')[0].chatId).toBe('c1');
    expect(searchChats(chats, '滑音')[0].chatId).toBe('c2');
  });

  it('builds snippets around the match', () => {
    const hit = searchChats(chats, '共鸣练习')[0];
    expect(hit.snippets[0].text).toContain('共鸣');
    expect(hit.snippets[0].role).toBe('user');
  });

  it('excludes the current chat and honors the limit', () => {
    expect(searchChats(chats, '练习', { excludeId: 'c2' }).some((hit) => hit.chatId === 'c2')).toBe(false);
    expect(searchChats(chats, '练习', { limit: 1 })).toHaveLength(1);
  });

  it('returns nothing for an empty query or no match', () => {
    expect(searchChats(chats, '  ')).toEqual([]);
    expect(searchChats(chats, '完全不存在的词')).toEqual([]);
  });
});
