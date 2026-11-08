/**
 * LLM 请求客户端（协议层）
 * OpenAI 兼容（/chat/completions）与 Anthropic（/v1/messages）双协议的
 * 请求组装、SSE 流式解析与用量提取。不含任何业务提示词；
 * 建议 / 周报 / 助手 / 翻译共用本层（入口 re-export 见 llm.ts）。
 */

import { recordLlmUsage, type LlmFeature, type LlmUsageReal } from '@/lib/llmUsage';
import { recordLlmRequest } from '@/lib/llmRequestLog';

/** API 协议：OpenAI 兼容（/chat/completions）或 Anthropic（/v1/messages） */
export type LlmProtocol = 'openai' | 'anthropic';

/** 大模型接口配置（由档案解析而来；protocol/stream/context 为档案可选字段） */
export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  /** API 协议：默认 openai（兼容 chat/completions；Gemini 走其 OpenAI 兼容端点） */
  protocol?: LlmProtocol;
  /** 流式输出：默认 true；端点不支持 SSE 的档案应设为 false */
  stream?: boolean;
  /** 上下文窗口（tokens）：AI 助手据此注入历史并裁剪对话 */
  contextTokens?: number;
}

/** 从设置/表单解析配置；三项任一为空返回 null（调用方提示先补全） */
export function resolveLlmConfig(s: {
  llmBaseUrl?: string;
  llmApiKey?: string;
  llmModelId?: string;
  protocol?: LlmProtocol;
  stream?: boolean;
  contextTokens?: number;
}): LlmConfig | null {
  const baseUrl = s.llmBaseUrl?.trim().replace(/\/+$/, '') ?? '';
  const apiKey = s.llmApiKey?.trim() ?? '';
  const modelId = s.llmModelId?.trim() ?? '';
  if (!baseUrl || !apiKey || !modelId) return null;
  return {
    baseUrl,
    apiKey,
    modelId,
    protocol: s.protocol,
    stream: s.stream,
    contextTokens: s.contextTokens,
  };
}

type ChatTurn = { role: 'user' | 'assistant'; content: string };

/** 工具定义（OpenAI function / Anthropic tool 共用 JSON Schema） */
export interface LlmToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** 一次工具调用（OpenAI tool_call / Anthropic tool_use 归一化） */
export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Anthropic Messages API 必须显式给出输出上限 */
const ANTHROPIC_MAX_TOKENS = 2048;

function chatHeaders(cfg: LlmConfig): Record<string, string> {
  if (cfg.protocol === 'anthropic') {
    return {
      'content-type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
      // 浏览器直连 api.anthropic.com 必须显式声明，否则被 CORS 拒（authentication_error）
      'anthropic-dangerous-direct-browser-access': 'true',
    };
  }
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` };
}

function chatEndpoint(cfg: LlmConfig): string {
  const base = cfg.baseUrl.trim().replace(/\/+$/, '');
  if (cfg.protocol === 'anthropic') {
    if (/\/messages$/.test(base)) return base;
    if (/\/v1$/.test(base)) return `${base}/messages`;
    return `${base}/v1/messages`;
  }
  if (/\/chat\/completions$/.test(base)) return base;
  return `${base}/chat/completions`;
}

/** 按协议组装请求体；system 为空时省略该字段 */
function buildChatBody(
  cfg: LlmConfig,
  system: string,
  turns: ChatTurn[],
  stream: boolean,
  temperature: number,
) {
  if (cfg.protocol === 'anthropic') {
    return {
      model: cfg.modelId,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      temperature,
      stream,
      ...(system ? { system } : {}),
      messages: turns,
    };
  }
  return {
    model: cfg.modelId,
    temperature,
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...turns,
    ],
  };
}

type ChatResponseData = {
  choices?: { message?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown } }[];
  content?: { type?: unknown; text?: unknown; thinking?: unknown }[];
  usage?: Record<string, unknown>;
};

/** 从响应体提取回复文本（OpenAI 取 choices，Anthropic 拼接 text 块） */
function responseContent(cfg: LlmConfig, data: ChatResponseData): string {
  if (cfg.protocol === 'anthropic') {
    return (data.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('');
  }
  const c = data.choices?.[0]?.message?.content;
  return typeof c === 'string' ? c : '';
}

/** 从响应体提取思考过程（DeepSeek-R1 reasoning_content / OpenRouter reasoning / Anthropic thinking 块） */
function responseThink(cfg: LlmConfig, data: ChatResponseData): string {
  if (cfg.protocol === 'anthropic') {
    return (data.content ?? [])
      .filter((b) => b.type === 'thinking' && typeof b.thinking === 'string')
      .map((b) => b.thinking as string)
      .join('');
  }
  const m = data.choices?.[0]?.message;
  const r = m?.reasoning_content ?? m?.reasoning;
  return typeof r === 'string' ? r : '';
}

/** 从响应体取 usage（按协议字段名）；缺任一项视为未提供 */
function extractUsage(cfg: LlmConfig, data: { usage?: Record<string, unknown> } | null): LlmUsageReal | null {
  const u = data?.usage;
  if (!u || typeof u !== 'object') return null;
  const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : null);
  if (cfg.protocol === 'anthropic') {
    const p = num(u.input_tokens);
    const c = num(u.output_tokens);
    return p != null && c != null ? { promptTokens: p, completionTokens: c } : null;
  }
  const p = num(u.prompt_tokens);
  const c = num(u.completion_tokens);
  return p != null && c != null ? { promptTokens: p, completionTokens: c } : null;
}

/** 请求完成后落账 Token 用量（feature 未标注的调用不计） */
function trackUsage(
  feature: LlmFeature | undefined,
  cfg: LlmConfig,
  system: string,
  user: string,
  content: string,
  real: LlmUsageReal | null,
): void {
  if (!feature) return;
  recordLlmUsage(feature, cfg.modelId, `${system}\n${user}`, content, real);
}

/** HTTP 错误摘要：状态码 + 接口返回的 error.message（截断） */
async function describeHttpError(res: Response): Promise<string> {
  const body = await res.text().catch(() => '');
  let msg = `HTTP ${res.status}`;
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string };
    const em = typeof j.error === 'string' ? j.error : j.error?.message;
    if (em) msg += `: ${em.slice(0, 160)}`;
  } catch {
    if (body) msg += `: ${body.slice(0, 160)}`;
  }
  return msg;
}

/**
 * chat 调用（非流式语义）：返回模型回复文本；HTTP 错误 / 空回复抛出可读 Error
 * （AI 翻译 / 连接测试共用）；signal 用于取消（后台任务中断）；
 * feature 用于 Token 用量归账（省略则不计）。
 * 统一走流式核心：内部按档案的协议与流式开关选择请求形态，结果完全一致。
 */
export async function llmChat(
  cfg: LlmConfig,
  system: string,
  user: string,
  temperature = 0.3,
  signal?: AbortSignal,
  feature?: LlmFeature,
): Promise<string> {
  return llmChatStreamMessages(cfg, [{ role: 'user', content: user }], {
    system, temperature, signal, feature,
  });
}

/** 连接测试超时：接口挂起时不能让按钮永远转圈；30s 兼顾慢网络 / 推理模型首响应 / 自建服务冷启动 */
const TEST_TIMEOUT_MS = 30_000;

/** 最小连通性测试：返回模型回复摘要（供 toast 展示），失败/超时抛错 */
export async function testLlmConnection(cfg: LlmConfig): Promise<string> {
  let content: string;
  try {
    const signal = typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(TEST_TIMEOUT_MS)
      : undefined;
    content = await llmChat(cfg, 'You are a connectivity test.', 'Reply with exactly: OK', 0, signal, 'test');
  } catch (err: unknown) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new Error(`Request timeout (${TEST_TIMEOUT_MS / 1000}s)`);
    }
    throw err;
  }
  // 回复异常（空 / JSON 体 / 超长）时直接展示模型 ID，避免 toast 出现一大段文字
  const trimmed = content.trim();
  return trimmed && !trimmed.startsWith('{') && trimmed.length <= 40
    ? trimmed
    : cfg.modelId;
}

/** 判断错误是否为请求取消（AbortSignal 触发），调用方据此区分「已取消」与失败 */
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * SSE 缓冲解析：提取已完整到达的 `data:` 行载荷，末尾半行留在 rest 与下一块拼接。
 * 容忍 \r\n 与裸 \r 行分隔；非 data 行（注释 / 事件名 / 空行）直接忽略。
 */
export function extractDataLines(buffer: string): { payloads: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n?/g, '\n');
  const lastNl = normalized.lastIndexOf('\n');
  const complete = lastNl === -1 ? '' : normalized.slice(0, lastNl);
  const rest = lastNl === -1 ? normalized : normalized.slice(lastNl + 1);
  const payloads: string[] = [];
  for (const line of complete.split('\n')) {
    const m = line.match(/^data:\s?(.*)$/);
    if (m) payloads.push(m[1]);
  }
  return { payloads, rest };
}

/** 流式调用选项：temperature 默认 0.3；onDelta 每收到增量回调一次累积全文；
 *  onThink 每收到思考增量回调一次累积思考文本（推理模型 / Anthropic thinking） */
export interface LlmStreamOptions {
  temperature?: number;
  signal?: AbortSignal;
  onDelta?: (accumulated: string) => void;
  onThink?: (accumulated: string) => void;
  /** Token 用量归账功能名（省略则不计） */
  feature?: LlmFeature;
}

/**
 * OpenAI 兼容 chat 调用（SSE 流式）：训练建议 / 周报共用，逐字回调 onDelta，
 * 返回完整回复文本。服务商忽略 stream 参数时退回整体 JSON 一次性回调；
 * usage 在 stream_options.include_usage 的末尾块（choices 为空数组）捕获。
 */
export async function llmChatStream(
  cfg: LlmConfig,
  system: string,
  user: string,
  opts: LlmStreamOptions = {},
): Promise<string> {
  return llmChatStreamMessages(cfg, [{ role: 'user', content: user }], { ...opts, system });
}

/**
 * 多轮流式 chat（AI 助手）：turns 为不含 system 的对话历史（user / assistant
 * 交替），流式解析与单轮共用同一条路径。
 */
export async function llmChatStreamMessages(
  cfg: LlmConfig,
  turns: { role: 'user' | 'assistant'; content: string }[],
  opts: LlmStreamOptions & { system?: string } = {},
): Promise<string> {
  const { temperature = 0.3, signal, onDelta, onThink, feature, system = '' } = opts;
  // 流式开关：档案级（端点不支持 SSE 时关掉）；服务商忽略 stream 参数也会自动退回整体解析
  const wantStream = cfg.stream !== false;
  const body = buildChatBody(cfg, system, turns, wantStream, temperature);
  // 数据透明：请求体（不含 API Key，其在鉴权头）留档供 设置 → 数据 面板查看
  void recordLlmRequest(feature, cfg, body, wantStream);
  const res = await fetch(chatEndpoint(cfg), {
    method: 'POST',
    headers: chatHeaders(cfg),
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(await describeHttpError(res));

  const ctype = res.headers.get('content-type') ?? '';
  const joined = turns.map((t) => t.content).join('\n');

  if (!wantStream || !ctype.includes('text/event-stream')) {
    // 非流式（开关关闭或服务商不支持）：整体读取，一次性回调
    let data: ChatResponseData;
    try {
      data = (await res.json()) as ChatResponseData;
    } catch {
      // HTTP 200 但响应体不是 JSON（自建网关错误页等）：给出可读原因而非裸 SyntaxError
      throw new Error('Response is not valid JSON');
    }
    const content = responseContent(cfg, data);
    if (!content.trim()) throw new Error('Empty response');
    const think = responseThink(cfg, data);
    if (think) onThink?.(think);
    trackUsage(feature, cfg, system, joined, content, extractUsage(cfg, data));
    onDelta?.(content);
    return content;
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let think = '';
  // usage 拆成两个数字累积（对象形式会触发 TS 对 null 收窄后的属性访问报错）
  let usageIn: number | null = null;
  let usageOut: number | null = null;
  let finished = false;
  try {
    while (!finished) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { payloads, rest } = extractDataLines(buffer);
      buffer = rest;
      for (const payload of payloads) {
        if (payload === '[DONE]') {
          finished = true;
          break;
        }
        let obj: Record<string, unknown>;
        try {
          obj = JSON.parse(payload);
        } catch {
          continue;
        }
        // 各协议的增量结构：
        //  OpenAI：choices[0].delta.content；思考 = delta.reasoning_content（DeepSeek-R1）/ delta.reasoning（OpenRouter）
        //  Anthropic：content_block_delta（text_delta / thinking_delta）；usage 在 message_start / message_delta
        if (cfg.protocol === 'anthropic') {
          const type = obj.type as string | undefined;
          if (type === 'content_block_delta') {
            const delta = obj.delta as { type?: unknown; text?: unknown; thinking?: unknown } | undefined;
            if (delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text) {
              content += delta.text;
              onDelta?.(content);
            } else if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string' && delta.thinking) {
              think += delta.thinking;
              onThink?.(think);
            }
          } else if (type === 'message_start' || type === 'message_delta') {
            const u = (type === 'message_start'
              ? (obj.message as { usage?: Record<string, unknown> } | undefined)?.usage
              : obj.usage) as Record<string, unknown> | undefined;
            const inp = typeof u?.input_tokens === 'number' ? u.input_tokens : null;
            const out = typeof u?.output_tokens === 'number' ? u.output_tokens : null;
            if (inp != null) usageIn = inp;
            if (out != null) usageOut = out;
          }
        } else {
          const delta = (obj as {
            choices?: { delta?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown } }[];
          }).choices?.[0]?.delta;
          if (typeof delta?.content === 'string' && delta.content) {
            content += delta.content;
            onDelta?.(content);
          }
          const r = delta?.reasoning_content ?? delta?.reasoning;
          if (typeof r === 'string' && r) {
            think += r;
            onThink?.(think);
          }
          const real = extractUsage(cfg, obj);
          if (real) {
            usageIn = real.promptTokens;
            usageOut = real.completionTokens;
          }
        }
      }
    }
  } finally {
    // 提前结束（[DONE] / 出错）时释放连接
    void reader.cancel().catch(() => {});
  }
  if (!content.trim()) throw new Error('Empty response');
  const usage: LlmUsageReal | null = usageIn != null && usageOut != null
    ? { promptTokens: usageIn, completionTokens: usageOut }
    : null;
  trackUsage(feature, cfg, system, joined, content, usage);
  return content;
}

/**
 * 归一化工具调用：OpenAI 的 message.tool_calls / Anthropic 的 content[].tool_use。
 * 参数解析失败时返回空对象（由调用方兜底），不因单个脏参数丢掉整轮工具调用。
 */
export function parseToolCalls(protocol: LlmProtocol | undefined, data: unknown): LlmToolCall[] {
  const out: LlmToolCall[] = [];
  if (protocol === 'anthropic') {
    const content = (data as { content?: unknown } | null)?.content;
    if (!Array.isArray(content)) return out;
    for (const raw of content) {
      const block = raw as { type?: unknown; id?: unknown; name?: unknown; input?: unknown };
      if (block.type !== 'tool_use' || typeof block.name !== 'string') continue;
      out.push({
        id: typeof block.id === 'string' ? block.id : '',
        name: block.name,
        arguments:
          block.input && typeof block.input === 'object'
            ? (block.input as Record<string, unknown>)
            : {},
      });
    }
    return out;
  }
  const message = (data as {
    choices?: { message?: { tool_calls?: unknown } }[];
  } | null)?.choices?.[0]?.message;
  const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  for (const raw of calls) {
    const call = raw as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
    const fn = call.function;
    if (!fn || typeof fn.name !== 'string') continue;
    let args: Record<string, unknown> = {};
    if (typeof fn.arguments === 'string') {
      try {
        const parsed = JSON.parse(fn.arguments) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        /* 参数不是合法 JSON：保留空对象，由调用方使用默认查询 */
      }
    } else if (fn.arguments && typeof fn.arguments === 'object') {
      args = fn.arguments as Record<string, unknown>;
    }
    out.push({ id: typeof call.id === 'string' ? call.id : '', name: fn.name, arguments: args });
  }
  return out;
}

/** 组装工具请求体（非流式；OpenAI function / Anthropic tool schema） */
function buildToolBody(
  cfg: LlmConfig,
  system: string,
  user: string,
  tools: LlmToolSpec[],
  maxTokens: number,
  temperature: number,
) {
  if (cfg.protocol === 'anthropic') {
    return {
      model: cfg.modelId,
      max_tokens: maxTokens,
      temperature,
      ...(system ? { system } : {}),
      messages: [{ role: 'user', content: user }],
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      })),
    };
  }
  return {
    model: cfg.modelId,
    temperature,
    max_tokens: maxTokens,
    stream: false,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: user },
    ],
    tools: tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    })),
    tool_choice: 'auto',
  };
}

/**
 * 非流式工具调用：给模型 tools 与一条 user 消息，返回它选择的工具。
 * 用于 AI 助手的「按需记忆检索」预检；服务商不支持 tools 时抛错，由调用方回退。
 */
export async function llmToolCall(
  cfg: LlmConfig,
  system: string,
  user: string,
  tools: LlmToolSpec[],
  opts: {
    signal?: AbortSignal;
    feature?: LlmFeature;
    maxTokens?: number;
    temperature?: number;
  } = {},
): Promise<LlmToolCall[]> {
  const { signal, feature, maxTokens = 256, temperature = 0 } = opts;
  const body = buildToolBody(cfg, system, user, tools, maxTokens, temperature);
  void recordLlmRequest(feature, cfg, body, false);
  const res = await fetch(chatEndpoint(cfg), {
    method: 'POST',
    headers: chatHeaders(cfg),
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(await describeHttpError(res));
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error('Response is not valid JSON');
  }
  const calls = parseToolCalls(cfg.protocol, data);
  trackUsage(
    feature,
    cfg,
    system,
    user,
    JSON.stringify(calls),
    extractUsage(cfg, data as { usage?: Record<string, unknown> }),
  );
  return calls;
}
