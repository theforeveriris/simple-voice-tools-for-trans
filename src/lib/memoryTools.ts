/**
 * AI 长期记忆的「写入」工具与提示词
 * - 自动整理：每轮回答完成后，让模型判断这一轮是否有值得长期保存的用户信息；
 *   有则调用 save_memory，由 App 直接入库（可撤销 toast）。
 * - 手动「记住」：打开确认框时让模型先提炼一条候选（可概括助手结论），
 *   不再把整段助手回复塞进输入框。
 * 读取/按需求检索见 memory.ts 的 searchMemories 与 AssistantPage 的 search_memory 路由。
 */
import type { LlmToolCall, LlmToolSpec } from './llm';
import { MEMORY_TEXT_MAX, type MemoryKind } from './memory';

/** AI 可调用的记忆写入工具 */
export const SAVE_MEMORY_TOOL: LlmToolSpec = {
  name: 'save_memory',
  description:
    '保存一条关于用户的长期记忆（身份、训练方向、声线偏好、禁忌词、长期目标、设备或时间限制）。只保存用户本人明确陈述、确认或点「记住」想要保留的内容；不要保存助手自己的建议、常识、临时任务、寒暄或敏感信息。',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: '一条简洁、自包含的陈述（不超过 80 字），用「用户…」或直接陈述',
      },
      kind: {
        type: 'string',
        enum: ['fact', 'preference', 'requirement', 'caution'],
        description: '事实 / 偏好 / 要求 / 注意',
      },
      pinned: {
        type: 'boolean',
        description: '仅在用户明确要求「每次 / 始终记住」时为 true',
      },
    },
    required: ['text', 'kind'],
  },
};

/** 记忆整理器系统提示（自动保存：只收用户本人陈述的信息） */
export const MEMORY_WRITER_SYSTEM = [
  '你是用户的长期记忆整理器。',
  '从下面这一轮对话中，提炼用户本人值得长期保留的信息：身份、训练方向、声线偏好、禁忌词、长期目标、设备或时间限制。',
  '只保存用户明确陈述或确认的内容；不要保存助手自己的建议、常识、临时任务、寒暄，也不要保存医疗诊断、联系方式、住址等敏感信息，除非用户明确要求记住。',
  '写成一条简洁、自包含的中文陈述（不超过 80 字），用 save_memory 工具提交。',
  '没有值得保存的就不要调用工具；不要回答用户，不要解释。',
].join('\n');

/**
 * 手动「记住」的整理提示：用户已点按按钮，视为明确确认，
 * 因此允许把助手回复里的关键结论 / 方法 / 参考值也概括进来，
 * 但仍然只产出一条简洁的自包含陈述，避免把整段回答塞进记忆。
 */
export const MEMORY_MANUAL_SYSTEM = [
  '你在帮用户把一段对话整理成一条长期记忆。',
  '用户刚点了「记住」，表示他认可这段内容并希望以后继续参考。',
  '从下面的用户消息与助手回复里，提炼用户最可能想长期记住的一条要点：优先用户本人的情况、偏好、要求；也可以是助手给出的关键结论、方法或参考值。',
  '写成一条简洁、自包含的中文陈述（不超过 80 字），不要照抄整段回复，不要寒暄。',
  '用 save_memory 工具提交；不要回答用户，不要解释。',
].join('\n');

/**
 * 选择卡答案的记忆整理提示：
 * 选择卡是 AI 主动追问的合成答案，其中很多是临时选择（先看哪个示例、下一步做什么）。
 * 只允许稳定偏好进入长期记忆，避免把交互过程当成用户陈述。
 */
export const MEMORY_CHOICE_WRITER_SYSTEM = [
  '你在帮用户整理一次选择卡回答中的长期偏好。',
  '只保存稳定、可复用的信息：训练方向 / 重点、目标音区或听感、每次时长、每周频率、长期禁忌或限制。',
  '不要保存临时选择：先看哪个示例、先做哪一步、演示选项、页面跳转、一次性的下一步。',
  '只保存用户明确选中的内容；不确定就不调用工具。',
  '最多保存一条，写成简洁、自包含的中文陈述（不超过 80 字），kind 优先 preference 或 requirement。',
  '用 save_memory 工具提交；不要回答用户，不要解释。',
].join('\n');

/** 一轮对话整理输入（控制长度，避免把整段历史再发一遍） */
export function buildMemoryWriterInput(userText: string, assistantText: string): string {
  return [
    '【用户消息】',
    userText.slice(0, 1200),
    '【助手回复】',
    assistantText.slice(0, 2000),
  ].join('\n');
}

const KINDS = new Set<MemoryKind>(['fact', 'preference', 'requirement', 'caution']);

/** 把 save_memory 工具调用解析为可入库的记忆；字段非法时兜底为 fact */
export function parseMemorySaveCall(
  call: LlmToolCall,
): { text: string; kind: MemoryKind; pinned: boolean } | null {
  if (call.name !== 'save_memory') return null;
  const raw = call.arguments;
  const text = typeof raw.text === 'string' ? raw.text.trim().slice(0, MEMORY_TEXT_MAX) : '';
  if (!text) return null;
  const kind = KINDS.has(raw.kind as MemoryKind) ? (raw.kind as MemoryKind) : 'fact';
  return { text, kind, pinned: raw.pinned === true };
}
