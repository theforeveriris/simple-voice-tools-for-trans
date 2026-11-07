import { describe, expect, it } from 'vitest';
import {
  extractMemoryCandidates,
  memoryPromptBlock,
  selectMemories,
  type MemoryItem,
  type MemoryKind,
} from './memory';

function item(id: string, text: string, over: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id,
    text,
    kind: 'fact' as MemoryKind,
    pinned: false,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe('selectMemories', () => {
  it('puts pinned items first even without keyword hits', () => {
    const list = [
      item('a', '平时用胸声说话'),
      item('b', '不要用「少女音」形容', { pinned: true }),
    ];
    const picked = selectMemories(list, '今天练什么');
    expect(picked.map((m) => m.id)).toEqual(['b']);
  });

  it('ranks unpinned items by query overlap', () => {
    const list = [
      item('a', '我的音域偏低'),
      item('b', '我正在准备面试'),
    ];
    const picked = selectMemories(list, '帮我看一下音域');
    expect(picked.map((m) => m.id)).toEqual(['a']);
  });

  it('stops before exceeding the character budget', () => {
    const long = 'x'.repeat(300);
    const picked = selectMemories([item('a', long), item('b', long)], 'xx', 400);
    expect(picked).toHaveLength(1);
  });
});

describe('memoryPromptBlock', () => {
  it('returns an empty string with no items', () => {
    expect(memoryPromptBlock([])).toBe('');
  });

  it('labels each kind and keeps the raw text', () => {
    const block = memoryPromptBlock([
      item('a', '声音偏中性', { kind: 'fact' }),
      item('b', '不要用「少女音」', { kind: 'caution' }),
    ]);
    expect(block).toContain('[事实] 声音偏中性');
    expect(block).toContain('[注意] 不要用「少女音」');
    expect(block).toContain('【关于用户的长期记忆】');
  });
});

describe('extractMemoryCandidates', () => {
  it('keeps cued statements and infers the kind', () => {
    const out = extractMemoryCandidates([
      '我想问一下这周的练习。以后都用胸声说话。不要再用「少女音」这个词了。',
      '今天天气不错。',
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].text).toBe('以后都用胸声说话');
    expect(out[0].kind).toBe('requirement');
    expect(out[1].kind).toBe('caution');
  });

  it('deduplicates identical statements', () => {
    const out = extractMemoryCandidates(['请记住我的音域偏低。请记住我的音域偏低。']);
    expect(out).toHaveLength(1);
  });

  it('drops very short or overlong segments', () => {
    const out = extractMemoryCandidates(['记住。', `记住${'很长的句子'.repeat(50)}`]);
    expect(out).toHaveLength(0);
  });

  it('skips bare commands and questions', () => {
    const out = extractMemoryCandidates(['记住这个。我的名字是什么？']);
    expect(out).toHaveLength(0);
  });

  it('recognizes English cues', () => {
    const out = extractMemoryCandidates(['Please remember that I prefer a neutral voice.']);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('requirement');
  });
});
