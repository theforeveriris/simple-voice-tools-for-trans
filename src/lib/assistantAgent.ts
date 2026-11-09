/**
 * AI 助手的有界工具循环
 *
 * 只负责“决定查什么 → 执行本地工具 → 把结果回填”，不生成最终回答。
 * 最终回答仍走原有流式对话，工具结果作为系统上下文注入，保证首字延迟和
 * 现有 UI 不变。服务商不支持 tools 时静默返回 supported=false，调用方回退
 * 到预注入上下文。
 */
import {
  llmChatToolMessages,
  isAbortError,
  type LlmConfig,
  type LlmToolSpec,
  type LlmToolTurn,
} from './llm';
import type { AssistantToolOutcome } from './assistantTools';

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

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * @param opts.history 最近几轮对话（不含 system），用于理解「那上周呢」这类追问
 * @param opts.userText 当前用户问题
 * @param opts.execute 本地工具执行器；返回 null 表示未知工具
 */
export async function runAssistantTools(opts: {
  cfg: LlmConfig;
  system: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  userText: string;
  tools: LlmToolSpec[];
  execute: (name: string, args: Record<string, unknown>) => Promise<AssistantToolOutcome | null>;
  signal?: AbortSignal;
  maxRounds?: number;
  maxCalls?: number;
}): Promise<AssistantToolRun> {
  const {
    cfg,
    system,
    history,
    userText,
    tools,
    execute,
    signal,
    maxRounds = 3,
    maxCalls = 6,
  } = opts;
  if (tools.length === 0 || !userText.trim()) return EMPTY;

  const transcript = history
    .slice(-6)
    .map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content.slice(0, 600)}`)
    .join('\n');
  const messages: LlmToolTurn[] = [
    {
      role: 'user',
      content: [
        transcript ? `【最近对话】\n${transcript}` : '',
        `【当前问题】\n${userText.slice(0, 1200)}`,
        '请判断回答这个问题是否需要查询应用内的记录或文档。需要就调用工具；不需要就不要再调用。不要直接回答用户。',
      ].filter(Boolean).join('\n\n'),
    },
  ];

  const traces: AssistantToolTrace[] = [];
  const results: { summary: string; text: string }[] = [];
  const recordIdSet = new Set<string>();
  const docs: { title: string; chars: number }[] = [];
  const seenDocs = new Set<string>();
  let pendingAction: AssistantToolRun['pendingAction'];
  let pendingChoice: AssistantToolRun['pendingChoice'];
  let pendingChoiceSet: AssistantToolRun['pendingChoiceSet'];
  let callsUsed = 0;
  let halt = false;
  try {
    for (let round = 0; round < maxRounds && callsUsed < maxCalls; round++) {
      const res = await llmChatToolMessages(cfg, system, messages, tools, {
        signal,
        feature: 'assistant',
        maxTokens: 500,
        temperature: 0,
      });
      if (res.toolCalls.length === 0) break;
      messages.push({ role: 'assistant', content: res.content, toolCalls: res.toolCalls });
      for (const call of res.toolCalls) {
        if (callsUsed >= maxCalls) break;
        callsUsed++;
        const started = Date.now();
        let outcome: AssistantToolOutcome | null = null;
        let failure = '';
        try {
          outcome = await execute(call.name, call.arguments);
          if (!outcome) failure = `未知工具：${call.name}`;
        } catch (err) {
          failure = errorText(err);
        }
        const text = outcome?.text ?? `工具执行失败：${failure || '无结果'}`;
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          toolName: call.name,
          content: text.slice(0, 6000),
        });
        traces.push({
          name: call.name,
          summary: outcome?.summary ?? '执行失败',
          ok: outcome != null,
          ms: Date.now() - started,
        });
        if (outcome) {
          results.push({ summary: outcome.summary, text: outcome.text });
          if (outcome.pendingAction && !pendingAction) pendingAction = outcome.pendingAction;
          if (outcome.pendingChoice && !pendingChoice) {
            pendingChoice = outcome.pendingChoice;
            halt = true;
          }
          if (outcome.pendingChoiceSet && !pendingChoiceSet) {
            pendingChoiceSet = outcome.pendingChoiceSet;
            halt = true;
          }
          for (const id of outcome.recordIds ?? []) recordIdSet.add(id);
          for (const doc of outcome.docs ?? []) {
            if (seenDocs.has(doc.title)) continue;
            seenDocs.add(doc.title);
            docs.push(doc);
          }
        }
        if (halt) break;
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
    ...(pendingAction ? { pendingAction } : {}),
    ...(pendingChoice ? { pendingChoice } : {}),
    ...(pendingChoiceSet ? { pendingChoiceSet } : {}),
  };
}
