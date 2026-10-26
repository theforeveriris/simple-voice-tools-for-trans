/**
 * AI 翻译语言表（语言子页面 · 依赖 实验性功能 的大模型配置）
 * 把 zh-CN 基准词典分批交给大模型翻译成目标语言，生成的新语言词典
 * 缓存在 localStorage（svt:i18n-ai:<slug>），经 registerAiDict 注入 i18n
 * 即可作为界面语言使用；未翻译到的词条自动回退简体中文。
 * 支持增量补全（应用升级新增词条）、用户术语表、词典导出/导入分享。
 */

import { zhCN } from './zh-CN';
import { registerAiDict } from './index';
import { llmChat, type LlmConfig } from '@/lib/llm';
import { APP_ID, isKnownAppId } from '@/lib/appId';

const LS_PREFIX = 'svt:i18n-ai:';
/** 每批翻译的词条数：全量约 660 键 → 8 批左右，兼顾单次请求体积与调用次数 */
const BATCH = 90;
/** 词典分享文件的格式版本（settings / records 同风格：app + kind + version） */
const AI_LOCALE_FORMAT_VERSION = 1;

/** AI 语言词典缓存（localStorage 持久化结构） */
export interface AiLocaleCache {
  /** 目标语言显示名（用户输入，如 Deutsch） */
  label: string;
  /** 翻译词典（key → 译文；缺键回退 zh-CN） */
  dict: Record<string, string>;
  /** 生成时使用的模型 id（重新生成时可参考） */
  model: string;
  /** 生成时间（epoch ms） */
  at: number;
}

/** 旧版兜底 slug：非拉丁显示名曾一律落到该键，多个语言因此互相覆盖 */
const LEGACY_CUSTOM_SLUG = 'custom';

/** 稳定短散列（FNV-1a）：显示名归不出 ASCII slug 时用来区分不同语言 */
function hashLabel(label: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * 语言显示名 → 缓存键 slug。
 * 拉丁显示名归一为小写连字符（既有键不变）；「日本語 / 한국어 / Русский」这类
 * 归不出 ASCII 的显示名不能再一律落 'custom'——那会让第二种语言覆盖第一种，
 * 甚至跨语言读到别人的词典；改用 'custom-<散列>'。
 */
export function aiSlug(label: string): string {
  const ascii = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return ascii || `custom-${hashLabel(label.trim().toLowerCase())}`;
}

/** 读取并校验缓存：显示名必须与请求一致（防撞键后读到别的语言） */
function readCache(key: string, label: string): AiLocaleCache | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AiLocaleCache;
    if (typeof parsed.label !== 'string' || typeof parsed.dict !== 'object' || parsed.dict == null) return null;
    if (parsed.label.trim().toLowerCase() !== label.trim().toLowerCase()) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 读取某语言的 AI 词典缓存；无、损坏或显示名不符返回 null（含旧版 'custom' 键兼容） */
export function loadAiCache(label: string): AiLocaleCache | null {
  return readCache(LS_PREFIX + aiSlug(label), label)
    ?? readCache(LS_PREFIX + LEGACY_CUSTOM_SLUG, label);
}

function saveAiCache(cache: AiLocaleCache): void {
  try {
    localStorage.setItem(LS_PREFIX + aiSlug(cache.label), JSON.stringify(cache));
  } catch {
    /* 配额不足：词典仍可在本次会话使用 */
  }
}

/** 清除某语言的 AI 词典缓存（新键与旧版 'custom' 键一并清理） */
export function clearAiCache(label: string): void {
  try {
    localStorage.removeItem(LS_PREFIX + aiSlug(label));
    localStorage.removeItem(LS_PREFIX + LEGACY_CUSTOM_SLUG);
  } catch {
    /* 忽略存储异常 */
  }
}

/**
 * 启动恢复：把已生成语言的缓存词典注册进 i18n（main.tsx 在语言为 ai 时调用）。
 * 缓存缺失返回 false（调用方应回退默认语言）
 */
export function hydrateAiLocale(label: string): boolean {
  const cache = loadAiCache(label);
  if (!cache) return false;
  registerAiDict(cache.label, cache.dict, aiSlug(label));
  return true;
}

/** 基准词条（zh-CN 全量） */
function baseEntries(): [string, string][] {
  return Object.entries(zhCN as unknown as Record<string, string>);
}

/** 缓存中缺失的基准词条（应用升级新增的界面文案） */
export function missingKeys(label: string): string[] {
  const cache = loadAiCache(label);
  if (!cache) return baseEntries().map(([k]) => k);
  const have = new Set(Object.keys(cache.dict));
  return baseEntries().map(([k]) => k).filter((k) => !have.has(k));
}

/** 覆盖率：词典中仍有效的词条数 / 基准词条总数（缓存不存在返回 null） */
export function cacheCoverage(label: string): { covered: number; total: number } | null {
  const cache = loadAiCache(label);
  if (!cache) return null;
  const base = zhCN as unknown as Record<string, unknown>;
  const covered = Object.keys(cache.dict).filter((k) => k in base).length;
  return { covered, total: Object.keys(base).length };
}

/* ------------------------------ 术语表 ------------------------------ */

/**
 * 解析用户术语表：每行一条「中文 = 译文」（= / → / : 均可作分隔），
 * 空行与残缺行忽略
 */
export function parseGlossary(raw: string | undefined | null): [string, string][] {
  if (!raw) return [];
  const out: [string, string][] = [];
  for (const line of raw.split('\n')) {
    const parts = line.split(/\s*(?:=|→|:)\s*/);
    if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
      out.push([parts[0].trim(), parts[1].trim()]);
    }
  }
  return out;
}

/** 翻译提示词：术语保护 + 用户术语表 + 纯 JSON 输出 */
function systemPrompt(lang: string, glossary: [string, string][]): string {
  const lines = [
    'You are the UI translator for "Simple Voice Tool for Trans", a self-tracking voice-training app',
    '(transgender voice training and voice health).',
    `Translate the Simplified Chinese UI strings in the user message into ${lang}.`,
    'Rules:',
    '- Keep {placeholder} tokens (e.g. {n}, {msg}, {pct}) exactly as-is, position adapted to the target grammar.',
    '- Keep technical terms and units unchanged: F0, F1, F2, MPT, CPPS, HNR, Jitter, Shimmer, YIN, pYIN,',
    '  MPM, LPC, Hz, dB, P10, P90, PWA, CSV, JSON, HTML, PNG, ZIP, AI, API, GitHub, WebDAV, NAS.',
    '- Keep each translation short and natural for app UI text.',
  ];
  if (glossary.length > 0) {
    lines.push('Glossary — always use exactly these translations for these source terms:');
    for (const [src, dst] of glossary) lines.push(`- ${src} → ${dst}`);
  }
  lines.push(
    'Respond ONLY with a single JSON object mapping the SAME ids to the translations;',
    'no markdown fences, no commentary.',
  );
  return lines.join('\n');
}

/** 解析单批回复：取首个 JSON 对象，仅接受已知键与非空字符串值 */
function parseBatch(content: string, allowed: Set<string>): Record<string, string> {
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No JSON in response');
  const obj = JSON.parse(m[0]) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (allowed.has(k) && typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return out;
}

/** 翻译进度（按批上报；batch = 已完成批次数，0 起始） */
export interface TranslateProgress {
  /** 完成比例 0-1（按已翻译词条数） */
  frac: number;
  /** 已完成批次 / 总批次 */
  batch: number;
  totalBatches: number;
  /** 已翻译并入词典的词条数 / 本轮总词条数 */
  entriesDone: number;
  entriesTotal: number;
}

/** 分批翻译词条并并入 dict（每批完成与开始时上报进度，每批完成即回调落盘） */
async function translateInto(
  entries: [string, string][],
  dict: Record<string, string>,
  cfg: LlmConfig,
  lang: string,
  glossary: [string, string][],
  onProgress?: (p: TranslateProgress) => void,
  signal?: AbortSignal,
  onBatch?: () => void,
): Promise<void> {
  const totalBatches = Math.max(1, Math.ceil(entries.length / BATCH));
  const system = systemPrompt(lang, glossary);
  const report = (batch: number): void => {
    const entriesDone = Math.min(entries.length, batch * BATCH);
    onProgress?.({
      frac: entries.length ? entriesDone / entries.length : 1,
      batch,
      totalBatches,
      entriesDone,
      entriesTotal: entries.length,
    });
  };
  // 起始进度：让界面立即出现「第 1/N 批」而不是静默等待首批返回
  report(0);
  for (let i = 0; i < totalBatches; i++) {
    const batch = entries.slice(i * BATCH, (i + 1) * BATCH);
    const parsed = parseBatch(
      await llmChat(cfg, system, JSON.stringify(Object.fromEntries(batch), null, 1), 0.3, signal, 'translate'),
      new Set(batch.map(([k]) => k)),
    );
    Object.assign(dict, parsed);
    report(i + 1);
    onBatch?.();
  }
}

function saveAndRegister(label: string, dict: Record<string, string>, model: string): AiLocaleCache {
  const cache: AiLocaleCache = { label: label.trim(), dict, model, at: Date.now() };
  saveAiCache(cache);
  registerAiDict(cache.label, dict, aiSlug(label));
  return cache;
}

export interface GenerateOptions {
  /** 用户术语表（设置 → 语言 → 翻译术语表） */
  glossary?: string;
  /** 取消信号（后台任务中断用） */
  signal?: AbortSignal;
}

/**
 * 全量生成：把整个基准词典翻译成目标语言，写入缓存并注册生效。
 * 每批完成即落盘：中途取消 / 失败时已完成批次留在缓存里，界面可继续用，
 * 下次「增量补全」只补剩下的词条（不浪费已付费的翻译）。
 */
export async function generateAiLocale(
  label: string,
  cfg: LlmConfig,
  onProgress?: (p: TranslateProgress) => void,
  opts: GenerateOptions = {},
): Promise<AiLocaleCache> {
  const dict: Record<string, string> = {};
  const persistBatch = () => {
    saveAndRegister(label, dict, cfg.modelId);
  };
  await translateInto(
    baseEntries(), dict, cfg, label.trim(), parseGlossary(opts.glossary), onProgress, opts.signal, persistBatch,
  );
  return saveAndRegister(label, dict, cfg.modelId);
}

/**
 * 增量补全：只翻译缓存缺失的基准词条（应用升级新增的界面文案），
 * 并入现有词典后保存注册。无缓存时等价于全量生成。同样每批落盘。
 */
export async function translateMissing(
  label: string,
  cfg: LlmConfig,
  onProgress?: (p: TranslateProgress) => void,
  opts: GenerateOptions = {},
): Promise<AiLocaleCache> {
  const cache = loadAiCache(label);
  const dict: Record<string, string> = { ...(cache?.dict ?? {}) };
  const model = cache?.model ?? cfg.modelId;
  const have = new Set(Object.keys(dict));
  const missing = baseEntries().filter(([k]) => !have.has(k));
  if (missing.length === 0) return cache ?? saveAndRegister(label, dict, model);
  const persistBatch = () => {
    saveAndRegister(label, dict, model);
  };
  await translateInto(
    missing, dict, cfg, label.trim(), parseGlossary(opts.glossary), onProgress, opts.signal, persistBatch,
  );
  return saveAndRegister(label, dict, model);
}

/* ------------------------------ 词典分享（导出 / 导入） ------------------------------ */

export interface AiLocalePayload {
  app: string;
  kind: 'ai-locale';
  version: number;
  exportedAt: string;
  label: string;
  model: string;
  generatedAt: number;
  dict: Record<string, string>;
}

/** 组装词典分享 JSON（与设置 / 记录导出同风格：app + kind + version） */
export function buildAiLocalePayload(cache: AiLocaleCache): AiLocalePayload {
  return {
    app: APP_ID,
    kind: 'ai-locale',
    version: AI_LOCALE_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    label: cache.label,
    model: cache.model,
    generatedAt: cache.at,
    dict: cache.dict,
  };
}

/**
 * 解析词典分享 JSON：校验 app/kind/version，dict 仅保留基准中存在的键。
 * @throws 格式不符时抛 Error（调用方展示导入失败提示）
 */
export function parseAiLocalePayload(json: string): AiLocaleCache {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('invalid json');
  }
  const obj = parsed as Partial<AiLocalePayload> | null;
  if (
    !obj || typeof obj !== 'object'
    || !isKnownAppId(obj.app) || obj.kind !== 'ai-locale'
    || typeof obj.version !== 'number' || obj.version > AI_LOCALE_FORMAT_VERSION
    || typeof obj.label !== 'string' || !obj.label.trim()
    || typeof obj.dict !== 'object' || obj.dict == null
  ) {
    throw new Error('invalid payload');
  }
  const base = zhCN as unknown as Record<string, unknown>;
  const dict: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj.dict)) {
    if (k in base && typeof v === 'string' && v.trim()) dict[k] = v.trim();
  }
  return {
    label: obj.label.trim(),
    dict,
    model: typeof obj.model === 'string' && obj.model.trim() ? obj.model : 'unknown',
    at: typeof obj.generatedAt === 'number' ? obj.generatedAt : Date.now(),
  };
}

/** 保存导入的词典并注册生效（供语言子页导入流程使用） */
export function importAiCache(cache: AiLocaleCache): void {
  saveAiCache(cache);
  registerAiDict(cache.label, cache.dict, aiSlug(cache.label));
}
