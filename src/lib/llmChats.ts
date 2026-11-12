/**
 * AI 助手对话存储（IndexedDB kv 'llm:chats'，按 updatedAt 倒序，封顶 30 条）。
 * 内存快照 + 订阅（useSyncExternalStore），写操作经串行队列落 kv——
 * 与 llmProfiles 同一套模式。对话不含系统提示词（生成时按当前语言即时构建）。
 */

import { useSyncExternalStore } from 'react';
import { idbGetKV, idbPutKV } from '@/lib/storage/idb';
import type { MemoryWrite } from './memory';
import type { AssistantAction } from './assistantActions';
import type { ChoiceResult, ChoiceSetResult, PendingChoice, PendingChoiceSet } from './assistantChoice';
import type { ImgKind } from './assistantChartRoute';

/** 用户随消息附带的资料；当前版本先支持记录图表，图片字段预留给后续视觉模型 */
export interface ChatAttachment {
  id: string;
  kind: 'record' | 'image';
  recordId?: string;
  chart?: ImgKind;
  dataUrl?: string;
  mime?: string;
  name?: string;
}

/** 跨对话检索命中的参考对话 */
export interface ChatRef {
  chatId: string;
  title: string;
  createdAt: number;
  messageIndex: number;
  snippet: string;
}

/** 一次生成实际注入的上下文（供气泡下方的「本轮上下文」面板展示） */
export interface ChatContextMeta {
  /** 明细与固定记录里真正写进提示词的记录 id */
  recordIds: string[];
  /** /attach 固定且已注入的记录 id */
  pinnedIds: string[];
  /** 历史记录总条数（其余只参与聚合与趋势统计，不逐条注入） */
  totalRecords: number;
  /** 注入的内置文档摘录 */
  docs: { title: string; chars: number }[];
  /** 本轮联网搜索的来源 */
  webSources?: import('./webSearch').WebSearchSource[];
  /** 本轮注入的长期记忆条数 */
  memories?: number;
  /** 本轮实际注入的记忆 id（ContextPanel 逐条展示/编辑） */
  memoryIds?: string[];
  /** 本轮按需记忆检索使用的查询（未触发工具检索时省略） */
  memoryQuery?: string;
  /** 本轮助手实际执行的数据 / 计划 / 操作工具 */
  toolCalls?: { name: string; summary: string; ok: boolean; ms: number }[];
  /** 自动 / 手动保存的长期记忆（渲染「已记住」chip，可撤销） */
  memoryWrites?: MemoryWrite[];
  /** 等待用户确认的写操作 */
  pendingAction?: AssistantAction;
  /** 已执行的写操作摘要（对话里留一条「已修改」记录） */
  appliedAction?: { summary: string; at: number };
  /** 本轮涉及的练习计划（渲染 PlanCard） */
  planId?: string;
  /** 等待用户选择的阻塞式问题 */
  pendingChoice?: PendingChoice;
  /** 已解决的选择结果（卡片折叠成已选择状态） */
  choiceResult?: ChoiceResult;
  /** 等待用户一次提交的多问题卡 */
  pendingChoiceSet?: PendingChoiceSet;
  /** 多问题卡的提交结果 */
  choiceSetResult?: ChoiceSetResult;
  /** 关键数字校验结果：repaired = 已按工具结果修正，flagged = 仍有未验证数字 */
  numericCheck?: 'repaired' | 'flagged';
  /** 跨对话检索命中的参考对话 */
  chatRefs?: ChatRef[];
  /** 安全固定回复标记 */
  safety?: 'crisis';
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** 用户随消息附带的记录图表 / 图片（图片留给后续版本） */
  attachments?: ChatAttachment[];
  /** 用户对阻塞式选择器的回答（用于渲染紧凑的选择 chip） */
  choice?: ChoiceResult;
  /** 用户对多问题卡的回答摘要（渲染 chip 用） */
  choiceLabel?: string;
  /** 这条用户消息是选择卡自动追加的合成消息 */
  origin?: 'choice' | 'choice_set';
  /** 思考过程（推理模型 / thinking 块返回时保存，气泡可展开查看） */
  think?: string;
  /** 流式草稿：生成中节流写入，完成后清除；残留草稿（崩溃/杀进程）读取时转为 interrupted */
  draft?: boolean;
  /** 生成被用户中止（或异常中断），content 为已输出的部分内容 */
  interrupted?: boolean;
  /** 本轮注入的记录与文档（仅助手消息） */
  context?: ChatContextMeta;
}

/** 较早对话的滚动摘要（内部使用，不展示 UI） */
export interface ChatSummary {
  text: string;
  /** 摘要覆盖到的消息下标（含） */
  throughMessageIndex: number;
  updatedAt: number;
  source: 'local' | 'llm';
}

/** 对话隐私级别：normal / 只关写入 / 完全私密 */
export type ChatPrivacy = 'normal' | 'no-write' | 'private';

export interface ChatConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  /** 通过 /attach 固定的历史记录 id（跨轮保留，/detach 或新对话清除） */
  pinnedRecordIds?: string[];
  /** 临时会话：不自动写入长期记忆（手动「记住」仍可用） */
  memoryOff?: boolean;
  /** 私密对话：不读取记忆 / 记录 / 文档，也不调用数据工具 */
  privacy?: ChatPrivacy;
  /** 开启私密对话时的消息下标；只把此后的消息发给模型 */
  privateSince?: number;
  /** 较早对话摘要；只在上下文超预算时更新 */
  summary?: ChatSummary;
}

const KV_CHATS = 'llm:chats';
const MAX_CHATS = 30;

let chats: ChatConversation[] | null = null;
let loaded: Promise<void> | null = null;
/** kv 是否已成功读取（含确认无数据）；未成功前不落盘，避免覆盖旧历史 */
let kvReadOk = false;
const listeners = new Set<() => void>();
let queue: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>): Promise<void> {
  const next = queue.then(task);
  queue = next.catch(() => {});
  return next;
}

function notify(): void {
  for (const fn of listeners) fn();
}

function validConversation(c: unknown): c is ChatConversation {
  const o = c as ChatConversation;
  return !!o && typeof o === 'object'
    && typeof o.id === 'string' && typeof o.title === 'string'
    && typeof o.createdAt === 'number' && typeof o.updatedAt === 'number'
    && Array.isArray(o.messages)
    && o.messages.every((m) => !!m
      && typeof m.content === 'string'
      && (m.role === 'user' || m.role === 'assistant')
      && (m.think === undefined || typeof m.think === 'string')
      && (m.context === undefined || (typeof m.context === 'object' && m.context !== null)))
    && (o.pinnedRecordIds === undefined
      || (Array.isArray(o.pinnedRecordIds) && o.pinnedRecordIds.every((id) => typeof id === 'string')));
}

async function ensureLoaded(): Promise<void> {
  loaded ??= (async () => {
    let raw: ChatConversation[] = [];
    try {
      const stored = await idbGetKV<ChatConversation[]>(KV_CHATS);
      raw = Array.isArray(stored) ? stored.filter(validConversation) : [];
      // 上次运行留下的流式草稿 = 生成过程中被中断：保留内容并标注「已中断」
      for (const c of raw) {
        if (!c.messages.some((m) => m.draft)) continue;
        c.messages = c.messages.map((m) => (m.draft
          ? { ...m, draft: undefined, interrupted: true }
          : m));
      }
    } catch {
      // IndexedDB 瞬态不可用（打开阻塞等）：不把「失败」当成「无数据」缓存，
      // 置空 loaded 让下一次订阅/写入重试；本会话先以内存态运行
      loaded = null;
      return;
    }
    kvReadOk = true;
    // 加载期间若有写入（createChat 等会先建立空内存列表），按 id 合并而非覆盖，
    // 且内存中的新写入优先
    const byId = new Map<string, ChatConversation>();
    for (const c of raw) byId.set(c.id, c);
    for (const c of chats ?? []) byId.set(c.id, c);
    chats = sortAndCap([...byId.values()]);
  })();
  await loaded;
}

/** useSyncExternalStore 订阅入口：首次订阅时触发加载 */
export function subscribeChats(fn: () => void): () => void {
  listeners.add(fn);
  void enqueue(async () => {
    await ensureLoaded();
  }).then(notify);
  return () => listeners.delete(fn);
}

/** 对话快照（updatedAt 倒序）；null = 尚未加载完成 */
export function getChatsSnapshot(): ChatConversation[] | null {
  return chats;
}

/** React 订阅：对话列表 */
export function useChats(): ChatConversation[] | null {
  return useSyncExternalStore(subscribeChats, getChatsSnapshot, getChatsSnapshot);
}

function genId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function persist(): Promise<void> {
  // 读取未成功（瞬态失败 / 尚未完成）前不落盘：此时内存列表不含 kv 里的旧历史，
  // 整键写回会把它们覆盖掉（历史对话永久丢失）；保持内存态，下次写入重试
  if (!kvReadOk) return;
  try {
    await idbPutKV(KV_CHATS, chats!);
  } catch {
    /* 落盘失败保持内存态，下次写操作重试 */
  }
}

function sortAndCap(list: ChatConversation[]): ChatConversation[] {
  return [...list]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CHATS);
}

function commit(next: ChatConversation[]): void {
  chats = sortAndCap(next);
  // 先补一次加载（读取失败后的重试入口），成功则本次写入立即落盘
  void enqueue(async () => {
    await ensureLoaded();
    if (kvReadOk) notify();
    await persist();
  });
  notify();
}

function truncate(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

/** 新建对话（可带初始消息，用于分支），返回 id */
export function createChat(
  title: string,
  messages: ChatMessage[] = [],
  opts: { memoryOff?: boolean; privacy?: ChatPrivacy; privateSince?: number } = {},
): string {
  const now = Date.now();
  const conv: ChatConversation = {
    id: genId(),
    title,
    createdAt: now,
    updatedAt: now,
    messages,
    ...(opts.memoryOff ? { memoryOff: true } : {}),
    ...(opts.privacy && opts.privacy !== 'normal' ? { privacy: opts.privacy } : {}),
    ...(opts.privacy === 'private'
      ? { privateSince: opts.privateSince ?? 0 }
      : {}),
  };
  // 加载未完成时也先建立内存列表：其余写操作都有 !chats 守卫会静默丢消息，
  // 这里放行后 ensureLoaded 按 id 合并，新对话不会被读到的旧数据覆盖
  chats ??= [];
  commit([conv, ...chats]);
  return conv.id;
}

export function getChat(id: string): ChatConversation | undefined {
  return chats?.find((c) => c.id === id);
}

/** 追加一条消息；首条用户消息自动成为对话标题 */
export function addMessage(id: string, msg: ChatMessage): void {
  if (!chats) return;
  commit(chats.map((c) => (c.id === id
    ? {
      ...c,
      title: c.title || (msg.role === 'user' ? truncate(msg.content, 24) : c.title),
      updatedAt: Date.now(),
      messages: [...c.messages, msg],
    }
    : c)));
}

/** 整体替换消息（重做的截断、分支的前缀裁剪） */
export function setMessages(id: string, messages: ChatMessage[]): void {
  if (!chats) return;
  commit(chats.map((c) => (c.id === id ? { ...c, updatedAt: Date.now(), messages } : c)));
}

/** 给某条助手消息补写上下文（自动记忆保存完成后写入 chip 数据） */
export function patchMessageContext(
  id: string,
  index: number,
  patch: Partial<ChatContextMeta>,
): void {
  if (!chats) return;
  commit(chats.map((c) => {
    if (c.id !== id) return c;
    const messages = c.messages.map((m, i) => {
      if (i !== index) return m;
      const context: ChatContextMeta = {
        recordIds: [],
        pinnedIds: [],
        totalRecords: 0,
        docs: [],
        ...(m.context ?? {}),
        ...patch,
      };
      const next: ChatMessage = { ...m, context };
      return next;
    });
    return { ...c, messages, updatedAt: Date.now() };
  }));
}

/** 切换「本次对话不写入记忆」 */
export function setChatMemoryOff(id: string, off: boolean): void {
  if (!chats) return;
  commit(chats.map((c) => (c.id === id
    ? { ...c, memoryOff: off || undefined, updatedAt: Date.now() }
    : c)));
}

/**
 * 写入助手回复：末尾已有草稿则原位替换，否则追加。
 * draft=true 为生成中的节流快照；结束时用 draft=false（可带 interrupted）定稿。
 */
export function saveAssistantDraft(
  id: string,
  patch: {
    content: string;
    think?: string;
    draft: boolean;
    interrupted?: boolean;
    context?: ChatContextMeta;
  },
): void {
  if (!chats) return;
  const conv = chats.find((c) => c.id === id);
  if (!conv) return;
  const last = conv.messages[conv.messages.length - 1];
  const msg: ChatMessage = {
    role: 'assistant',
    content: patch.content,
    ...(patch.think ? { think: patch.think } : {}),
    ...(patch.draft ? { draft: true } : {}),
    ...(patch.interrupted ? { interrupted: true } : {}),
    ...(patch.context ? { context: patch.context } : {}),
  };
  const messages = last?.role === 'assistant' && last.draft
    ? [...conv.messages.slice(0, -1), msg]
    : [...conv.messages, msg];
  commit(chats.map((c) => (c.id === id ? { ...c, updatedAt: Date.now(), messages } : c)));
}

/** 重命名对话（空白标题忽略） */
export function renameChat(id: string, title: string): void {
  if (!chats) return;
  const next = title.trim().slice(0, 60);
  if (!next) return;
  commit(chats.map((c) => (c.id === id ? { ...c, title: next } : c)));
}

/** 替换当前会话固定的历史记录 id（/attach /detach） */
export function setPinnedRecords(id: string, ids: string[]): void {
  if (!chats) return;
  const unique = [...new Set(ids)];
  commit(chats.map((c) => (c.id === id
    ? { ...c, updatedAt: Date.now(), pinnedRecordIds: unique.length ? unique : undefined }
    : c)));
}

/** 写入较早对话摘要（不改变会话排序） */
export function setChatSummary(id: string, summary: ChatSummary): void {
  if (!chats) return;
  commit(chats.map((c) => (c.id === id ? { ...c, summary } : c)));
}

/** 设置对话隐私级别；private 同时关闭自动写入记忆 */
export function setChatPrivacy(id: string, privacy: ChatPrivacy): void {
  if (!chats) return;
  commit(chats.map((c) => (c.id === id
    ? {
      ...c,
      privacy: privacy === 'normal' ? undefined : privacy,
      ...(privacy === 'private'
        ? { memoryOff: true, privateSince: c.messages.length }
        : { privateSince: undefined }),
    }
    : c)));
}

export function deleteChat(id: string): void {
  if (!chats) return;
  commit(chats.filter((c) => c.id !== id));
}
