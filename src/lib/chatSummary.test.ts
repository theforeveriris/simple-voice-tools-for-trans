import { describe, expect, it } from 'vitest';
import { buildLocalSummary, buildSummaryInput, summaryPromptBlock } from './chatSummary';
import type { ChatMessage } from './llmChats';

const messages: ChatMessage[] = [
  { role: 'user', content: '我想练音高，目标是日常说话更稳定。' },
  { role: 'assistant', content: '可以先从长音和朗读开始。' },
  { role: 'user', content: '每周三和周五练，每次十分钟；不要练太高。' },
  { role: 'assistant', content: '已记录：每周两次，每次十分钟。' },
];

describe('chatSummary', () => {
  it('builds a local extractive summary with existing text', () => {
    const text = buildLocalSummary(messages, '【已有摘要】\n用户目标：音高');
    expect(text).toContain('用户目标：音高');
    expect(text).toContain('较早对话');
    expect(text).toContain('音高');
    expect(text).toContain('每周三');
  });

  it('keeps summary input bounded and role-labelled', () => {
    const input = buildSummaryInput(messages, '旧摘要');
    expect(input).toContain('【已有摘要】');
    expect(input).toContain('用户：');
    expect(input).toContain('助手：');
    expect(input.length).toBeLessThanOrEqual(8000);
  });

  it('wraps the summary with conflict guidance', () => {
    const block = summaryPromptBlock('用户目标：音高');
    expect(block).toContain('较早对话摘要');
    expect(block).toContain('以最近消息为准');
    expect(summaryPromptBlock('  ')).toBe('');
  });

  it('caps the local summary length', () => {
    const long = Array.from({ length: 40 }, (_, i) => ({
      role: 'user' as const,
      content: `第 ${i} 条很长的用户消息，`.repeat(20),
    }));
    expect(buildLocalSummary(long).length).toBeLessThanOrEqual(1600);
  });
});
