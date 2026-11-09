import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runAssistantTools } from './assistantAgent';
import { llmChatToolMessages } from './llm';

vi.mock('./llm', () => ({
  llmChatToolMessages: vi.fn(),
  isAbortError: (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError',
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
    expect(execute).toHaveBeenCalledWith('query_records', { mode: 'reading' }, { signal: undefined });
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

  it('halts after a multi-question card', async () => {
    vi.mocked(llmChatToolMessages).mockResolvedValueOnce({
      content: '',
      toolCalls: [{ id: 'c1', name: 'ask_choice_set', arguments: { questions: [] } }],
    });
    const set = {
      id: 'set1',
      createdAt: 1,
      questions: [
        { id: 'q1', question: 'A?', selection: 'single' as const, options: [{ id: 'o1', label: 'A' }], allowOther: true },
        { id: 'q2', question: 'B?', selection: 'single' as const, options: [{ id: 'o1', label: 'B' }], allowOther: true },
      ],
    };
    const run = await runAssistantTools({
      cfg: { baseUrl: 'http://x', apiKey: 'k', modelId: 'm' } as never,
      system: 'planner',
      history: [],
      userText: 'ask me a few',
      tools: [{ name: 'ask_choice_set', description: 'q', parameters: {} }],
      execute: vi.fn().mockResolvedValue({ text: 'waiting', summary: '等待回答', pendingChoiceSet: set }),
    });
    expect(run.pendingChoiceSet).toEqual(set);
    expect(llmChatToolMessages).toHaveBeenCalledTimes(1);
  });

  it('runs read-only tools in parallel and preserves result order', async () => {
    vi.mocked(llmChatToolMessages)
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          { id: 'c1', name: 'query_records', arguments: {} },
          { id: 'c2', name: 'get_record', arguments: { id: 'r1' } },
        ],
      })
      .mockResolvedValueOnce({ content: '', toolCalls: [] });

    const started: string[] = [];
    const resolvers: (() => void)[] = [];
    const execute = vi.fn((name: string) => new Promise<{ text: string; summary: string }>((resolve) => {
      started.push(name);
      resolvers.push(() => resolve({ text: `${name}-result`, summary: `${name}-summary` }));
    }));

    const runPromise = runAssistantTools({
      cfg: { baseUrl: 'http://x', apiKey: 'k', modelId: 'm' } as never,
      system: 'planner',
      history: [],
      userText: '最近几次怎么样？',
      tools: [
        { name: 'query_records', description: 'q', parameters: {} },
        { name: 'get_record', description: 'q', parameters: {} },
      ],
      execute,
    });

    await vi.waitFor(() => expect(started).toHaveLength(2));
    expect(started).toEqual(['query_records', 'get_record']);
    resolvers.forEach((resolve) => resolve());
    const run = await runPromise;
    expect(run.traces.map((trace) => trace.name)).toEqual(['query_records', 'get_record']);
    expect(run.contextText.indexOf('query_records-result')).toBeLessThan(run.contextText.indexOf('get_record-result'));
  });

  it('times out a hanging tool and keeps the loop alive', async () => {
    vi.mocked(llmChatToolMessages)
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'c1', name: 'query_records', arguments: {} }],
      })
      .mockResolvedValueOnce({ content: '', toolCalls: [] });

    const run = await runAssistantTools({
      cfg: { baseUrl: 'http://x', apiKey: 'k', modelId: 'm' } as never,
      system: 'planner',
      history: [],
      userText: '查一下',
      tools: [{ name: 'query_records', description: 'q', parameters: {} }],
      execute: vi.fn((): Promise<never> => new Promise(() => {})),
      toolTimeoutMs: 15,
    });

    expect(run.traces[0]).toMatchObject({ name: 'query_records', ok: false });
    expect(run.traces[0].summary).toContain('工具超时');
    expect(llmChatToolMessages).toHaveBeenCalledTimes(2);
  });

  it('aborts a running tool immediately when the signal fires', async () => {
    vi.mocked(llmChatToolMessages).mockResolvedValueOnce({
      content: '',
      toolCalls: [{ id: 'c1', name: 'query_records', arguments: {} }],
    });
    const controller = new AbortController();
    const execute = vi.fn((): Promise<never> => new Promise(() => {}));
    const runPromise = runAssistantTools({
      cfg: { baseUrl: 'http://x', apiKey: 'k', modelId: 'm' } as never,
      system: 'planner',
      history: [],
      userText: '查一下',
      tools: [{ name: 'query_records', description: 'q', parameters: {} }],
      execute,
      signal: controller.signal,
      toolTimeoutMs: 5_000,
    });

    await vi.waitFor(() => expect(execute).toHaveBeenCalled());
    controller.abort();
    await expect(runPromise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('reports invalid args and lets the model repair once', async () => {
    const spec = {
      name: 'get_record',
      description: 'q',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    };
    vi.mocked(llmChatToolMessages)
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'c1', name: 'get_record', arguments: {} }],
      })
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'c2', name: 'get_record', arguments: { id: 'r1' } }],
      })
      .mockResolvedValueOnce({ content: '', toolCalls: [] });

    const execute = vi.fn().mockResolvedValue({ text: 'record r1', summary: '记录：1 条' });
    const run = await runAssistantTools({
      cfg: { baseUrl: 'http://x', apiKey: 'k', modelId: 'm' } as never,
      system: 'planner',
      history: [],
      userText: '看看这条',
      tools: [spec],
      execute,
    });

    expect(run.traces).toHaveLength(2);
    expect(run.traces[0]).toMatchObject({ name: 'get_record', ok: false });
    expect(run.traces[0].summary).toContain('参数无效');
    expect(run.traces[1]).toMatchObject({ name: 'get_record', ok: true });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('get_record', { id: 'r1' }, { signal: undefined });
  });

  it('reports an unknown tool without executing it', async () => {
    vi.mocked(llmChatToolMessages)
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'c1', name: 'nope', arguments: {} }],
      })
      .mockResolvedValueOnce({ content: '', toolCalls: [] });

    const execute = vi.fn();
    const run = await runAssistantTools({
      cfg: { baseUrl: 'http://x', apiKey: 'k', modelId: 'm' } as never,
      system: 'planner',
      history: [],
      userText: '试试',
      tools: [{ name: 'query_records', description: 'q', parameters: {} }],
      execute,
    });

    expect(execute).not.toHaveBeenCalled();
    expect(run.traces[0].summary).toContain('未知工具');
    expect(run.traces[0].ok).toBe(false);
  });
});
