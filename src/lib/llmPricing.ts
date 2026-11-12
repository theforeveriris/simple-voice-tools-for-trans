/**
 * 模型单价解析（Token 用量的费用估算）
 *
 * 顺序：
 *   1. 服务商 `/models` 返回的真实单价（OpenRouter 等会带 pricing）；
 *   2. 内置单价目录（lib/llmModels.ts 的 PRICE_RULES，随厂商调价可能过期）。
 *
 * 同一档案在一个会话内只拉一次（内存缓存），失败静默回退到内置目录——
 * 费用只是估算，不能因为拉价失败就让用量面板不可用。
 */

import { fetchLlmModels, priceForModel, type ModelPrice } from './llmModels';
import type { LlmConfig } from './llm';

/** 会话内缓存：失败也缓存（null），避免每次进设置页都重试 */
const cache = new Map<string, ModelPrice | null>();

function cacheKey(cfg: LlmConfig): string {
  return `${cfg.protocol}|${cfg.baseUrl}|${cfg.modelId}`;
}

/** 先给内置目录的结果（同步、立即可用） */
export function builtinPriceFor(cfg: LlmConfig | null | undefined): ModelPrice | null {
  if (!cfg) return null;
  return priceForModel(cfg.modelId);
}

/**
 * 解析模型单价：先看缓存，再拉服务商模型列表，最后回退内置目录。
 * 永不抛错（网络/鉴权失败都按「无价格」处理）。
 */
export async function resolveModelPrice(cfg: LlmConfig | null | undefined): Promise<ModelPrice | null> {
  if (!cfg) return null;
  const key = cacheKey(cfg);
  if (cache.has(key)) return cache.get(key) ?? null;

  const builtin = priceForModel(cfg.modelId);
  try {
    const models = await fetchLlmModels({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      protocol: cfg.protocol ?? 'openai',
    });
    const hit = models.find((m) => m.id === cfg.modelId)
      ?? models.find((m) => m.id.toLowerCase() === cfg.modelId.toLowerCase());
    const price = hit?.pricing ?? builtin;
    cache.set(key, price);
    return price;
  } catch {
    cache.set(key, builtin);
    return builtin;
  }
}
