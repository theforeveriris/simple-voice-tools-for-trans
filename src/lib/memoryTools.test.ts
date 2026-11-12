import { describe, expect, it } from 'vitest';
import { buildMemoryWriterInput, parseMemorySaveCall } from './memoryTools';

describe('parseMemorySaveCall', () => {
  it('parses a valid save_memory call', () => {
    expect(parseMemorySaveCall({
      id: 'c1',
      name: 'save_memory',
      arguments: {
        text: '用户偏好中性、偏低的描述，不喜欢「少女音」',
        kind: 'preference',
        pinned: true,
      },
    })).toEqual({
      text: '用户偏好中性、偏低的描述，不喜欢「少女音」',
      kind: 'preference',
      pinned: true,
    });
  });

  it('falls back to fact for an unknown kind and false for a non-boolean pin', () => {
    const out = parseMemorySaveCall({
      id: 'c2',
      name: 'save_memory',
      arguments: { text: '用户习惯晚上十点练习', kind: 'other', pinned: 'yes' },
    });
    expect(out).toEqual({ text: '用户习惯晚上十点练习', kind: 'fact', pinned: false });
  });

  it('rejects empty text and other tools', () => {
    expect(parseMemorySaveCall({ id: 'c3', name: 'save_memory', arguments: { text: '  ' } })).toBeNull();
    expect(parseMemorySaveCall({ id: 'c4', name: 'search_memory', arguments: { text: 'x' } })).toBeNull();
  });
});

describe('buildMemoryWriterInput', () => {
  it('contains the user message and the assistant reply', () => {
    const input = buildMemoryWriterInput('我喜欢中性描述', '我之后会避免少女音。');
    expect(input).toContain('【用户消息】');
    expect(input).toContain('我喜欢中性描述');
    expect(input).toContain('【助手回复】');
    expect(input).toContain('避免少女音');
  });
});
