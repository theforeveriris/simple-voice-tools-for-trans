/**
 * LLM 结果缓存（内存 + kv 持久化二级缓存）与缓存键
 * 从 llm.ts 拆出：建议与周报共用同一缓存实现；
 * 键中 API Key 以 FNV-1a 散列替代明文。
 */

import type { AnalysisRecord } from '@/types';
import { getLocale } from '@/i18n';
import { loadLlmResult, saveLlmResult } from '@/lib/llmResultStore';
import type { LlmAdviceResult } from './llmAdvice';
import type { LlmConfig } from './llmClient';
import { weekRecords, type LlmPromptOptions } from './llmAdvice';
import type { AdviceTarget } from '@/lib/advice';

/** 短字符串散列（FNV-1a 变体）：缓存键中替代原始 API Key，避免明文 key 落在内存键里 */
export function hashStr(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** 内存 + 持久化二级缓存的共用实现：p 立即进 map 保证并发去重，失败剔除 */
export function cachedWithStore(
  map: Map<string, Promise<LlmAdviceResult>>,
  key: string,
  run: () => Promise<LlmAdviceResult>,
): Promise<LlmAdviceResult> {
  const hit = map.get(key);
  if (hit) return hit;
  const p = (async () => {
    const stored = await loadLlmResult(key).catch(() => null);
    if (stored) return stored;
    const result = await run();
    saveLlmResult(key, result);
    return result;
  })();
  map.set(key, p);
  p.catch(() => {
    map.delete(key);
  });
  return p;
}

/** 缓存是否已存在（内存或持久化，不发起任何请求） */
export async function hasCached(map: Map<string, Promise<unknown>>, key: string): Promise<boolean> {
  if (map.has(key)) return true;
  return (await loadLlmResult(key).catch(() => null)) != null;
}

/* ------------------------------ 建议与周报的缓存实例 ------------------------------ */

const adviceCache = new Map<string, Promise<LlmAdviceResult>>();
const weeklyCache = new Map<string, Promise<LlmAdviceResult>>();

/** 同一配置 + 同一记录只请求一次（会话内存 + kv 持久化二级缓存）；失败不缓存（下次重新请求） */
export function cachedLlmAdvice(key: string, run: () => Promise<LlmAdviceResult>): Promise<LlmAdviceResult> {
  return cachedWithStore(adviceCache, key, run);
}

/** 周报缓存：同一实现（内存 + kv 持久化，失败不缓存可重试） */
export function cachedWeeklyReport(key: string, run: () => Promise<LlmAdviceResult>): Promise<LlmAdviceResult> {
  return cachedWithStore(weeklyCache, key, run);
}

/** 缓存是否已存在（内存或持久化，不发起任何请求）：卡片据此决定键变化后能否静默免费重取 */
export async function hasCachedLlmAdvice(key: string): Promise<boolean> {
  return hasCached(adviceCache, key);
}

export async function hasCachedWeeklyReport(key: string): Promise<boolean> {
  return hasCached(weeklyCache, key);
}

/** 记录侧缓存键指纹：id + 备注 + 统计摘要（重算同 id 换新统计时键随之变化，避免命中过期建议） */
export function recordFingerprint(r: AnalysisRecord): string {
  return `${r.id}:${r.note ?? ''}:${hashStr(JSON.stringify(r.stats))}`;
}

/** 缓存键：接口配置 / 模型 / 语言 / 靶标 / 基线 / 提示词定制 / 记录（id+备注+统计指纹）任一变化即失效 */
export function llmAdviceKey(
  cfg: LlmConfig,
  records: AnalysisRecord[],
  target: AdviceTarget,
  opts: {
    baseline?: AnalysisRecord | null;
    prompt?: LlmPromptOptions;
  } = {},
): string {
  const { baseline = null, prompt } = opts;
  return JSON.stringify([
    cfg.baseUrl,
    hashStr(cfg.apiKey),
    cfg.modelId,
    cfg.protocol,
    getLocale(),
    target.enabled,
    target.min,
    target.max,
    baseline?.id ?? null,
    // 训练方向 / 年龄组会实质改变系统提示词（llmAdvice 的 userContextBlock），
    // 遗漏它们会让换目标后仍命中旧建议
    prompt?.goal ?? null,
    prompt?.ageGroup ?? null,
    (prompt?.extraRules ?? []).map((r) => r.trim()).filter(Boolean),
    prompt?.promptOverride?.trim() ?? null,
    records.map(recordFingerprint),
  ]);
}

/** 周报缓存键：窗口随日期自然滚动，配置 / 语言 / 提示词定制 / 记录集合（含统计）变化即失效 */
export function weeklyReportKey(cfg: LlmConfig, records: AnalysisRecord[], prompt?: LlmPromptOptions): string {
  const week = weekRecords(records);
  return JSON.stringify([
    'weekly',
    cfg.baseUrl,
    hashStr(cfg.apiKey),
    cfg.modelId,
    cfg.protocol,
    getLocale(),
    new Date().toDateString(),
    prompt?.goal ?? null,
    prompt?.ageGroup ?? null,
    prompt?.planSummary ?? null,
    (prompt?.extraRules ?? []).map((r) => r.trim()).filter(Boolean),
    prompt?.promptOverride?.trim() ?? null,
    week.map(recordFingerprint),
  ]);
}
