/**
 * 跨对话情节检索（本地全文，无 embedding）
 *
 * 长期记忆回答「我是谁、喜欢什么」；这里回答「我们上次聊过什么」。
 * 只搜文本片段，排除当前对话；私密对话由调用方过滤。
 */
import type { ChatConversation } from './llmChats';

export interface ChatSearchSnippet {
  messageIndex: number;
  role: 'user' | 'assistant';
  text: string;
}

export interface ChatSearchHit {
  chatId: string;
  title: string;
  createdAt: number;
  score: number;
  snippets: ChatSearchSnippet[];
}

export interface ChatSearchOptions {
  /** 当前对话 id，不重复检索 */
  excludeId?: string;
  limit?: number;
}

const SNIPPET_RADIUS = 60;

function termsOf(query: string): string[] {
  const lower = query.toLowerCase().trim();
  if (!lower) return [];
  const out = new Set<string>([lower]);
  for (const term of lower.split(/[\s,，。！？；;:：/\\|]+/)) {
    if (term.length >= 2) out.add(term);
  }
  // 中文长句补二元组，避免「上次说的那个练习」整句匹配不到
  for (const run of lower.match(/[\u3400-\u9fff]+/g) ?? []) {
    if (run.length <= 2) continue;
    for (let i = 0; i < run.length - 1; i++) out.add(run.slice(i, i + 2));
  }
  return [...out];
}

function scoreText(text: string, query: string, terms: string[]): number {
  const lower = text.toLowerCase();
  if (!lower) return 0;
  if (lower.includes(query)) return 5;
  let hits = 0;
  for (const term of terms) if (lower.includes(term)) hits++;
  return Math.min(4, hits);
}

function snippetAround(text: string, query: string, terms: string[]): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const lower = clean.toLowerCase();
  let index = lower.indexOf(query);
  if (index < 0) {
    for (const term of terms) {
      index = lower.indexOf(term);
      if (index >= 0) break;
    }
  }
  if (index < 0) return clean.slice(0, SNIPPET_RADIUS * 2);
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(clean.length, index + query.length + SNIPPET_RADIUS);
  return `${start > 0 ? '…' : ''}${clean.slice(start, end)}${end < clean.length ? '…' : ''}`;
}

/** 在本地对话里按标题 / 消息文本检索，返回带片段的命中列表 */
export function searchChats(
  chats: ChatConversation[],
  query: string,
  options: ChatSearchOptions = {},
): ChatSearchHit[] {
  const normalized = query.trim();
  if (!normalized) return [];
  const terms = termsOf(normalized);
  const lowerQuery = normalized.toLowerCase();
  const limit = Math.max(1, Math.min(8, options.limit ?? 5));
  const now = Date.now();
  const out: ChatSearchHit[] = [];

  for (const chat of chats) {
    if (chat.id === options.excludeId) continue;
    if ((chat as { privacy?: string }).privacy === 'private') continue;
    const ageDays = Math.max(0, (now - chat.createdAt) / 86_400_000);
    const recency = Math.max(0, 1 - ageDays / 365);
    let score = 0;
    const titleScore = scoreText(chat.title, lowerQuery, terms);
    if (titleScore > 0) score += titleScore * 1.6;
    const snippets: ChatSearchSnippet[] = [];
    for (let i = 0; i < chat.messages.length; i++) {
      const message = chat.messages[i];
      const textScore = scoreText(message.content, lowerQuery, terms);
      if (textScore <= 0) continue;
      score += textScore * (message.role === 'user' ? 1.5 : 1);
      if (snippets.length < 3) {
        snippets.push({
          messageIndex: i,
          role: message.role,
          text: snippetAround(message.content, lowerQuery, terms),
        });
      }
    }
    if (score <= 0) continue;
    score += recency;
    out.push({
      chatId: chat.id,
      title: chat.title,
      createdAt: chat.createdAt,
      score,
      snippets,
    });
  }

  return out.sort((a, b) => b.score - a.score || b.createdAt - a.createdAt).slice(0, limit);
}
