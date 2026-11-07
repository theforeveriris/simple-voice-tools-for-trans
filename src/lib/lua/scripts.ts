/**
 * Lua 脚本仓库（实验性「脚本中心」的数据层）
 * 脚本存 IndexedDB kv（不入设置 JSON，体积可控），每条带启用态与内置/用户标记；
 * 内置脚本以 .lua 文件维护于 lua-scripts/（builtins.ts ?raw 导入），不可删除、可恢复；
 * 用户脚本可导入 .lua 单文件 / JSON 打包，可导出/分享。
 *
 * 生效规则（同一方向多个脚本怎么办）：
 *   - advice（建议）：可同时启用多个，运行时逐脚本执行后合并（每脚本至多 3 条、总计至多 3 条）；
 *   - card / flower / export（分享卡 / 声之花 / 导出桥）：单一消费方，同一方向同一时间只允许
 *     一个脚本生效——setScriptEnabled 启用新脚本时自动停用该方向的其他脚本，避免「启用了却没跑」。
 */

import { idbGetKV, idbPutKV } from '@/lib/storage/idb';
import { BUILTIN_SCRIPTS, type BuiltinScriptMeta } from './builtins';

/** 脚本消费方：advice 建议规则 / card 分享卡模板 / flower 花朵生成 / export 自定义格式导出桥 */
export type ScriptKind = 'advice' | 'card' | 'flower' | 'export';

/** 全部脚本种类（导入校验与 UI 共用） */
export const SCRIPT_KINDS: readonly ScriptKind[] = ['advice', 'card', 'flower', 'export'];

/**
 * 单一消费方种类：同一方向同一时间只允许一个脚本生效。
 * advice 为多脚本合并方向，不在此列。
 */
const SINGLE_KINDS: readonly ScriptKind[] = ['card', 'flower', 'export'];
/** 该方向是否单一生效（同一时间只允许一个脚本） */
export function isSingleKind(kind: ScriptKind): boolean {
  return SINGLE_KINDS.includes(kind);
}

/** 一条用户脚本（内置脚本以 builtin id 引用，不存这里） */
export interface LuaUserScript {
  id: string;
  name: string;
  kind: ScriptKind;
  code: string;
  createdAt: number;
  updatedAt: number;
}

/** 统一脚本视图（内置 + 用户），供 UI 列表与执行层 */
export interface LuaScriptView {
  id: string;
  name: string;
  kind: ScriptKind;
  code: string;
  builtin: boolean;
  enabled: boolean;
  /** 内置脚本的一句话说明（用户脚本无） */
  description?: string;
}

const KV_KEY = 'luaScripts';
const ENABLED_KEY = 'luaScriptsEnabled';

/** node/vitest 环境的内存兜底（IndexedDB 不可用时脚本列表 = 仅内置） */
const memoryStore = new Map<string, unknown>();

/**
 * kv 读取：本会话已读/已写的键以内存副本为准（写入失败时脚本不会凭空消失），
 * 否则读 IndexedDB 并缓存。**读取失败不永久锁死**——瞬态失败（打开阻塞 / 隐私模式）
 * 下次调用会重试，不能因为一次失败就再也看不到此前保存的脚本。
 */
async function kvGet<T>(key: string): Promise<T | undefined> {
  const cached = memoryStore.get(key) as T | undefined;
  if (cached !== undefined) return cached;
  try {
    const value = await idbGetKV<T>(key);
    if (value !== undefined) memoryStore.set(key, value);
    return value;
  } catch {
    return undefined;
  }
}

/** kv 写入：先写内存副本（读立刻可见），再尝试落盘（失败下次写操作重试） */
async function kvPut(key: string, value: unknown): Promise<void> {
  memoryStore.set(key, value);
  try {
    await idbPutKV(key, value);
  } catch {
    /* 落盘失败保持内存态，下次写操作重试 */
  }
}

/* ------------------------- 脚本变更订阅 ------------------------- */

/** 脚本清单/启停/增删后递增：设置页与分析页据此刷新「可用性」探测 */
let scriptsVersion = 0;
const listeners = new Set<(version: number) => void>();

/** 订阅脚本中心变更（返回取消订阅函数） */
export function subscribeScripts(cb: (version: number) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** 当前脚本版本号（无变更 = 0） */
export function getScriptsVersion(): number {
  return scriptsVersion;
}

/** 脚本清单变更：递增版本号并通知订阅者（分析页 / 分享弹层据此刷新可用性） */
function bumpScripts(): void {
  scriptsVersion += 1;
  for (const cb of listeners) {
    try {
      cb(scriptsVersion);
    } catch {
      /* 订阅方异常不影响仓库自身 */
    }
  }
}

/* ------------------------- 用户脚本存取 ------------------------- */

/** 全部用户脚本（简单起见整存整取，脚本数量级是个位数） */
export async function getUserScripts(): Promise<LuaUserScript[]> {
  const list = await kvGet<LuaUserScript[]>(KV_KEY);
  return list ?? [];
}

/** 保存/更新一条用户脚本（同 id 覆盖，新建追加） */
export async function putUserScript(script: LuaUserScript): Promise<void> {
  const list = await getUserScripts();
  const now = Date.now();
  const next = list.filter((s) => s.id !== script.id);
  next.push({ ...script, createdAt: script.createdAt || now, updatedAt: now });
  await kvPut(KV_KEY, next);
  bumpScripts();
}

/** 删除一条用户脚本 */
export async function deleteUserScript(id: string): Promise<void> {
  const list = await getUserScripts();
  await kvPut(KV_KEY, list.filter((s) => s.id !== id));
  bumpScripts();
}

/* ------------------------- 启用态（内置 + 用户共用） ------------------------- */

/** 读启用态映射（脚本 id → 是否启用） */
async function getEnabledMap(): Promise<Record<string, boolean>> {
  return (await kvGet<Record<string, boolean>>(ENABLED_KEY)) ?? {};
}

/** 写启用态映射 */
async function setEnabledMap(map: Record<string, boolean>): Promise<void> {
  await kvPut(ENABLED_KEY, map);
}

/**
 * 单个脚本启停。
 * 启用单一消费方（card/flower/export）脚本时，自动停用同方向其他脚本并返回被停用名单，
 * 让 UI 明确告知「同一方向只生效一个」，而不是悄悄忽略。
 */
export async function setScriptEnabled(
  id: string,
  enabled: boolean,
): Promise<{ displaced: string[] }> {
  // 先跑一遍 listScripts 完成脏数据归一化，再读取归一化后的启用映射——
  // 否则用归一化前的旧 map 覆盖，会把刚写入的归一化结果冲掉
  const all = await listScripts();
  const map = await getEnabledMap();
  const displaced: string[] = [];
  if (enabled) {
    const target = all.find((s) => s.id === id);
    if (target && isSingleKind(target.kind)) {
      for (const s of all) {
        if (s.kind === target.kind && s.id !== id && s.enabled) {
          map[s.id] = false;
          displaced.push(s.name);
        }
      }
    }
  }
  map[id] = enabled;
  await setEnabledMap(map);
  bumpScripts();
  return { displaced };
}

/**
 * 全部脚本视图（内置 + 用户），合并启用态。
 * 内置默认启用 defaultEnabled 标记；用户脚本默认启用。
 * 附带迁移：单一方向（card/flower/export）若历史数据里启用了多个，
 * 保留第一个（内置优先）并停用其余——保证「同一方向只生效一个」不产生静默忽略。
 */
export async function listScripts(): Promise<LuaScriptView[]> {
  const [users, map] = await Promise.all([getUserScripts(), getEnabledMap()]);
  const built = buildScriptList(map, users);
  /** 内置脚本的默认启用标记（用户脚本默认启用） */
  const defaultEnabledOf = new Map(BUILTIN_SCRIPTS.map((b) => [b.id, b.defaultEnabled]));
  let changed = false;
  for (const kind of SINGLE_KINDS) {
    const enabledOrder = built
      .filter((s) => s.kind === kind && (map[s.id] ?? (defaultEnabledOf.get(s.id) ?? true)))
      .map((s) => s.id);
    for (let i = 1; i < enabledOrder.length; i++) {
      if (map[enabledOrder[i]] !== false) {
        map[enabledOrder[i]] = false;
        changed = true;
      }
    }
  }
  if (changed) {
    await setEnabledMap(map);
  }
  return buildScriptList(map, users);
}

/** 由启用映射构造脚本视图（内置在前，用户在后） */
function buildScriptList(enabled: Record<string, boolean>, users: LuaUserScript[]): LuaScriptView[] {
  const fromBuiltin = (b: BuiltinScriptMeta): LuaScriptView => ({
    id: b.id,
    name: b.name,
    kind: b.kind,
    code: b.code,
    builtin: true,
    enabled: enabled[b.id] ?? b.defaultEnabled,
    description: b.description,
  });
  const builtins = BUILTIN_SCRIPTS.map(fromBuiltin);
  // 内置脚本默认启用 defaultEnabled；用户脚本默认启用
  const userViews: LuaScriptView[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    kind: u.kind,
    code: u.code,
    builtin: false,
    enabled: enabled[u.id] ?? true,
  }));
  return [...builtins, ...userViews];
}

/** 取某方向生效中的脚本（card/flower/export 唯一生效；advice 取全部启用） */
export async function enabledScriptsOf(kind: ScriptKind): Promise<LuaScriptView[]> {
  const all = await listScripts();
  return all.filter((s) => s.kind === kind && s.enabled);
}

/** 取某方向单一生效脚本（单一消费方）；无启用脚本返回 null */
export async function activeScriptOf(kind: ScriptKind): Promise<LuaScriptView | null> {
  if (!isSingleKind(kind)) return null;
  const scripts = await enabledScriptsOf(kind);
  return scripts[0] ?? null;
}

/* ------------------------- 导入 / 导出 ------------------------- */

/** 宽松校验种类字段：未知值回退 advice，不整条丢弃 */
function asKind(k: unknown): ScriptKind {
  return typeof k === 'string' && (SCRIPT_KINDS as readonly string[]).includes(k)
    ? (k as ScriptKind)
    : 'advice';
}

/** 由脚本内容推断方向：按全局函数名识别（importLuaFile 的兜底） */
export function inferScriptKind(code: string): ScriptKind {
  if (/function\s+template\s*\(/.test(code)) return 'card';
  if (/function\s+flower\s*\(/.test(code)) return 'flower';
  if (/function\s+export\s*\(/.test(code)) return 'export';
  return 'advice';
}

/** 导入格式（分享 = 一段 JSON；宽松校验，坏数据逐条丢弃） */
export interface LuaScriptExport {
  version: 1;
  scripts: Array<{ name: string; kind: ScriptKind; code: string }>;
}

/** 新脚本 id（导入/新建共用） */
function newId(): string {
  return `lua-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 导入 JSON 打包的脚本（分享格式）；坏条目逐条丢弃，返回导入条数 */
export async function importScripts(raw: string): Promise<number> {
  const parsed = JSON.parse(raw) as LuaScriptExport;
  if (parsed?.version !== 1 || !Array.isArray(parsed.scripts)) {
    throw new Error('invalid script export');
  }
  let count = 0;
  for (const s of parsed.scripts) {
    if (typeof s?.name !== 'string' || typeof s?.code !== 'string' || !s.code.trim()) continue;
    await putUserScript({
      id: newId(),
      name: s.name.slice(0, 60),
      // 保留原始种类（此前把 flower / export 静默降级成 advice，导入即失效）
      kind: asKind(s.kind),
      code: s.code,
      createdAt: 0,
      updatedAt: 0,
    });
    count++;
  }
  return count;
}

/**
 * 导入单个 .lua 文件：文件名（去扩展名）即脚本名，方向按内容推断
 * （template → card，flower → flower，export → export，其余 advice）。
 * 单一方向脚本导入即生效（自动停用同方向旧脚本），避免「导入了却没跑」。
 * 返回导入数量（0 = 内容为空）。
 */
export async function importLuaFile(fileName: string, code: string): Promise<number> {
  const trimmed = code.trim();
  if (!trimmed) return 0;
  const kind = inferScriptKind(trimmed);
  const id = newId();
  await putUserScript({
    id,
    name: (fileName.replace(/\.lua$/i, '').trim() || 'script').slice(0, 60),
    kind,
    code: trimmed,
    createdAt: 0,
    updatedAt: 0,
  });
  if (isSingleKind(kind)) {
    await setScriptEnabled(id, true);
  }
  return 1;
}

/** 导入 .lua 单文件或 JSON 打包（按扩展名/内容自动分派） */
export async function importAny(fileName: string, content: string): Promise<number> {
  if (/\.lua$/i.test(fileName) || !content.trimStart().startsWith('{')) {
    return importLuaFile(fileName, content);
  }
  return importScripts(content);
}

/** 导出脚本为 JSON 打包字符串（可分享） */
export function exportScripts(scripts: LuaScriptView[]): string {
  const payload: LuaScriptExport = {
    version: 1,
    scripts: scripts.map((s) => ({ name: s.name, kind: s.kind, code: s.code })),
  };
  return JSON.stringify(payload, null, 2);
}
