import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runAssistantTools } from './assistantAgent';
import { llmChatToolMessages } from './llm';

vi.mock('./llm', () => ({
  llmChatToolMessages: vi.fn(),
  isAbortError: () => false,
}));

describe('runAssistantTools', () => {
  beforeEach(() => {
    vi.mocked(llmChatToolMessages).mockReset();
  });

  it('executes tool calls and returns a context block', async () => {
    vi.mocked(llmChatToolMessages)
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'c1', name: 'query_records', arguments: { mode: 'reading' } }],
      })
      .mockResolvedValueOnce({ content: '', toolCalls: [] });

    const execute = vi.fn().mockResolvedValue({
      text: 'id=r1 ｜ 2026-11-08',
      summary: '查询记录：1 条',
      recordIds: ['r1'],
    });

    const run = await runAssistantTools({
      cfg: { baseUrl: 'http://x', apiKey: 'k', modelId: 'm' } as never,
      system: 'planner',
      history: [],
      userText: '我最近一次怎么样？',
      tools: [{ name: 'query_records', description: 'q', parameters: {} }],
      execute,
    });

    expect(run.supported).toBe(true);
    expect(execute).toHaveBeenCalledWith('query_records', { mode: 'reading' });
    expect(run.traces).toHaveLength(1);
    expect(run.traces[0]).toMatchObject({ name: 'query_records', summary: '查询记录：1 条', ok: true });
    expect(run.contextText).toContain('【本轮工具查询结果】');
    expect(run.contextText).toContain('id=r1');
    expect(run.recordIds).toEqual(['r1']);
    expect(llmChatToolMessages).toHaveBeenCalledTimes(2);
  });

  it('falls back silently when the provider does not support tools', async () => {
    vi.mocked(llmChatToolMessages).mockRejectedValueOnce(new Error('tools unsupported'));
    const run = await runAssistantTools({
      cfg: { baseUrl: 'http://x', apiKey: 'k', modelId: 'm' } as never,
      system: 'planner',
      history: [],
      userText: '你好',
      tools: [{ name: 'query_records', description: 'q', parameters: {} }],
      execute: vi.fn(),
    });
    expect(run.supported).toBe(false);
    expect(run.contextText).toBe('');
  });

  it('records a failed tool without throwing', async () => {
    vi.mocked(llmChatToolMessages)
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'c1', name: 'get_record', arguments: { id: 'x' } }],
      })
      .mockResolvedValueOnce({ content: '', toolCalls: [] });
    const run = await runAssistantTools({
      cfg: { baseUrl: 'http://x', apiKey: 'k', modelId: 'm' } as never,
      system: 'planner',
      history: [],
      userText: '看看这条',
      tools: [{ name: 'get_record', description: 'q', parameters: {} }],
      execute: vi.fn().mockRejectedValue(new Error('boom')),
    });
    expect(run.supported).toBe(true);
    expect(run.traces[0]).toMatchObject({ ok: false, summary: '执行失败' });
    expect(run.contextText).toBe('');
  });

  it('halts after a blocking choice', async () => {
    vi.mocked(llmChatToolMessages).mockResolvedValueOnce({
      content: '',
      toolCalls: [{ id: 'c1', name: 'ask_choice', arguments: { question: 'Pick', options: [{ label: 'A' }, { label: 'B' }] } }],
    });
    const choice = { id: 'ch1', question: 'Pick', selection: 'single' as const, options: [{ id: 'o1', label: 'A' }], allowOther: true, createdAt: 1 };
    const run = await runAssistantTools({
      cfg: { baseUrl: 'http://x', apiKey: 'k', modelId: 'm' } as never,
      system: 'planner',
      history: [],
      userText: 'choose',
      tools: [{ name: 'ask_choice', description: 'q', parameters: {} }],
      execute: vi.fn().mockResolvedValue({ text: 'waiting', summary: '等待用户选择', pendingChoice: choice }),
    });
    expect(run.pendingChoice).toEqual(choice);
    expect(llmChatToolMessages).toHaveBeenCalledTimes(1);
  });
});
