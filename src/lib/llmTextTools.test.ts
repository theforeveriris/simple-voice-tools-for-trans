import { describe, expect, it } from 'vitest';
import { parseTextToolCalls } from './llmTextTools';

describe('parseTextToolCalls', () => {
  it('解析函数调用式文本并转换 kwargs', () => {
    const calls = parseTextToolCalls(
      "只使用 get_stats：<tool_call>get_stats(mode='朗读', range='last_7d')</tool_call>",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      name: 'get_stats',
      arguments: { mode: '朗读', range: 'last_7d' },
    });
  });

  it('解析 JSON 形式的工具调用', () => {
    const calls = parseTextToolCalls(
      '<tool_call>{"name":"get_context","arguments":{}}</tool_call>',
    );
    expect(calls[0]).toMatchObject({ name: 'get_context', arguments: {} });
  });

  it('解析 function 包裹的 JSON', () => {
    const calls = parseTextToolCalls(
      '<tool_call>{"function":{"name":"get_stats","arguments":"{\\"selector\\":\\"week\\"}"}}</tool_call>',
    );
    expect(calls[0]).toMatchObject({ name: 'get_stats', arguments: { selector: 'week' } });
  });

  it('支持多个调用、数字与布尔参数', () => {
    const calls = parseTextToolCalls(
      '<tool_call>get_stats(lastN=3, all=true)</tool_call>\n<tool_call>get_context()</tool_call>',
    );
    expect(calls).toHaveLength(2);
    expect(calls[0].arguments).toEqual({ lastN: 3, all: true });
    expect(calls[1].arguments).toEqual({});
  });

  it('普通文本不误判', () => {
    expect(parseTextToolCalls('没有工具调用')).toEqual([]);
    expect(parseTextToolCalls('<tool_call>not a call</tool_call>')).toEqual([]);
  });
});
