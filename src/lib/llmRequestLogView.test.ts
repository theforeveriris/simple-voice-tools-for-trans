import { describe, expect, it } from 'vitest';
import { buildRequestView, formatBodySize } from './llmRequestLogView';

function bodyOf(messages: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ model: 'deepseek-flash', temperature: 0.6, messages, ...extra });
}

describe('buildRequestView', () => {
  it('extracts the last user message and pretty-prints the body', () => {
    const body = bodyOf([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: '第一条问题' },
      { role: 'assistant', content: '回答' },
      { role: 'user', content: '请分析 这条\n记录的音高走势' },
    ]);
    const view = buildRequestView(body);
    expect(view.summary).toBe('请分析 这条 记录的音高走势');
    expect(view.userText).toContain('请分析');
    expect(view.pretty).toContain('\n  "model"');
    expect(view.bytes).toBeGreaterThan(0);
  });

  it('handles content blocks and clips a long summary', () => {
    const long = '很长的句子'.repeat(1000);
    const body = bodyOf([
      { role: 'user', content: [{ type: 'text', text: long }] },
    ]);
    const view = buildRequestView(body);
    expect(view.userText).toHaveLength(4000);
    expect(view.summary?.endsWith('…')).toBe(true);
    expect(view.summary!.length).toBeLessThanOrEqual(91);
  });

  it('falls back to prompt when there are no messages', () => {
    const view = buildRequestView(JSON.stringify({ prompt: '翻译这段文字' }));
    expect(view.summary).toBe('翻译这段文字');
  });

  it('keeps the raw text when the body is not JSON', () => {
    const view = buildRequestView('plain text payload');
    expect(view.summary).toBeNull();
    expect(view.userText).toBeNull();
    expect(view.pretty).toBe('plain text payload');
  });
});

describe('formatBodySize', () => {
  it('formats bytes and kilobytes', () => {
    expect(formatBodySize(0)).toBe('0 B');
    expect(formatBodySize(812)).toBe('812 B');
    expect(formatBodySize(1434)).toBe('1.4 KB');
    expect(formatBodySize(22 * 1024)).toBe('22 KB');
  });
});
