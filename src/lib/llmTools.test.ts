import { describe, expect, it } from 'vitest';
import { parseToolCalls } from './llmClient';

describe('parseToolCalls', () => {
  it('normalizes OpenAI tool_calls and parses JSON arguments', () => {
    const calls = parseToolCalls('openai', {
      choices: [{
        message: {
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'search_memory', arguments: '{"query":"中性 声音"}' },
          }],
        },
      }],
    });
    expect(calls).toEqual([
      { id: 'call_1', name: 'search_memory', arguments: { query: '中性 声音' } },
    ]);
  });

  it('normalizes Anthropic tool_use blocks', () => {
    const calls = parseToolCalls('anthropic', {
      content: [
        { type: 'text', text: '...' },
        { type: 'tool_use', id: 'toolu_1', name: 'search_memory', input: { query: '胸声' } },
      ],
    });
    expect(calls).toEqual([
      { id: 'toolu_1', name: 'search_memory', arguments: { query: '胸声' } },
    ]);
  });

  it('keeps a dirty call with empty args instead of dropping the round', () => {
    const calls = parseToolCalls('openai', {
      choices: [{
        message: {
          tool_calls: [{
            id: 'call_2',
            function: { name: 'search_memory', arguments: 'not-json' },
          }],
        },
      }],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].arguments).toEqual({});
  });

  it('returns no calls for plain text and malformed payloads', () => {
    expect(parseToolCalls('openai', { choices: [{ message: { content: 'NO' } }] })).toEqual([]);
    expect(parseToolCalls('anthropic', { content: [{ type: 'text', text: 'NO' }] })).toEqual([]);
    expect(parseToolCalls('openai', null)).toEqual([]);
    expect(parseToolCalls('anthropic', {})).toEqual([]);
  });
});
