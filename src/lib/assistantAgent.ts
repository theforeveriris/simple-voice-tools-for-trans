/**
 * AI 助手的有界工具循环
 *
 * 只负责“决定查什么 → 执行本地工具 → 把结果回填”，不生成最终回答。
 * 最终回答仍走原有流式对话，工具结果作为系统上下文注入，保证首字延迟和
 * 现有 UI 不变。服务商不支持 tools 时静默返回 supported=false，调用方回退
 * 到预注入上下文。
 *
 * 工程约束：
 * - 同一轮全是只读工具时并行执行（有副作用 / 需要用户交互的调用仍串行）；
 * - 每个工具都有超时，用户中止时通过 AbortSignal 尽快退出；
 * - 参数按 tool schema 做轻量校验，非法时把错误回填给模型修正一次。
 */
import {
  llmChatToolMessages,
  isAbortError,
  type LlmConfig,
  type LlmToolCall,
  type LlmToolSpec,
  type LlmToolTurn,
} from './llm';
import type { AssistantToolOutcome } from './assistantTools';
import { validateToolArgs } from './assistantToolValidation';
import { parseTextToolCalls } from './llmTextTools';

export interface AssistantToolTrace {
  name: string;
  summary: string;
  ok: boolean;
  ms: number;
}

export interface AssistantToolRun {
  /** 请求成功走完了工具协议（即使模型选择不调用工具） */
  supported: boolean;
  /** 供最终回答注入的工具结果文本 */
  contextText: string;
  traces: AssistantToolTrace[];
  recordIds: string[];
  docs: { title: string; chars: number }[];
  /** 跨对话检索命中的来源 */
  chatRefs?: import('./llmChats').ChatRef[];
  /** 本轮提出的待确认写操作 */
  pendingAction?: import('./assistantActions').AssistantAction;
  /** 本轮提出的待用户选择问题 */
  pendingChoice?: import('./assistantChoice').PendingChoice;
  /** 本轮提出的多问题卡 */
  pendingChoiceSet?: import('./assistantChoice').PendingChoiceSet;
}

const EMPTY: AssistantToolRun = {
  supported: false,
  contextText: '',
  traces: [],
  recordIds: [],
  docs: [],
};

const MAX_CONTEXT_CHARS = 8000;
const MAX_ROUNDS = 3;
const MAX_CALLS = 6;
const READ_ONLY_CONCURRENCY = 4;
const DEFAULT_TOOL_TIMEOUT_MS = 8000;

/**
 * 只读、无副作用的工具：同一轮可以并行。
 * 副作用工具（propose_action / create_plan / log_practice / ask_choice…）不能并行，
 * 否则可能出现“用户还没确认就执行了下一个动作”。
 */
const READ_ONLY_TOOLS = new Set([
  'query_records',
  'get_record',
  'compare_records',
  'search_docs',
  'search_memory',
  'get_plan',
  'get_trends',
  'search_chats',
  'get_stats',
  'get_context',
]);

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 失败 trace 的短摘要：参数 / 未知 / 超时保留原因，其余统一「执行失败」 */
function failureSummary(failure: string): string {
  if (
    failure.startsWith('工具参数')
    || failure.startsWith('未知工具')
    || failure.startsWith('工具超时')
  ) {
    return failure.length > 60 ? `${failure.slice(0, 57)}…` : failure;
  }
  return '执行失败';
}

function abortError(): Error {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}

/** 给工具执行加超时，并监听上层中止信号 */
function withToolTimeout<T>(
  task: Promise<T>,
  ms: number,
  signal: AbortSignal | undefined,
  label: string,
): Promise<T> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new Error(`工具超时：${label}（>${ms}ms）`)));
    }, ms);
    const onAbort = () => finish(() => reject(abortError()));
    signal?.addEventListener('abort', onAbort, { once: true });
    task.then(
      (value) => finish(() => resolve(value)),
      (err) => finish(() => reject(err)),
    );
  });
}

/** 限制并发地执行一组任务，结果保持输入顺序 */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      out[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

interface CallResult {
  call: LlmToolCall;
  outcome: AssistantToolOutcome | null;
  failure: string;
  ms: number;
}

/**
 * @param opts.history 最近几轮对话（不含 system），用于理解「那上周呢」这类追问
 * @param opts.userText 当前用户问题
 * @param opts.execute 本地工具执行器；返回 null 表示未知工具
 * @param opts.toolTimeoutMs 单个工具超时，默认 8 秒
 */
export async function runAssistantTools(opts: {
  cfg: LlmConfig;
  system: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  userText: string;
  tools: LlmToolSpec[];
  execute: (
    name: string,
    args: Record<string, unknown>,
    ctx: { signal?: AbortSignal },
  ) => Promise<AssistantToolOutcome | null>;
  signal?: AbortSignal;
  toolTimeoutMs?: number;
}): Promise<AssistantToolRun> {
  const { cfg, system, history, userText, tools, execute, signal } = opts;
  const timeoutMs = opts.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  const messages: LlmToolTurn[] = [
    ...history,
    { role: 'user', content: userText },
  ];
  const traces: AssistantToolTrace[] = [];
  const results: { summary: string; text: string }[] = [];
  const recordIdSet = new Set<string>();
  const docs: { title: string; chars: number }[] = [];
  const seenDocs = new Set<string>();
  const chatRefs: import('./llmChats').ChatRef[] = [];
  const seenChatRefs = new Set<string>();
  const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
  const repairAttempts = new Map<string, number>();
  let pendingAction: AssistantToolRun['pendingAction'];
  let pendingChoice: AssistantToolRun['pendingChoice'];
  let pendingChoiceSet: AssistantToolRun['pendingChoiceSet'];
  let callsUsed = 0;
  let halt = false;

  /** 执行一次调用：校验 → 超时包装 → 捕获失败 */
  const executeOne = async (call: LlmToolCall): Promise<CallResult> => {
    const started = Date.now();
    const spec = toolByName.get(call.name);
    if (!spec) {
      return {
        call,
        outcome: null,
        failure: `未知工具：${call.name}`,
        ms: Date.now() - started,
      };
    }
    const argError = validateToolArgs(spec, call.arguments);
    if (argError) {
      const attempts = (repairAttempts.get(call.name) ?? 0) + 1;
      repairAttempts.set(call.name, attempts);
      return {
        call,
        outcome: null,
        failure: attempts <= 1
          ? `工具参数无效：${argError}。请修正参数后重试。`
          : `工具参数仍未修正：${argError}。已停止重试。`,
        ms: Date.now() - started,
      };
    }
    try {
      const outcome = await withToolTimeout(
        execute(call.name, call.arguments, { signal }),
        timeoutMs,
        signal,
        call.name,
      );
      return { call, outcome, failure: '', ms: Date.now() - started };
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) throw abortError();
      return {
        call,
        outcome: null,
        failure: errorText(err),
        ms: Date.now() - started,
      };
    }
  };

  /** 把一次执行结果回填到消息、trace、上下文；返回是否应停止后续轮次 */
  const processResult = (result: CallResult): boolean => {
    const { call, outcome, failure } = result;
    const text = outcome?.text ?? `工具执行失败：${failure || '无结果'}`;
    messages.push({
      role: 'tool',
      toolCallId: call.id,
      toolName: call.name,
      content: text.slice(0, 6000),
    });
    traces.push({
      name: call.name,
      summary: outcome?.summary ?? failureSummary(failure),
      ok: outcome != null,
      ms: result.ms,
    });
    if (outcome) {
      results.push({ summary: outcome.summary, text: outcome.text });
      if (outcome.pendingAction && !pendingAction) pendingAction = outcome.pendingAction;
      if (outcome.pendingChoice && !pendingChoice) pendingChoice = outcome.pendingChoice;
      if (outcome.pendingChoiceSet && !pendingChoiceSet) pendingChoiceSet = outcome.pendingChoiceSet;
      for (const id of outcome.recordIds ?? []) recordIdSet.add(id);
      for (const doc of outcome.docs ?? []) {
        if (seenDocs.has(doc.title)) continue;
        seenDocs.add(doc.title);
        docs.push(doc);
      }
      for (const ref of outcome.chatRefs ?? []) {
        const key = `${ref.chatId}:${ref.messageIndex}`;
        if (seenChatRefs.has(key)) continue;
        seenChatRefs.add(key);
        chatRefs.push(ref);
      }
    }
    return !!pendingChoice || !!pendingChoiceSet;
  };

  try {
    for (let round = 0; round < MAX_ROUNDS && callsUsed < MAX_CALLS; round++) {
      const res = await llmChatToolMessages(cfg, system, messages, tools, {
        signal,
        feature: 'assistant',
        maxTokens: 500,
        temperature: 0,
      });
      if (res.toolCalls.length === 0) {
        // 部分模型（如 agnes）把调用写成文本 <tool_call>get_stats(...)</tool_call>。
        // 解析后执行一次；不再回填 tool 消息，最终回答直接使用工具结果上下文。
        const textCalls = parseTextToolCalls(res.content);
        if (textCalls.length === 0) break;
        const accepted = textCalls.slice(0, Math.max(0, MAX_CALLS - callsUsed));
        callsUsed += accepted.length;
        for (const call of accepted) {
          const result = await executeOne(call);
          if (processResult(result)) {
            halt = true;
            break;
          }
        }
        break;
      }
      messages.push({ role: 'assistant', content: res.content, toolCalls: res.toolCalls });

      const accepted = res.toolCalls.slice(0, Math.max(0, MAX_CALLS - callsUsed));
      callsUsed += accepted.length;
      const allReadOnly = accepted.length > 1
        && accepted.every((call) => READ_ONLY_TOOLS.has(call.name));

      if (allReadOnly) {
        // 只读工具互不依赖：并行执行，再按原始顺序回填，保证消息顺序稳定
        const batch = await runWithConcurrency(accepted, READ_ONLY_CONCURRENCY, executeOne);
        for (const result of batch) {
          if (processResult(result)) {
            halt = true;
            break;
          }
        }
      } else {
        // 副作用工具 / 需要用户交互：严格串行，并在暂停时停止后续调用
        for (const call of accepted) {
          const result = await executeOne(call);
          if (processResult(result)) {
            halt = true;
            break;
          }
        }
      }
      if (halt) break;
    }
  } catch (err) {
    if (isAbortError(err)) throw err;
    // 服务商不支持 tools / 网络失败：调用方回退到预注入上下文
    return { ...EMPTY, traces };
  }

  const recordIds = [...recordIdSet];
  let contextText = '';
  if (results.length > 0) {
    const blocks = results.map((r, i) => `${i + 1}. ${r.summary}\n${r.text}`);
    contextText = [
      '【本轮工具查询结果】',
      '以下是助手刚刚通过工具读取到的真实数据。回答时优先使用这些结果；引用记录图表时只能使用其中出现的 id。',
      ...blocks,
    ].join('\n\n').slice(0, MAX_CONTEXT_CHARS);
  }
  return {
    supported: true,
    contextText,
    traces,
    recordIds,
    docs,
    ...(chatRefs.length > 0 ? { chatRefs } : {}),
    ...(pendingAction ? { pendingAction } : {}),
    ...(pendingChoice ? { pendingChoice } : {}),
    ...(pendingChoiceSet ? { pendingChoiceSet } : {}),
  };
}
