/**
 * 长期记忆服务（AI 助手的「关于用户」）
 *
 * - 内容：用户陈述的事实、偏好、明确要求与注意事项
 * - 存储：本机 IndexedDB kv `memory:items`，不进 AppSettings、不参与设置导出
 * - 注入：每轮助手生成前，置顶项 + 与当前问题相关的条目拼成系统提示词的一段
 * - 提取：从最近用户消息里按线索词离线抽取候选（不额外调用模型）
 */

import { useSyncExternalStore } from 'react';
import { idbGetKV, idbPutKV } from '@/lib/storage/idb';

export type MemoryKind = 'fact' | 'preference' | 'requirement' | 'caution';

export const MEMORY_KINDS: readonly MemoryKind[] = ['fact', 'preference', 'requirement', 'caution'];

export interface MemoryItem {
  id: string;
  text: string;
  kind: MemoryKind;
  /** 置顶：每轮都注入，不参与相关度筛选 */
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 单条记忆正文上限（字符） */
export const MEMORY_TEXT_MAX = 300;
/** 记忆条数上限 */
export const MEMORY_MAX = 200;

const KV_KEY = 'memory:items';

let items: MemoryItem[] | null = null;
let loadPromise: Promise<void> | null = null;
/** kv 读取成功前不落盘，避免用空快照覆盖已有记忆 */
let kvReadOk = false;
const listeners = new Set<() => void>();
let queue: Promise<void> = Promise.resolve();
const EMPTY: MemoryItem[] = [];

function enqueue(task: () => Promise<void>): Promise<void> {
  const next = queue.then(task);
  queue = next.catch(() => {});
  return next;
}

function notify(): void {
  for (const l of listeners) l();
}

function genId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sanitize(raw: unknown): MemoryItem[] {
  if (!Array.isArray(raw)) return [];
  const now = Date.now();
  const out: MemoryItem[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const text = typeof o.text === 'string' ? o.text.trim().slice(0, MEMORY_TEXT_MAX) : '';
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push({
      id: typeof o.id === 'string' && o.id ? o.id : genId(),
      text,
      kind: MEMORY_KINDS.includes(o.kind as MemoryKind) ? (o.kind as MemoryKind) : 'fact',
      pinned: o.pinned === true,
      createdAt: typeof o.createdAt === 'number' ? o.createdAt : now,
      updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : now,
    });
    if (out.length >= MEMORY_MAX) break;
  }
  return out;
}

/** 同步快照（尚未加载时为空数组） */
export function getMemories(): MemoryItem[] {
  return items ?? EMPTY;
}

/** 读取本机记忆：首次调用后走内存快照 */
export async function loadMemories(): Promise<MemoryItem[]> {
  if (items) return items;
  loadPromise ??= (async () => {
    try {
      const raw = await idbGetKV<unknown>(KV_KEY);
      items = sanitize(raw);
      kvReadOk = true;
    } catch {
      items = [];
    } finally {
      notify();
    }
  })();
  await loadPromise;
  return items ?? EMPTY;
}

export function subscribeMemories(fn: () => void): () => void {
  listeners.add(fn);
  void loadMemories();
  return () => listeners.delete(fn);
}

/** React 订阅：记忆列表 */
export function useMemories(): MemoryItem[] {
  return useSyncExternalStore(subscribeMemories, getMemories, getMemories);
}

function persist(): Promise<void> {
  if (!kvReadOk) return Promise.resolve();
  const snapshot = items ?? [];
  return enqueue(async () => {
    try {
      await idbPutKV(KV_KEY, snapshot);
    } catch {
      /* 存储失败保持内存态，下次写入重试 */
    }
  });
}

/** 新增一条记忆；重复正文或空文本返回 null */
export async function addMemory(input: {
  text: string;
  kind?: MemoryKind;
  pinned?: boolean;
}): Promise<MemoryItem | null> {
  await loadMemories();
  const text = input.text.trim().slice(0, MEMORY_TEXT_MAX);
  if (!text) return null;
  const list = items ?? [];
  if (list.some((m) => m.text === text)) return null;
  const now = Date.now();
  const item: MemoryItem = {
    id: genId(),
    text,
    kind: input.kind ?? 'fact',
    pinned: input.pinned === true,
    createdAt: now,
    updatedAt: now,
  };
  items = [item, ...list].slice(0, MEMORY_MAX);
  notify();
  await persist();
  return item;
}

/** 批量新增（从对话提取用）；返回真正新增的条数 */
export async function addMemories(list: { text: string; kind: MemoryKind }[]): Promise<number> {
  await loadMemories();
  const existing = new Set((items ?? []).map((m) => m.text));
  const now = Date.now();
  const fresh: MemoryItem[] = [];
  for (const c of list) {
    const text = c.text.trim().slice(0, MEMORY_TEXT_MAX);
    if (!text || existing.has(text)) continue;
    existing.add(text);
    fresh.push({
      id: genId(),
      text,
      kind: c.kind,
      pinned: false,
      createdAt: now,
      updatedAt: now,
    });
  }
  if (fresh.length === 0) return 0;
  items = [...fresh, ...(items ?? [])].slice(0, MEMORY_MAX);
  notify();
  await persist();
  return fresh.length;
}

export async function updateMemory(
  id: string,
  patch: Partial<Pick<MemoryItem, 'text' | 'kind' | 'pinned'>>,
): Promise<void> {
  await loadMemories();
  const list = items ?? [];
  const idx = list.findIndex((m) => m.id === id);
  if (idx < 0) return;
  const cur = list[idx];
  const text = patch.text == null ? cur.text : patch.text.trim().slice(0, MEMORY_TEXT_MAX);
  if (!text) return;
  const next: MemoryItem = {
    ...cur,
    text,
    kind: patch.kind ?? cur.kind,
    pinned: patch.pinned ?? cur.pinned,
    updatedAt: Date.now(),
  };
  items = [...list.slice(0, idx), next, ...list.slice(idx + 1)];
  notify();
  await persist();
}

export async function deleteMemory(id: string): Promise<void> {
  await loadMemories();
  const list = items ?? [];
  if (!list.some((m) => m.id === id)) return;
  items = list.filter((m) => m.id !== id);
  notify();
  await persist();
}

export async function clearMemories(): Promise<void> {
  await loadMemories();
  items = [];
  notify();
  await persist();
}

/* --------------------------- 相关度选择与注入 --------------------------- */

const KIND_LABEL: Record<MemoryKind, string> = {
  fact: '事实',
  preference: '偏好',
  requirement: '要求',
  caution: '注意',
};

/** 查询分词：拉丁词按词、中文按二元组（足以匹配短查询） */
function tokenize(text: string): string[] {
  const out = new Set<string>();
  const lower = text.toLowerCase();
  for (const m of lower.matchAll(/[a-z0-9_]{2,}/g)) out.add(m[0]);
  for (const run of text.match(/[\u3400-\u9fff]+/g) ?? []) {
    if (run.length === 1) out.add(run);
    else for (let i = 0; i < run.length - 1; i++) out.add(run.slice(i, i + 2));
  }
  return [...out];
}

/** 选出本轮要注入的记忆：置顶项优先，随后按与查询的命中数降序，受字符预算约束 */
export function selectMemories(list: MemoryItem[], query: string, maxChars = 1200): MemoryItem[] {
  const tokens = tokenize(query);
  const scored = list.map((m) => {
    const text = m.text.toLowerCase();
    let score = 0;
    for (const tok of tokens) if (text.includes(tok)) score++;
    return { m, score };
  });
  const pinned = scored.filter((x) => x.m.pinned).map((x) => x.m);
  const relevant = scored
    .filter((x) => !x.m.pinned && x.score > 0)
    .sort((a, b) => b.score - a.score || b.m.updatedAt - a.m.updatedAt)
    .map((x) => x.m);

  const picked: MemoryItem[] = [];
  let used = 0;
  for (const m of [...pinned, ...relevant]) {
    const cost = m.text.length + 12;
    if (used + cost > maxChars) continue;
    picked.push(m);
    used += cost;
  }
  return picked;
}

/** 把选中的记忆拼成系统提示词片段（无内容返回空串） */
export function memoryPromptBlock(picked: MemoryItem[]): string {
  if (picked.length === 0) return '';
  return [
    '【关于用户的长期记忆】',
    '以下是用户在过去对话中明确陈述、或要求记住的内容。回答时遵守；不要逐条复述，也不要声称这些是系统设定。',
    ...picked.map((m) => `- [${KIND_LABEL[m.kind]}] ${m.text}`),
  ].join('\n');
}

/** 生成注入块：读取记忆 → 按当前问题筛选 */
export async function buildMemoryPrompt(query: string): Promise<{ text: string; count: number }> {
  const list = await loadMemories();
  const picked = selectMemories(list, query);
  return { text: memoryPromptBlock(picked), count: picked.length };
}

/* ------------------------------- 对话提取 ------------------------------- */

/** 只保留明确带有「记住 / 以后 / 不要 / 我的…」等线索的用户陈述 */
const CUE_RE = /记住|记得|以后|今后|每次|始终|一直|不要|别再|请勿|务必|必须|我的[^，。！？\n]{0,12}(?:是|为)|我(?:是|在|喜欢|不喜欢|讨厌|要求|习惯)|remember|always|never|don['’]?t|do not|my name is|i (?:prefer|want|need|hate|like)/i;
/** 纯指令（「记住这个」）与疑问句不收：它们本身不携带可保存的事实 */
const NOISE_RE = /^(?:(?:请?记住|记得|别忘了)(?:这个|那个|一下|它|此|这些|那些)?|remember(?: this| that)?)[。.!！?？\s]*$/i;

function inferKind(text: string): MemoryKind {
  if (/不要|别|请勿|禁止|never|don['’]?t|do not/i.test(text)) return 'caution';
  if (/要求|必须|务必|始终|一直|每次|以后|今后|记住|always|must|remember/i.test(text)) return 'requirement';
  if (/喜欢|偏好|讨厌|习惯|prefer|like|hate/i.test(text)) return 'preference';
  return 'fact';
}

/**
 * 从用户消息里抽取可长期保存的陈述。
 * 只做线索词匹配与就近分句，结果仍需用户在记忆页确认/编辑。
 */
export function extractMemoryCandidates(texts: string[], limit = 20): { text: string; kind: MemoryKind }[] {
  const out: { text: string; kind: MemoryKind }[] = [];
  const seen = new Set<string>();
  for (const raw of texts) {
    // 保留分隔符：句末是问号时整句不收（问句不携带可保存的事实）
    const parts = raw.split(/([。！？!?；;\n]+)/);
    for (let i = 0; i < parts.length; i += 2) {
      const sep = parts[i + 1] ?? '';
      if (/[?？]/.test(sep)) continue;
      const text = (parts[i] ?? '').trim().replace(/^[-*#>\d.\s]+/, '').slice(0, MEMORY_TEXT_MAX);
      if (text.length < 4 || text.length > 200) continue;
      if (NOISE_RE.test(text)) continue;
      if (!CUE_RE.test(text)) continue;
      const key = text.replace(/\s+/g, '');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ text, kind: inferKind(text) });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
