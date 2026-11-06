/**
 * i18n 核心（不依赖 React / store，任何模块可直接调用 t()）
 * 简体中文为基准词典；其余语言缺译时回退 zh-CN。
 * 另支持 AI 翻译语言（registerAiDict 注入的运行时词典，见 aiLocale.ts）。
 */

import type { Locale } from '@/types';
import { zhCN } from './zh-CN';
import { zhTW } from './zh-TW';
import { en } from './en';
import { ja } from './ja';
import { lzh } from './lzh';
import { es } from './es';
import { fr } from './fr';

export type DictKey = keyof typeof zhCN;
type Dict = Partial<Record<DictKey, string>>;

const DICTS: Record<Locale, Dict> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  en,
  ja,
  lzh,
  es,
  fr,
  ai: {},
};

/**
 * 语言选择项：机器翻译的条目标注（AI 语言项由语言子页面追加）。
 * machine 显示「机器翻译」，note 显示可选的自定义备注。
 */
export const LOCALES: { id: Locale; label: string; machine?: boolean; note?: string }[] = [
  { id: 'zh-CN', label: '简体中文' },
  { id: 'zh-TW', label: '繁體中文' },
  { id: 'en', label: 'English', machine: true },
  { id: 'ja', label: '日本語', machine: true },
  { id: 'es', label: 'Español', machine: true },
  { id: 'fr', label: 'Français', machine: true },
  { id: 'lzh', label: '文言（華夏）' },
];

/** 语言项的备注文字（无备注返回 null；machine 的文案随界面语言翻译） */
export function localeRemark(l: { machine?: boolean; note?: string }, machineText: string): string | null {
  if (l.machine) return machineText;
  return l.note ?? null;
}

/** 默认界面语言（与 DEFAULT_SETTINGS.language 一致；用户选择后持久化覆盖） */
export const DEFAULT_LOCALE: Locale = 'en';

let current: Locale = DEFAULT_LOCALE;

/* ---------------- AI 翻译语言的运行时词典 ---------------- */

const aiDicts = new Map<string, Dict>();
let aiLangTag = 'ai';
let aiLabel: string | null = null;

/** 当前 AI 语言显示名（无则 null；llm 提示词据此要求回答语言） */
export function getAiLocaleLabel(): string | null {
  return aiLabel;
}

/** 注册 AI 翻译词典（覆盖同一槽位 'ai'；调用方负责 localStorage 持久化） */
export function registerAiDict(label: string, dict: Record<string, string>, langTag = 'ai'): void {
  aiDicts.set('ai', dict as Dict);
  aiLabel = label;
  aiLangTag = langTag;
  bump();
}

/* ---------------- 显示转换层（实验性：AI → SI 改名） ---------------- */

/**
 * 显示文本转换开关（设置 → 实验性功能 → 「AI 显示为 SI」）。
 * 开启后所有经 t() 的界面文案把 "AI" 替换为 "SI"（含提示词侧的模型称呼不变，
 * 只影响 UI 展示层）。挂在 i18n 输出端：一处生效，全应用 1400+ 处 t() 调用点无需改动。
 */
let siRename = false;

/** 设置改名开关（startup 同步设置时调用；变化时 bump 触发重渲染） */
export function setSiRenameEnabled(v: boolean): void {
  if (siRename === v) return;
  siRename = v;
  bump();
}

/** 应用显示转换（t() 出口统一调用；大小写变体一并处理） */
function applyDisplayTransform(s: string): string {
  if (!siRename) return s;
  // 词边界替换：AI → SI（含小写 ai；避免误伤 "said" 等普通单词——用词边界）
  return s.replace(/\bAI\b/g, 'SI').replace(/\bai\b/g, 'si');
}

/* ---------------- 订阅：语言 / 词典变化通知 React 重渲染 ---------------- */

const listeners = new Set<() => void>();
let version = 0;

/** 订阅词典版本变化（AI 词典注册等不走 settings 的更新路径） */
export function subscribeI18n(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 词典版本号（useSyncExternalStore 快照） */
export function getI18nVersion(): number {
  return version;
}

function bump(): void {
  version++;
  for (const fn of listeners) fn();
}

/** 切换语言并同步 <html lang>（同语言不重复通知，但 lang 仍同步——首帧静态值可能不同） */
export function setLocale(locale: Locale): void {
  const changed = current !== locale;
  current = locale;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale === 'ai' ? aiLangTag : locale;
  }
  if (changed) bump();
}

/** 当前语言的 BCP-47 标签（供 toLocaleString 等；AI 语言为其 slug） */
export function localeTag(): string {
  return current === 'ai' ? aiLangTag : current;
}

/** 当前语言（llm 提示词判断回答语言用） */
export function getLocale(): Locale {
  return current;
}

/* ---------------- 用户自定义词条覆盖（语言子页 → 编辑词条） ----------------
 * 当前语言维度的本地覆盖层，优先于内置词典与 AI 词典；
 * AI 语言按其 slug 分库（切换 AI 语言互不串扰）。 */

const OVERRIDE_PREFIX = 'svt:i18n-overrides:';
const overrideDicts = new Map<string, Dict>();

/** 当前语言的覆盖层（惰性从 localStorage 加载；损坏视为空） */
function overrideStore(): Dict {
  const id = localeTag();
  let d = overrideDicts.get(id);
  if (!d) {
    d = {};
    try {
      const raw = localStorage.getItem(OVERRIDE_PREFIX + id);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'string' && v.trim()) d[k as DictKey] = v;
        }
      }
    } catch {
      /* 忽略损坏缓存 */
    }
    overrideDicts.set(id, d);
  }
  return d;
}

/** 当前语言某词条的自定义译文（无则 undefined） */
export function getOverride(key: DictKey): string | undefined {
  return overrideStore()[key];
}

/** 保存 / 移除（value = null 或空串）当前语言的自定义译文，立即生效 */
export function setOverride(key: DictKey, value: string | null): void {
  const d = overrideStore();
  if (value == null || !value.trim()) delete d[key];
  else d[key] = value.trim();
  try {
    localStorage.setItem(OVERRIDE_PREFIX + localeTag(), JSON.stringify(d));
  } catch {
    /* 配额不足：仅内存生效 */
  }
  bump();
}

/**
 * 取词条。支持 {name} 占位符：t('key', { name: value })
 * 查找顺序：用户自定义 → 内置词典 → AI 词典 → zh-CN 基准回退
 */
export function t(key: DictKey, params?: Record<string, string | number>): string {
  const raw = overrideStore()[key] ?? DICTS[current][key] ?? aiDicts.get(current)?.[key] ?? zhCN[key];
  if (!raw) return key;
  if (!params) return applyDisplayTransform(raw);
  return applyDisplayTransform(
    raw.replace(/\{(\w+)\}/g, (_, name: string) =>
      params[name] !== undefined ? String(params[name]) : `{${name}}`,
    ),
  );
}
