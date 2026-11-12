import { describe, expect, it } from 'vitest';
import { extractThinkTags, parseTextToolCalls } from './llmTextTools';

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

  it('解析 YAML 风格的 name / arguments', () => {
    const calls = parseTextToolCalls(
      '<tool_call>\nname: run_command\narguments: {"command": "web_search 跨性别女性 声学 F0"}\n</tool_call>',
    );
    expect(calls[0]).toMatchObject({
      name: 'run_command',
      arguments: { command: 'web_search 跨性别女性 声学 F0' },
    });
  });

  it('解析 XML function / arg_key 格式', () => {
    const calls = parseTextToolCalls(
      '<tool_call>\n<function=run_command>\n<arg_key>command</arg_key>\n<arg_value>web_search</arg_value>\n<arg_key>query</arg_key>\n<arg_value>跨性别女性声学数据</arg_value>\n</function>\n</tool_call>',
    );
    expect(calls[0]).toMatchObject({
      name: 'run_command',
      arguments: { command: 'web_search', query: '跨性别女性声学数据' },
    });
  });

  it('去掉正文里的 think 标签并保留思考内容', () => {
    const parsed = extractThinkTags('说明<think>内部推理</think>答案<think>补充</think>');
    expect(parsed.text).toBe('说明答案');
    expect(parsed.think).toContain('内部推理');
    expect(parsed.think).toContain('补充');
  });

  it('普通文本不误判', () => {
    expect(parseTextToolCalls('没有工具调用')).toEqual([]);
    expect(parseTextToolCalls('<tool_call>not a call</tool_call>')).toEqual([]);
  });
});
