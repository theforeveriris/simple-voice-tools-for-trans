import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { parseGlossary, buildAiLocalePayload, parseAiLocalePayload, aiSlug, loadAiCache } from './aiLocale';
import { zhCN } from './zh-CN';

// 不加载真实 i18n / 网络层：只验证 aiLocale 自身的行为
vi.mock('./index', () => ({ registerAiDict: vi.fn() }));
vi.mock('@/lib/llm', () => ({ llmChat: vi.fn() }));

function mockStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    map: m,
  };
}

let storage = mockStorage();

beforeEach(() => {
  storage = mockStorage();
  vi.stubGlobal('localStorage', storage);
  vi.clearAllMocks();
});

const base = zhCN as unknown as Record<string, string>;
const baseKeys = Object.keys(base);
const sampleKey = baseKeys[0];
const sampleValue = base[sampleKey];

describe('parseGlossary', () => {
  it('支持 = / → / : 三种分隔与空行忽略', () => {
    expect(parseGlossary('共振峰 = formant\n嗓音 → voice\n基频: pitch')).toEqual([
      ['共振峰', 'formant'],
      ['嗓音', 'voice'],
      ['基频', 'pitch'],
    ]);
  });

  it('残缺行与空输入忽略', () => {
    expect(parseGlossary('只有一边\n\n  = 空 \n正常 = ok')).toEqual([['正常', 'ok']]);
    expect(parseGlossary(undefined)).toEqual([]);
    expect(parseGlossary('')).toEqual([]);
  });
});

describe('aiSlug', () => {
  it('拉丁显示名归一为小写连字符（既有缓存键保持不变）', () => {
    expect(aiSlug('Deutsch')).toBe('deutsch');
    expect(aiSlug(' 简体 中文 ')).not.toContain(' ');
    expect(aiSlug('Brazilian Portuguese')).toBe('brazilian-portuguese');
  });

  it('非拉丁显示名各自得到不同键（不再一律塌到 custom）', () => {
    const ja = aiSlug('日本語');
    const ko = aiSlug('한국어');
    const ru = aiSlug('Русский');
    expect(ja).not.toBe('custom');
    expect(new Set([ja, ko, ru]).size).toBe(3);
    // 同一显示名稳定
    expect(aiSlug('日本語')).toBe(ja);
    expect(aiSlug(' 日本語 ')).toBe(ja);
  });
});

describe('loadAiCache', () => {
  it('显示名不符的缓存视为未命中（防撞键读到别的语言）', () => {
    storage.setItem('svt:i18n-ai:custom-abc', JSON.stringify({
      label: '한국어', dict: { a: 'b' }, model: 'm', at: 1,
    }));
    expect(loadAiCache('日本語')).toBeNull();
  });

  it('兼容旧版 custom 键，但仍校验显示名', () => {
    storage.setItem('svt:i18n-ai:custom', JSON.stringify({
      label: '日本語', dict: { [sampleKey]: 'テスト' }, model: 'm', at: 1,
    }));
    expect(loadAiCache('日本語')?.dict[sampleKey]).toBe('テスト');
    expect(loadAiCache('한국어')).toBeNull();
  });

  it('损坏的 JSON 不影响使用（返回 null）', () => {
    storage.setItem(`svt:i18n-ai:${aiSlug('Deutsch')}`, '{oops');
    expect(loadAiCache('Deutsch')).toBeNull();
  });
});

describe('词典分享 payload', () => {
  it('build → parse 往返一致', () => {
    const cache = { label: 'Deutsch', dict: { [sampleKey]: 'Übersetzung' }, model: 'test-model', at: 12345 };
    const json = JSON.stringify(buildAiLocalePayload(cache));
    const parsed = parseAiLocalePayload(json);
    expect(parsed.label).toBe('Deutsch');
    expect(parsed.dict[sampleKey]).toBe('Übersetzung');
    expect(parsed.model).toBe('test-model');
    expect(parsed.at).toBe(12345);
  });

  it('dict 中不属于基准的键被过滤', () => {
    const cache = { label: 'X', dict: { [sampleKey]: sampleValue, bogusKey: 'x' }, model: 'm', at: 1 };
    const parsed = parseAiLocalePayload(JSON.stringify(buildAiLocalePayload(cache)));
    expect(parsed.dict[sampleKey]).toBe(sampleValue);
    expect('bogusKey' in parsed.dict).toBe(false);
  });

  it('kind / app / 版本过新 / 缺 label 均拒绝', () => {
    const good = buildAiLocalePayload({ label: 'X', dict: {}, model: 'm', at: 1 });
    expect(() => parseAiLocalePayload(JSON.stringify({ ...good, kind: 'records' }))).toThrow();
    expect(() => parseAiLocalePayload(JSON.stringify({ ...good, app: 'other' }))).toThrow();
    expect(() => parseAiLocalePayload(JSON.stringify({ ...good, version: 99 }))).toThrow();
    expect(() => parseAiLocalePayload(JSON.stringify({ ...good, label: '  ' }))).toThrow();
    expect(() => parseAiLocalePayload('not json')).toThrow();
  });

  it('历史 app 标识（旧名）→ 仍接受', () => {
    const good = buildAiLocalePayload({ label: 'X', dict: {}, model: 'm', at: 1 });
    expect(() => parseAiLocalePayload(JSON.stringify({ ...good, app: 'simple-voice-tools' }))).not.toThrow();
  });
});

describe('分批翻译的中途取消', () => {
  it('取消后已完成批次仍留在缓存中（下次增量补全接着来）', async () => {
    const { llmChat } = await import('@/lib/llm');
    const { generateAiLocale } = await import('./aiLocale');
    const cfg = {
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      modelId: 'm1',
      protocol: 'openai',
      stream: false,
      contextTokens: 8192,
    } as Parameters<typeof generateAiLocale>[1];

    const ac = new AbortController();
    let calls = 0;
    (llmChat as unknown as Mock).mockImplementation(async (_cfg, _system, user: string) => {
      calls++;
      if (calls >= 2) throw new DOMException('aborted', 'AbortError');
      const batch = JSON.parse(user) as Record<string, string>;
      return JSON.stringify(Object.fromEntries(Object.keys(batch).map((k) => [k, `T:${k}`])));
    });

    await expect(generateAiLocale('Testish', cfg, undefined, { signal: ac.signal })).rejects.toBeInstanceOf(DOMException);

    const cache = loadAiCache('Testish');
    expect(cache).not.toBeNull();
    // 首批 90 条已落盘（BATCH = 90），其余留待补全
    expect(Object.keys(cache?.dict ?? {}).length).toBe(90);
    expect(cache?.dict[baseKeys[0]]).toBe(`T:${baseKeys[0]}`);
    expect(Object.keys(cache?.dict ?? {}).length).toBeLessThan(baseKeys.length);
  });
});
