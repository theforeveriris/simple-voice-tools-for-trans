/**
 * Tavily 联网搜索（用户自带 API Key，BYOK）
 *
 * - Key 只存 IndexedDB `web:tavilyKey`，不进入设置导出 / 主题包 / ZIP 备份 / 请求日志
 * - 浏览器直连 Tavily REST（CORS 允许）；不经过任何代理
 * - 搜索 query 会发送给 Tavily；默认关闭，由设置页显式开启
 * - 只取标题 / URL / 摘要，不取 raw content；网页内容在提示词里按不可信资料处理
 */
import { idbDeleteKV, idbGetKV, idbPutKV } from '@/lib/storage/idb';

const KV = 'web:tavilyKey';
const ENDPOINT = 'https://api.tavily.com/search';
const TIMEOUT_MS = 8000;

export interface WebSearchSource {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
}

export interface WebSearchResult {
  query: string;
  sources: WebSearchSource[];
}

export type WebSearchErrorCode =
  | 'no-key'
  | 'invalid-key'
  | 'rate-limit'
  | 'timeout'
  | 'network'
  | 'server'
  | 'bad-response';

export class WebSearchError extends Error {
  readonly code: WebSearchErrorCode;
  readonly status?: number;

  constructor(code: WebSearchErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'WebSearchError';
    this.code = code;
    this.status = status;
  }
}

let cachedKey: string | null = null;
let keyLoaded = false;
const keyListeners = new Set<(key: string | null) => void>();

function emitKey(key: string | null): void {
  for (const listener of keyListeners) listener(key);
}

/** 读取 Tavily Key；首次从 IndexedDB 加载，之后走缓存 */
export async function loadTavilyKey(): Promise<string | null> {
  if (keyLoaded) return cachedKey;
  try {
    cachedKey = (await idbGetKV<string>(KV)) ?? null;
  } catch {
    cachedKey = null;
  }
  keyLoaded = true;
  return cachedKey;
}

export function getCachedTavilyKey(): string | null {
  return cachedKey;
}

export async function saveTavilyKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) throw new Error('empty key');
  await idbPutKV(KV, trimmed);
  cachedKey = trimmed;
  keyLoaded = true;
  emitKey(trimmed);
}

export async function clearTavilyKey(): Promise<void> {
  await idbDeleteKV(KV);
  cachedKey = null;
  keyLoaded = true;
  emitKey(null);
}

/** 订阅 Key 变更（设置页保存后，AI 页无需重新挂载即可看到） */
export function subscribeTavilyKey(listener: (key: string | null) => void): () => void {
  keyListeners.add(listener);
  return () => keyListeners.delete(listener);
}

/** 设置页展示用掩码：保留前缀与末 4 位 */
export function maskTavilyKey(key: string): string {
  if (key.length <= 10) return '••••••';
  return `${key.slice(0, 5)}…${key.slice(-4)}`;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function oneLine(value: string, max = 320): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * 调用 Tavily 搜索。`key` 可显式传入（测试连接 / 工具上下文），
 * 否则读取已保存的 Key。
 */
export async function searchTavily(
  query: string,
  opts: {
    key?: string | null;
    maxResults?: number;
    timeRange?: 'day' | 'week' | 'month' | 'year';
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<WebSearchResult> {
  const trimmed = query.trim();
  if (!trimmed) throw new WebSearchError('bad-response', 'query is empty');
  const key = opts.key ?? await loadTavilyKey();
  if (!key) throw new WebSearchError('no-key', 'Tavily API key is not configured');

  const maxResults = Math.min(5, Math.max(1, Math.round(opts.maxResults ?? 5)));
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: trimmed.slice(0, 500),
        search_depth: 'basic',
        topic: 'general',
        max_results: maxResults,
        include_answer: false,
        include_raw_content: false,
        include_published_date: true,
        ...(opts.timeRange ? { time_range: opts.timeRange } : {}),
      }),
      signal: controller.signal,
    });

    if (res.status === 401 || res.status === 403) {
      throw new WebSearchError('invalid-key', 'Tavily API key is invalid', res.status);
    }
    if (res.status === 429) {
      throw new WebSearchError('rate-limit', 'Tavily rate limit or quota exceeded', res.status);
    }
    if (res.status >= 500) {
      throw new WebSearchError('server', `Tavily server error ${res.status}`, res.status);
    }
    if (!res.ok) {
      throw new WebSearchError('bad-response', `Tavily request failed ${res.status}`, res.status);
    }

    const data = await res.json() as {
      results?: { title?: unknown; url?: unknown; content?: unknown; published_date?: unknown }[];
    };
    const sources: WebSearchSource[] = [];
    for (const raw of data.results ?? []) {
      if (typeof raw.url !== 'string' || !isHttpUrl(raw.url)) continue;
      const title = typeof raw.title === 'string' && raw.title.trim()
        ? oneLine(raw.title, 160)
        : raw.url;
      const snippet = typeof raw.content === 'string' ? oneLine(raw.content) : '';
      sources.push({
        title,
        url: raw.url,
        snippet,
        ...(typeof raw.published_date === 'string' && raw.published_date
          ? { publishedDate: raw.published_date }
          : {}),
      });
      if (sources.length >= maxResults) break;
    }
    return { query: trimmed, sources };
  } catch (err) {
    if (err instanceof WebSearchError) throw err;
    if (timedOut) throw new WebSearchError('timeout', 'Tavily request timed out');
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new WebSearchError('timeout', 'Tavily request aborted');
    }
    throw new WebSearchError('network', err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

/** 设置页「测试连接」：发一次最小搜索，消耗 1 个 credit */
export async function testTavilyKey(key: string): Promise<void> {
  await searchTavily('Simple Voice Tool for Trans', {
    key,
    maxResults: 1,
    timeoutMs: 10000,
  });
}
