/**
 * 较早对话的滚动摘要
 *
 * 只在历史超预算时使用：先本地摘录兜底，再后台调用小模型生成正式摘要。
 * 摘要不展示 UI，只作为系统上下文，避免长对话早期目标 / 禁忌被无声裁掉。
 */
import type { ChatMessage } from './llmChats';
import { llmChat, type LlmConfig } from './llm';

/** 摘要正文上限（字符） */
export const SUMMARY_MAX_CHARS = 1600;

export const SUMMARY_SYSTEM = [
  '你是对话摘要器。把较早的对话压缩成给助手自己看的滚动摘要。',
  '只保留：已确认目标、偏好/禁忌、当前计划、已做决定、未解决问题。',
  '不要写建议、寒暄或重复内容；不要编造用户没有说过的信息。',
  '用简洁中文，最多 400 字。只输出摘要正文，不要标题和解释。',
].join('\n');

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 本地提取式摘要：模型失败或首轮超预算时同步兜底 */
export function buildLocalSummary(messages: ChatMessage[], previousText = ''): string {
  const user = messages
    .filter((message) => message.role === 'user')
    .map((message) => clean(message.content).slice(0, 120))
    .filter(Boolean);
  const assistant = messages
    .filter((message) => message.role === 'assistant')
    .map((message) => clean(message.content).slice(0, 100))
    .filter(Boolean)
    .slice(-2);
  const parts: string[] = [];
  if (previousText.trim()) parts.push(previousText.trim());
  parts.push('【较早对话（本地摘录）】');
  if (user.length > 0) parts.push(`用户：${user.join(' / ')}`);
  if (assistant.length > 0) parts.push(`助手：${assistant.join(' / ')}`);
  return parts.join('\n').slice(-SUMMARY_MAX_CHARS);
}

/** 给摘要模型的输入：只带较早消息，控制长度 */
export function buildSummaryInput(messages: ChatMessage[], previousText = ''): string {
  const lines = messages.map((message) => {
    const label = message.role === 'user' ? '用户' : '助手';
    return `${label}：${clean(message.content).slice(0, 600)}`;
  });
  return [
    previousText.trim() ? `【已有摘要】\n${previousText.trim()}` : '',
    '【新增较早对话】',
    ...lines,
  ].filter(Boolean).join('\n').slice(0, 8000);
}

/** 调用辅助模型生成正式摘要；失败返回空串，由调用方保留本地摘要 */
export async function summarizeChat(
  cfg: LlmConfig,
  messages: ChatMessage[],
  previousText = '',
  signal?: AbortSignal,
): Promise<string> {
  if (messages.length === 0) return '';
  const text = await llmChat(
    cfg,
    SUMMARY_SYSTEM,
    buildSummaryInput(messages, previousText),
    0.1,
    signal,
    'assistant',
  );
  return text.trim().slice(0, SUMMARY_MAX_CHARS);
}

/** 注入系统提示词的摘要块 */
export function summaryPromptBlock(text: string): string {
  const summary = text.trim();
  if (!summary) return '';
  return [
    '【较早对话摘要】',
    summary,
    '以上是较早对话的压缩记录；如果与最近消息冲突，以最近消息为准。',
  ].join('\n');
}
