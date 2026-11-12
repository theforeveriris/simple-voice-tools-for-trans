import { afterEach, describe, expect, it, vi } from 'vitest';
import { maskTavilyKey, searchTavily, WebSearchError } from './webSearch';

const realFetch = globalThis.fetch;

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = realFetch;
});

function mockFetch(body: unknown, status = 200): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  ));
}

describe('searchTavily', () => {
  it('解析结果并按 maxResults 截断，过滤非 http(s) URL', async () => {
    mockFetch({
      results: [
        { title: 'Result A', url: 'https://example.com/a', content: 'Snippet A', published_date: '2026-01-01' },
        { title: 'Bad', url: 'javascript:alert(1)', content: 'x' },
        { title: 'Result B', url: 'https://example.com/b', content: 'Snippet B' },
      ],
    });
    const result = await searchTavily('query', { key: 'tvly-test', maxResults: 2 });
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0]).toMatchObject({
      title: 'Result A',
      url: 'https://example.com/a',
      publishedDate: '2026-01-01',
    });
    expect(result.sources[1].url).toBe('https://example.com/b');
  });

  it('无 Key 时抛 no-key', async () => {
    await expect(searchTavily('q', { key: '' })).rejects.toMatchObject({ code: 'no-key' });
  });

  it('401 映射为 invalid-key，429 映射为 rate-limit', async () => {
    mockFetch({}, 401);
    await expect(searchTavily('q', { key: 'bad' })).rejects.toBeInstanceOf(WebSearchError);
    mockFetch({}, 429);
    await expect(searchTavily('q', { key: 'bad' })).rejects.toMatchObject({ code: 'rate-limit' });
  });

  it('空结果正常返回空数组', async () => {
    mockFetch({ results: [] });
    const result = await searchTavily('q', { key: 'tvly-test' });
    expect(result.sources).toEqual([]);
  });

  it('掩码保留前缀和末四位', () => {
    expect(maskTavilyKey('tvly-abcdefghijklmnop')).toBe('tvly-…mnop');
    expect(maskTavilyKey('short')).toBe('••••••');
  });
});
