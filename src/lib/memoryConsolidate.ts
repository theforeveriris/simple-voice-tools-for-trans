/**
 * 记忆巩固：把相似记忆合并成更稳定的表述，旧条目标记为 superseded，保留历史。
 * 只做「相似 + 同作用域」的分组；不物理删除，用户可以恢复。
 */
import { llmChat, type LlmConfig } from './llm';
import {
  loadMemories,
  looksLikeInstruction,
  memorySimilarity,
  saveMemory,
  supersedeMemories,
  type MemoryItem,
} from './memory';

const SIMILARITY_THRESHOLD = 0.65;
const MAX_GROUPS_PER_RUN = 3;

const CONSOLIDATE_SYSTEM = [
  '你是记忆整理器。把下面同一组记忆合并成 1–2 条简洁、自包含的中文陈述。',
  '保留事实、偏好、要求和注意事项；合并重复；如果新旧说法冲突，以较新的说法为准。',
  '每条一行，不要编号、不要解释，每条不超过 80 字。',
].join('\n');

/** 只在同作用域内合并，避免把某个对话的私密偏好合并成全局记忆 */
function scopeKey(memory: MemoryItem): string {
  const scope = memory.scope ?? 'global';
  if (scope === 'chat') return `chat:${memory.chatId ?? ''}`;
  if (scope === 'plan') return `plan:${memory.planId ?? ''}`;
  return 'global';
}

/** 找出可以合并的相似记忆组（每组至少 2 条，且有非置顶项） */
export function findConsolidationGroups(list: MemoryItem[]): MemoryItem[][] {
  const active = list.filter((m) => (m.status ?? 'active') === 'active');
  const groups: MemoryItem[][] = [];
  for (const item of active) {
    const key = scopeKey(item);
    let best: { group: MemoryItem[]; score: number } | null = null;
    for (const group of groups) {
      if (group.length === 0 || scopeKey(group[0]) !== key) continue;
      const score = Math.max(...group.map((other) => memorySimilarity(item.text, other.text)));
      if (score >= SIMILARITY_THRESHOLD && (!best || score > best.score)) {
        best = { group, score };
      }
    }
    if (best) best.group.push(item);
    else groups.push([item]);
  }
  return groups.filter((group) => group.length >= 2 && group.some((m) => !m.pinned));
}

/** 解析模型输出的合并条目 */
export function parseConsolidatedLines(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.、)])\s*/, '').trim();
    if (line.length < 2 || line.length > 200) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
    if (out.length >= 2) break;
  }
  return out;
}

/**
 * 合并最多 MAX_GROUPS_PER_RUN 组相似记忆。
 * 模型失败时跳过该组，不破坏原列表。
 */
export async function consolidateMemories(
  cfg: LlmConfig,
  options: { signal?: AbortSignal } = {},
): Promise<{ groups: number; merged: number }> {
  const list = await loadMemories();
  const groups = findConsolidationGroups(list).slice(0, MAX_GROUPS_PER_RUN);
  let merged = 0;
  for (const group of groups) {
    const input = group.map((m, i) => `${i + 1}. ${m.text}`).join('\n');
    let text = '';
    try {
      text = await llmChat(
        cfg,
        CONSOLIDATE_SYSTEM,
        `【待合并记忆】\n${input}`,
        0.1,
        options.signal,
        'assistant',
      );
    } catch {
      continue;
    }
    const lines = parseConsolidatedLines(text);
    if (lines.length === 0) continue;
    const first = group[0];
    let firstNewId: string | null = null;
    for (const line of lines) {
      if (looksLikeInstruction(line)) continue;
      const result = await saveMemory({
        text: line,
        kind: first.kind,
        pinned: group.some((m) => m.pinned),
        ...(first.scope ? { scope: first.scope } : {}),
        ...(first.chatId ? { chatId: first.chatId } : {}),
        ...(first.planId ? { planId: first.planId } : {}),
      });
      if (result) {
        firstNewId ??= result.item.id;
        if (result.action !== 'duplicate') merged++;
      }
    }
    if (firstNewId) await supersedeMemories(group.map((m) => m.id), firstNewId);
  }
  return { groups: groups.length, merged };
}
