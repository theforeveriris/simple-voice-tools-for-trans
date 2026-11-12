/**
 * 大模型模型列表拉取与上下文长度识别（协议层辅助）
 *
 * 设置 → 大模型 → 新建/编辑档案里，用户可一键从 Base URL 的 `/models`
 * 拉取模型列表；上下文长度按以下优先级识别：
 *   1. 接口返回的元数据（context_length / max_model_len / top_provider.context_length 等）
 *   2. 内置已知模型目录（仅作兜底，模型更新后可能过期，用户可手动改）
 *   3. 保持当前值
 *
 * 支持 OpenAI 兼容（GET {base}/models）与 Anthropic（GET {base}/v1/models）。
 * 纯解析函数与网络函数分开，便于单测；不记录请求日志（不含用户录音/统计数据）。
 */

import type { LlmProtocol } from './llmClient';

export interface LlmModelInfo {
  id: string;
  /** 接口给的展示名（若有，且与 id 不同） */
  label?: string;
  /** 接口元数据或内置目录识别的上下文长度；未知为 null */
  contextTokens: number | null;
  /** 单价（USD / 每百万 tokens）；未知为 null */
  pricing?: ModelPrice | null;
}

/** 单价（USD / 每百万 tokens） */
export interface ModelPrice {
  input: number;
  output: number;
}

/**
 * 内置单价目录（USD / 每百万 tokens，估算用，随厂商调价可能过期）。
 * 接口能返回真实价格时（OpenRouter 等）优先用接口结果。
 */
const PRICE_RULES: { re: RegExp; input: number; output: number }[] = [
  { re: /^gpt-5/, input: 1.25, output: 10 },
  { re: /^gpt-4\.1/, input: 2, output: 8 },
  { re: /^gpt-4o-mini/, input: 0.15, output: 0.6 },
  { re: /^gpt-4o/, input: 2.5, output: 10 },
  { re: /^gpt-4-turbo/, input: 10, output: 30 },
  { re: /^gpt-4/, input: 30, output: 60 },
  { re: /^gpt-3\.5/, input: 0.5, output: 1.5 },
  { re: /^o4-mini/, input: 1.1, output: 4.4 },
  { re: /^o3/, input: 2, output: 8 },
  { re: /^o[1-4]/, input: 15, output: 60 },
  { re: /^claude.*opus/, input: 15, output: 75 },
  { re: /^claude.*haiku/, input: 0.8, output: 4 },
  { re: /^claude/, input: 3, output: 15 },
  { re: /^deepseek.*reasoner/, input: 0.55, output: 2.19 },
  { re: /^deepseek/, input: 0.27, output: 1.1 },
  { re: /^gemini-2\.5-pro/, input: 1.25, output: 10 },
  { re: /^gemini-2/, input: 0.1, output: 0.4 },
  { re: /^gemini-1\.5-pro/, input: 1.25, output: 5 },
  { re: /^gemini/, input: 0.075, output: 0.3 },
  { re: /^qwen-max/, input: 1.6, output: 6.4 },
  { re: /^qwen-plus/, input: 0.4, output: 1.2 },
  { re: /^qwen-turbo/, input: 0.05, output: 0.2 },
  { re: /^qwen/, input: 0.4, output: 1.2 },
  { re: /^moonshot-v1/, input: 1.68, output: 1.68 },
  { re: /^kimi/, input: 0.6, output: 2.5 },
  { re: /^glm-4/, input: 0.6, output: 0.6 },
  { re: /^llama-?3\.3/, input: 0.59, output: 0.79 },
  { re: /^llama-?3\.1/, input: 0.2, output: 0.2 },
  { re: /^mistral-large/, input: 2, output: 6 },
  { re: /^mistral-small/, input: 0.2, output: 0.6 },
];

/** 按模型 ID 查内置单价（未知返回 null） */
export function priceForModel(modelId: string): ModelPrice | null {
  const id = normalizeModelId(modelId);
  if (!id) return null;
  for (const rule of PRICE_RULES) {
    if (rule.re.test(id)) return { input: rule.input, output: rule.output };
  }
  return null;
}

/**
 * 从一条模型记录里提取单价（USD / 每百万 tokens）。
 * 覆盖 OpenRouter（pricing.prompt / pricing.completion，单位 USD/token）
 * 与常见的 input_price / output_price 写法。
 */
function extractPricing(item: Record<string, unknown>): ModelPrice | null {
  const p = isRecord(item.pricing) ? item.pricing : null;
  const num = (v: unknown): number | null => {
    const n = typeof v === 'string' ? Number(v) : v;
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
  };
  // OpenRouter：USD / token → 换算成每百万
  const prompt = p ? num(p.prompt) : null;
  const completion = p ? num(p.completion) : null;
  if (prompt != null && completion != null) {
    return { input: prompt * 1e6, output: completion * 1e6 };
  }
  const input = num(item.input_price) ?? num(item.price_input);
  const output = num(item.output_price) ?? num(item.price_output);
  if (input != null && output != null) return { input, output };
  return null;
}

/**
 * 已知模型上下文目录：
 * - 只在接口没有返回 context_length 时兜底
 * - 按模型 ID 前缀匹配（忽略 provider 前缀与 :free 等变体后缀）
 * - 数值会随厂商更新而过期，UI 允许用户手动覆盖
 */
const CONTEXT_RULES: { re: RegExp; tokens: number }[] = [
  { re: /^gpt-4\.1/, tokens: 1_047_576 },
  { re: /^gpt-4\.5/, tokens: 131_072 },
  { re: /^gpt-4o/, tokens: 128_000 },
  { re: /^gpt-4-turbo/, tokens: 128_000 },
  { re: /^gpt-4-32k/, tokens: 32_768 },
  { re: /^gpt-4/, tokens: 8_192 },
  { re: /^gpt-3\.5-turbo/, tokens: 16_385 },
  { re: /^gpt-5/, tokens: 400_000 },
  { re: /^o[1-4]/, tokens: 200_000 },
  { re: /^claude/, tokens: 200_000 },
  { re: /^deepseek/, tokens: 128_000 },
  { re: /^gemini-1\.5/, tokens: 2_097_152 },
  { re: /^gemini-2\./, tokens: 1_048_576 },
  { re: /^qwen-max/, tokens: 32_768 },
  { re: /^qwen-plus/, tokens: 131_072 },
  { re: /^qwen-turbo/, tokens: 1_000_000 },
  { re: /^qwen/, tokens: 131_072 },
  { re: /^llama-?3\.1/, tokens: 131_072 },
  { re: /^llama-?3\.3/, tokens: 131_072 },
  { re: /^mistral-large/, tokens: 131_072 },
  { re: /^mistral-small/, tokens: 32_768 },
  { re: /^moonshot-v1-128k/, tokens: 131_072 },
  { re: /^moonshot-v1-32k/, tokens: 32_768 },
  { re: /^moonshot-v1-8k/, tokens: 8_192 },
  { re: /^kimi/, tokens: 262_144 },
  { re: /^glm-4/, tokens: 131_072 },
  { re: /^command-r/, tokens: 128_000 },
  { re: /^grok/, tokens: 131_072 },
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function firstString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function positiveInt(v: unknown): number | null {
  const n = typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 1024 ? Math.round(n) : null;
}

/** 从一条模型记录里尽力提取上下文长度（覆盖 OpenAI / OpenRouter / vLLM / Anthropic 代理） */
function extractContextTokens(item: Record<string, unknown>): number | null {
  const topProvider = isRecord(item.top_provider) ? item.top_provider : null;
  const limits = isRecord(item.limits) ? item.limits : null;
  const meta = isRecord(item.meta) ? item.meta : null;
  const candidates = [
    item.context_length,
    item.context_window,
    item.context_tokens,
    item.max_context_length,
    item.max_model_len,
    item.max_input_tokens,
    topProvider?.context_length,
    limits?.context_window,
    meta?.n_ctx_train,
  ];
  for (const c of candidates) {
    const n = positiveInt(c);
    if (n) return n;
  }
  return null;
}

/** 去掉 OpenRouter 风格 provider 前缀与 :free / :beta 等变体后缀 */
function normalizeModelId(modelId: string): string {
  const tail = modelId.trim().toLowerCase().split('/').pop() ?? '';
  return tail.replace(/:.*$/, '').trim();
}

/**
 * 按模型 ID 从内置目录识别上下文长度。
 * 接口返回的元数据优先；本函数只在没有元数据时使用。
 */
export function contextTokensForModel(modelId: string): number | null {
  const id = normalizeModelId(modelId);
  if (!id) return null;
  for (const rule of CONTEXT_RULES) {
    if (rule.re.test(id)) return rule.tokens;
  }
  // moonshot-v1-32k / xxx-128k 之类的后缀兜底
  const km = /(?:^|[-_])(\d+)k(?:$|[-_.:])/i.exec(id);
  if (km) {
    const n = Number(km[1]) * 1024;
    if (Number.isFinite(n) && n >= 1024) return n;
  }
  return null;
}

/** 128000 → 128K，1048576 → 1.0M */
export function formatContextTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return String(tokens);
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
}

/** 模型列表接口地址（兼容用户把 Base URL 填到 /v1、/chat/completions 或 /messages 的情况） */
export function modelsEndpoint(baseUrl: string, protocol: LlmProtocol): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (!base) return '';
  if (protocol === 'anthropic') {
    if (/\/models$/.test(base)) return base;
    if (/\/messages$/.test(base)) return `${base.replace(/\/messages$/, '')}/models`;
    if (/\/v1$/.test(base)) return `${base}/models`;
    return `${base}/v1/models`;
  }
  if (/\/models$/.test(base)) return base;
  if (/\/chat\/completions$/.test(base)) return base.replace(/\/chat\/completions$/, '/models');
  return `${base}/models`;
}

function modelsHeaders(protocol: LlmProtocol, apiKey: string): Record<string, string> {
  if (protocol === 'anthropic') {
    return {
      accept: 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // 浏览器直连 api.anthropic.com 必须显式声明
      'anthropic-dangerous-direct-browser-access': 'true',
    };
  }
  return { accept: 'application/json', Authorization: `Bearer ${apiKey}` };
}

/** 把接口响应解析成去重、排序后的模型列表；兼容 {data:[]} / {models:[]} / 裸数组 */
export function parseLlmModels(raw: unknown): LlmModelInfo[] {
  const list = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.data)
      ? raw.data
      : isRecord(raw) && Array.isArray(raw.models)
        ? raw.models
        : [];

  const out: LlmModelInfo[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const rec = isRecord(item) ? item : null;
    const id = firstString(rec ? rec.id : undefined, rec ? rec.model : undefined, typeof item === 'string' ? item : undefined);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label = rec ? firstString(rec.display_name, rec.name) : undefined;
    const contextTokens = (rec ? extractContextTokens(rec) : null) ?? contextTokensForModel(id);
    const pricing = (rec ? extractPricing(rec) : null) ?? priceForModel(id);
    out.push({
      id,
      ...(label && label !== id ? { label } : {}),
      contextTokens,
      pricing,
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

export interface FetchLlmModelsInput {
  baseUrl: string;
  apiKey: string;
  protocol: LlmProtocol;
  /** 外部取消信号；不传则 20 秒超时 */
  signal?: AbortSignal;
}

/**
 * 拉取模型列表。
 * 失败时抛出带 HTTP 状态与响应片段的 Error，由 UI 转成用户提示；
 * 密钥只放在请求头里，不写日志、不落盘。
 */
export async function fetchLlmModels(input: FetchLlmModelsInput): Promise<LlmModelInfo[]> {
  const endpoint = modelsEndpoint(input.baseUrl, input.protocol);
  if (!endpoint) throw new Error('Base URL is empty');

  let url = endpoint;
  if (input.protocol === 'anthropic') {
    try {
      const u = new URL(endpoint);
      if (!u.searchParams.has('limit')) u.searchParams.set('limit', '100');
      url = u.toString();
    } catch {
      // 非标准 URL 就按原样请求，错误由 fetch / 服务端返回
    }
  }

  const signal = input.signal
    ?? (typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(20_000) : undefined);
  const res = await fetch(url, {
    method: 'GET',
    headers: modelsHeaders(input.protocol, input.apiKey),
    signal,
  });

  if (!res.ok) {
    let body = '';
    try {
      body = (await res.text()).slice(0, 200).replace(/\s+/g, ' ').trim();
    } catch {
      // 响应体不可读时只报状态码
    }
    throw new Error(`HTTP ${res.status}${body ? `: ${body}` : ''}`);
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new Error('Invalid JSON response');
  }
  return parseLlmModels(json);
}
