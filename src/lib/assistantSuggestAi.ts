/**
 * AI 生成的空会话快捷提问（纯逻辑 + 缓存）
 *
 * 本地规则（assistantSuggestions.ts）先给出可点的默认问题，
 * 这里在后台补一次非流式小请求，用最近记录生成更贴合的 4 个问题；
 * 失败、超时或未配置模型时静默回退本地结果。
 *
 * 缓存键 = 语言 + 训练目标 + 记录指纹；同一批记录 6 小时内只请求一次。
 */

import type { AnalysisRecord, AppSettings, TestMode } from '@/types';
import { idbGetKV, idbPutKV } from '@/lib/storage/idb';

/** 缓存有效期（同一批记录不重复请求） */
export const SUGGEST_TTL_MS = 6 * 60 * 60 * 1000;
const KV_SUGGEST = 'llm:suggestCache';
/** 提示词里最多列出多少条记录 */
const PROMPT_RECORDS = 6;

interface SuggestCacheEntry {
  fp: string;
  at: number;
  items: string[];
}

const MODE_LABELS: Record<TestMode | 'free', string> = {
  reading: '朗读',
  sustained: '持续发声',
  glide: '滑音',
  free: '未标注',
};

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 记录指纹：语言 + 目标 + 条数 + 最近 8 条的 id/时间/音高 */
export function suggestFingerprint(
  records: AnalysisRecord[],
  goal: AppSettings['userGoal'],
  locale: string,
): string {
  const head = [...records]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 8)
    .map((r) => `${r.id}:${r.createdAt}:${Math.round(r.stats.avgF0)}`)
    .join('|');
  return `${locale}|${goal}|${records.length}|${head}`;
}

function recordLine(r: AnalysisRecord): string {
  const d = new Date(r.createdAt);
  const gap = r.stats.avgF2 != null && r.stats.avgF1 != null
    ? ` F2−F1 ${Math.round(r.stats.avgF2 - r.stats.avgF1)}Hz`
    : '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} `
    + `${MODE_LABELS[r.mode ?? 'free']} ${Math.round(r.durationSec)}s `
    + `avgF0 ${Math.round(r.stats.avgF0)}Hz${gap}`;
}

const GOAL_LABELS: Record<AppSettings['userGoal'], string> = {
  mtf: '女性化（MtF）',
  ftm: '男性化（FtM）',
  other: '未指定',
};

/** 组装系统提示与用户消息 */
export function buildSuggestPrompts(
  records: AnalysisRecord[],
  settings: Pick<AppSettings, 'userGoal'>,
  language: string,
): { system: string; user: string } {
  const recent = [...records].sort((a, b) => b.createdAt - a.createdAt).slice(0, PROMPT_RECORDS);
  const system = [
    '你是嗓音训练应用的助手，负责生成「输入框快捷提问」——用户点一下就会问你的问题。',
    '根据给出的最近记录与训练目标，写 4 个用户此刻最可能想问的问题。',
    '要求：',
    '- 每个问题不超过 20 个字，单句，口语化；',
    '- 只能提到记录里出现过的指标（avgF0、音域、F2−F1、MPT、jitter 等），不要臆造数据；',
    '- 4 个角度不要重复，优先覆盖：趋势、单条解读、训练计划、记录对比；',
    '- 不要编号、引号、解释或前缀；',
    `- 用${language}输出；`,
    '- 只输出 JSON 数组，例如 ["问题一","问题二","问题三","问题四"]。',
  ].join('\n');
  const user = [
    `训练目标：${GOAL_LABELS[settings.userGoal] ?? GOAL_LABELS.other}`,
    `记录总数：${records.length}`,
    '最近记录（新→旧）：',
    ...recent.map((r, i) => `${i + 1}. ${recordLine(r)}`),
  ].join('\n');
  return { system, user };
}

/**
 * 解析模型输出：优先 JSON 数组，否则按行拆；去掉编号/引号，
 * 过滤过短过长与重复项，补上问号，最多返回 max 条。
 */
export function parseSuggestions(text: string, max = 4): string[] {
  if (!text) return [];
  let list: string[] = [];
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start >= 0 && end > start) {
    try {
      const parsed: unknown = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(parsed)) list = parsed.filter((x): x is string => typeof x === 'string');
    } catch {
      list = [];
    }
  }
  if (list.length === 0) list = text.split(/\r?\n/);

  const out: string[] = [];
  for (const raw of list) {
    const s = raw
      .replace(/^\s*(?:[-*•]|\d+[.、)])\s*/, '')
      .replace(/^["'“”『』「」]+/, '')
      .replace(/["'“”『』「」]+$/, '')
      .trim();
    if (s.length < 4 || s.length > 48) continue;
    const withMark = /[?？]$/.test(s) ? s : `${s}？`;
    if (out.includes(withMark)) continue;
    out.push(withMark);
    if (out.length >= max) break;
  }
  return out;
}

/** 读取缓存；指纹不一致或过期返回 null */
export async function readSuggestCache(fp: string, now = Date.now()): Promise<string[] | null> {
  try {
    const stored = await idbGetKV<SuggestCacheEntry>(KV_SUGGEST);
    if (!stored || stored.fp !== fp || !Array.isArray(stored.items)) return null;
    if (!stored.items.length || now - stored.at > SUGGEST_TTL_MS) return null;
    return stored.items;
  } catch {
    return null;
  }
}

/** 写入缓存（失败静默：只是少一次复用） */
export async function writeSuggestCache(fp: string, items: string[]): Promise<void> {
  if (!items.length) return;
  try {
    await idbPutKV(KV_SUGGEST, { fp, at: Date.now(), items } satisfies SuggestCacheEntry);
  } catch {
    /* 忽略 */
  }
}
