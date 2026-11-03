/**
 * 大模型接口配置档案（多套 baseUrl / API Key / 模型，v0.9.0 方案 A：档案即数据源）。
 *
 * 档案整体存 IndexedDB kv（llm:profiles）——API Key 属敏感凭据，不进
 * localStorage / 设置导出。活动配置 = 设置里的 llmActiveProfileId 指针（随设置
 * 持久化），消费方经 activeLlmConfigFrom() / useActiveLlmConfig() 解析；
 * 旧的三字段（llmBaseUrl / llmApiKey / llmModelId）仅在启动迁移时读取一次
 * （见 useStore 尾部），此后不再消费。
 * 内存快照 + 订阅（useSyncExternalStore），写操作经串行队列落 kv。
 */

import { useSyncExternalStore } from 'react';
import { idbGetKV, idbPutKV } from '@/lib/storage/idb';
import type { LlmConfig, LlmProtocol } from '@/lib/llm';
import { t } from '@/i18n';

export interface LlmProfile {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  /** API 协议：openai（默认）/ anthropic */
  protocol: LlmProtocol;
  /** 流式输出（默认 true；端点不支持 SSE 时关闭） */
  stream: boolean;
  /** 上下文窗口 tokens（AI 助手注入历史与裁剪对话的依据） */
  contextTokens: number;
}

/** 上下文长度默认值：未配置 / 非法值时的兜底 */
export const DEFAULT_CONTEXT_TOKENS = 8192;

/** 上下文长度上限：给 1M+ 模型留空间（Gemini 1.5 2M、GPT-4.1 1.047M 等） */
export const MAX_CONTEXT_TOKENS = 10_000_000;

const KV_PROFILES = 'llm:profiles';

let profiles: LlmProfile[] | null = null;
let loaded: Promise<void> | null = null;
/** kv 是否已成功读取（含确认无数据）；未成功前禁止落盘，避免整键覆盖把旧档案（含 API Key）冲掉 */
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

function validProfile(p: unknown): p is LlmProfile {
  const o = p as LlmProfile;
  return !!o && typeof o === 'object'
    && typeof o.id === 'string' && typeof o.name === 'string'
    && typeof o.baseUrl === 'string' && typeof o.apiKey === 'string'
    && typeof o.modelId === 'string';
}

/** 补齐/矫正 v0.9.1 新增字段（旧档案无 protocol/stream/contextTokens） */
function normalizeProfile(
  p: Omit<LlmProfile, 'protocol' | 'stream' | 'contextTokens'> &
    Partial<Pick<LlmProfile, 'protocol' | 'stream' | 'contextTokens'>>,
): LlmProfile {
  return {
    ...p,
    protocol: p.protocol === 'anthropic' ? 'anthropic' : 'openai',
    stream: p.stream !== false,
    contextTokens: typeof p.contextTokens === 'number' && p.contextTokens >= 1024
      ? Math.min(p.contextTokens, MAX_CONTEXT_TOKENS)
      : DEFAULT_CONTEXT_TOKENS,
  };
}

async function ensureLoaded(): Promise<void> {
  if (profiles != null && kvReadOk) return;
  loaded ??= (async () => {
    let raw: LlmProfile[] = [];
    try {
      const stored = await idbGetKV<LlmProfile[]>(KV_PROFILES);
      raw = Array.isArray(stored) ? stored.filter(validProfile).map(normalizeProfile) : [];
    } catch {
      // IndexedDB 瞬态不可用（打开阻塞等）：不把「失败」当「无数据」缓存，
      // 置空 loaded 让下一次订阅/写入重试；本会话先以内存态运行
      loaded = null;
      return;
    }
    kvReadOk = true;
    // 加载期间可能有写入（新建档案会先建内存项）：按 id 合并而非覆盖，内存态优先
    const byId = new Map<string, LlmProfile>();
    for (const p of raw) byId.set(p.id, p);
    for (const p of profiles ?? []) byId.set(p.id, p);
    profiles = [...byId.values()];
  })();
  await loaded;
}

/** 等待档案加载完成并返回快照（启动迁移等一次性读取用） */
export async function profilesReady(): Promise<LlmProfile[]> {
  await ensureLoaded();
  return profiles!;
}

/** useSyncExternalStore 订阅入口：首次订阅时触发加载；快照引用稳定不触发重渲染 */
export function subscribeProfiles(fn: () => void): () => void {
  listeners.add(fn);
  void enqueue(async () => {
    await ensureLoaded();
  }).then(notify);
  return () => listeners.delete(fn);
}

/** 档案快照；null = 尚未加载完成 */
export function getProfilesSnapshot(): LlmProfile[] | null {
  return profiles;
}

function genId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function persist(): Promise<void> {
  // 读取未成功（瞬态失败 / 尚未完成）前不落盘：此时内存列表不含 kv 里的旧档案，
  // 整键写回会把它们（含 API Key）永久覆盖掉；保持内存态，下次写入重试
  if (!kvReadOk) return;
  try {
    await idbPutKV(KV_PROFILES, profiles!);
  } catch {
    /* 落盘失败保持内存态，下次写操作重试 */
  }
}

function commit(next: LlmProfile[]): void {
  profiles = next;
  void enqueue(persist);
  notify();
}

/** 新建档案并返回 id（调用方负责把 llmActiveProfileId 指向它） */
export function addProfile(
  name: string,
  cfg: {
    baseUrl: string;
    apiKey: string;
    modelId: string;
    protocol?: LlmProtocol;
    stream?: boolean;
    contextTokens?: number;
  },
): string {
  const p = normalizeProfile({ id: genId(), name, ...cfg });
  commit([...(profiles ?? []), p]);
  return p.id;
}

/** 修改档案字段（id 不可变） */
export function updateProfile(id: string, patch: Partial<Omit<LlmProfile, 'id'>>): void {
  if (!profiles) return;
  commit(profiles.map((p) => (p.id === id ? { ...p, ...patch, id } : p)));
}

/** 复制档案（名称追加「副本」后缀），返回新 id */
export function duplicateProfile(id: string): string | null {
  const src = profiles?.find((p) => p.id === id);
  if (!src) return null;
  const copy: LlmProfile = {
    ...src,
    id: genId(),
    name: `${src.name} · ${t('settings.llmProfileCopySuffix')}`,
  };
  commit([...profiles!, copy]);
  return copy.id;
}

/** 删除档案；返回是否存在（活动指针的清理由调用方负责） */
export function deleteProfile(id: string): boolean {
  if (!profiles?.some((p) => p.id === id)) return false;
  commit(profiles.filter((p) => p.id !== id));
  return true;
}

/** 按指针解析活动配置；指针缺失 / 档案不存在 / 字段不全 → null */
export function activeLlmConfigFrom(
  list: LlmProfile[],
  activeId: string | undefined,
): LlmConfig | null {
  const p = activeId ? list.find((x) => x.id === activeId) : undefined;
  if (!p) return null;
  const baseUrl = p.baseUrl.trim().replace(/\/+$/, '');
  const apiKey = p.apiKey.trim();
  const modelId = p.modelId.trim();
  if (!baseUrl || !apiKey || !modelId) return null;
  return {
    baseUrl,
    apiKey,
    modelId,
    protocol: p.protocol,
    stream: p.stream,
    contextTokens: p.contextTokens,
  };
}

/** React 订阅：档案列表（null = 尚未加载完成） */
export function useLlmProfiles(): LlmProfile[] | null {
  return useSyncExternalStore(subscribeProfiles, getProfilesSnapshot, getProfilesSnapshot);
}

/** React 订阅：活动配置（随档案与指针变化实时更新） */
export function useActiveLlmConfig(activeId: string | undefined): LlmConfig | null {
  const list = useLlmProfiles();
  return list ? activeLlmConfigFrom(list, activeId) : null;
}
