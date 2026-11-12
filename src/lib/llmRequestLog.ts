/**
 * LLM 请求日志（数据透明面板用）
 * 每次 LLM 调用前记录「实际发出的请求体」到 kv（llm:requestLog，封顶 10 条，
 * 写入串行化防并发互相覆盖）。请求体只含 model / temperature / messages /
 * stream 选项——API Key 在 Authorization 头，从不进入 body，因此记录
 * 请求体即可如实展示「离开了本机的是什么」，不含任何密钥。
 * messages 单条内容超长时截断并标注，控制 kv 体积。
 */

import { idbDeleteKV, idbGetKV, idbPutKV } from '@/lib/storage/idb';
import type { LlmFeature } from '@/lib/llmUsage';

const KV_LOG = 'llm:requestLog';
/** 封顶条数 */
const CAP = 10;
/** messages 中单条 content 的截断长度 */
const MAX_CONTENT = 4000;

export interface LlmRequestLogEntry {
  ts: number;
  /** 调用来源（建议 / 周报 / AI 翻译 / 连接测试）；undefined 计为 other */
  feature: LlmFeature | 'other';
  model: string;
  /** 接口主机名（baseUrl 的 host） */
  host: string;
  /** 是否流式调用 */
  stream: boolean;
  /** 发送的请求体 JSON（messages 超长处截断标注） */
  body: string;
}

/** 请求体展示对象（与实际发送一致，messages 截断） */
interface DisplayBody {
  model?: unknown;
  temperature?: unknown;
  stream?: unknown;
  stream_options?: unknown;
  messages?: { role: string; content: string }[];
}

function truncate(value: unknown): string {
  const s = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return s.length <= MAX_CONTENT ? s : `${s.slice(0, MAX_CONTENT)}…(${s.length - MAX_CONTENT} more chars)`;
}

/** baseUrl → host（解析失败返回原文） */
function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/** 串行化 kv 读改写，防并发调用互相覆盖 */
let queue: Promise<void> = Promise.resolve();

/**
 * 记录一次 LLM 请求（失败静默——日志绝不影响主流程）。
 * 在 fetch 发出前调用；bodyObj 即发送的请求体（不含 API Key）。
 * 返回落库 Promise（调用方一般 void 之；测试可 await）。
 */
export function recordLlmRequest(
  feature: LlmFeature | undefined,
  cfg: { baseUrl: string; modelId: string },
  bodyObj: DisplayBody,
  stream: boolean,
): Promise<void> {
  const entry: LlmRequestLogEntry = {
    ts: Date.now(),
    feature: feature ?? 'other',
    model: cfg.modelId,
    host: hostOf(cfg.baseUrl),
    stream,
    body: JSON.stringify(
      {
        ...bodyObj,
        messages: (bodyObj.messages ?? []).map((m) => ({ role: m.role, content: truncate(m.content) })),
      },
      null,
      2,
    ),
  };
  queue = queue.then(async () => {
    try {
      const list = (await idbGetKV<LlmRequestLogEntry[]>(KV_LOG)) ?? [];
      const next = [entry, ...list].slice(0, CAP);
      await idbPutKV(KV_LOG, next);
    } catch {
      /* 日志失败不影响主流程 */
    }
  });
  return queue;
}

/** 读取请求日志（新的在前） */
export async function readLlmRequestLog(): Promise<LlmRequestLogEntry[]> {
  return (await idbGetKV<LlmRequestLogEntry[]>(KV_LOG)) ?? [];
}

/** 清空请求日志 */
export async function clearLlmRequestLog(): Promise<void> {
  await idbDeleteKV(KV_LOG);
}
