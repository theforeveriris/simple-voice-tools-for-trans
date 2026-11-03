import { describe, it, expect, afterEach } from 'vitest';
import { zhCN } from './zh-CN';
import { zhTW } from './zh-TW';
import { en } from './en';
import { ja } from './ja';
import { lzh } from './lzh';
import { es } from './es';
import { fr } from './fr';
import { LOCALES, localeRemark, t, setLocale } from './index';

/** zh-CN 为基准词典，其余语言直接与它对齐 */
const base = zhCN as unknown as Record<string, string>;
const others: Record<string, Record<string, string>> = {
  'zh-TW': zhTW as unknown as Record<string, string>,
  en: en as unknown as Record<string, string>,
  ja: ja as unknown as Record<string, string>,
  lzh: lzh as unknown as Record<string, string>,
  es: es as unknown as Record<string, string>,
  fr: fr as unknown as Record<string, string>,
};
const baseKeys = Object.keys(base).sort();

describe('词典漂移防护', () => {
  it('每个词典的键集合与 zh-CN 完全一致（无缺失、无多余）', () => {
    for (const [name, dict] of Object.entries(others)) {
      expect(Object.keys(dict).sort(), `${name} 的键集合与 zh-CN 不一致`).toEqual(baseKeys);
    }
  });

  it('每个词条的 {placeholder} 集合与 zh-CN 一致', () => {
    const tokens = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort();
    for (const [key, value] of Object.entries(base)) {
      const expected = tokens(value);
      for (const [name, dict] of Object.entries(others)) {
        expect(tokens(dict[key] ?? ''), `${name}.${key} 的占位符与 zh-CN 不一致`).toEqual(expected);
      }
    }
  });

  it('任何词典都没有空字符串词条', () => {
    for (const dict of [base, ...Object.values(others)]) {
      for (const [key, value] of Object.entries(dict)) {
        expect(value.length, `${key} 为空字符串`).toBeGreaterThan(0);
      }
    }
  });
});

describe('语言清单', () => {
  it('除 ai 外的所有内置语言都在选择器中，且都有词典', () => {
    expect(LOCALES.map((l) => l.id).sort()).toEqual(
      ['zh-CN', 'zh-TW', 'en', 'ja', 'lzh', 'es', 'fr'].sort(),
    );
    expect(new Set(LOCALES.map((l) => l.id)).size).toBe(LOCALES.length);
  });

  it('备注：机器翻译沿用传入文案，自定义备注固定，无备注返回 null', () => {
    const byId = (id: string) => LOCALES.find((l) => l.id === id)!;
    expect(localeRemark(byId('es'), 'MT')).toBe('MT');
    expect(localeRemark(byId('fr'), 'MT')).toBe('MT');
    expect(localeRemark({ note: '自定义' }, 'MT')).toBe('自定义');
    expect(localeRemark(byId('zh-CN'), 'MT')).toBeNull();
    expect(localeRemark(byId('lzh'), 'MT')).toBeNull();
  });
});

describe('t() 占位符插值', () => {
  afterEach(() => {
    setLocale('zh-CN');
  });

  it('setLocale("en") 后 {n} 被替换为参数值', () => {
    setLocale('en');
    expect(t('toast.jsonExported', { n: 5 })).toContain('5');
  });

  it('默认英文界面下 {n} 同样被替换', () => {
    setLocale('en');
    expect(t('toast.jsonExported', { n: 5 })).toContain('5');
  });

  it('AI 词典缺键时回退 zh-CN，命中时优先 AI 译文', async () => {
    const { registerAiDict } = await import('./index');
    registerAiDict('TestAI', { 'common.save': 'SPEICHERN' }, 'de');
    setLocale('ai');
    expect(t('common.save')).toBe('SPEICHERN');
    expect(t('common.cancel')).toBe('取消'); // 未翻译词条回退基准
    setLocale('en');
  });
});
