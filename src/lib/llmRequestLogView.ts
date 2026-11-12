/**
 * AI 请求日志的展示辅助（纯函数）
 * - summary：从 messages / prompt 里取最后一条用户消息，压成单行摘要，供列表扫读
 * - userText：完整用户消息，供详情页展示
 * - pretty：格式化后的请求体（解析失败时保持原文）
 * - bytes：UTF-8 字节数
 */

export interface RequestView {
  summary: string | null;
  userText: string | null;
  pretty: string;
  bytes: number;
}

/** 列表摘要长度上限（字符） */
const SUMMARY_CHARS = 90;
/** 详情里用户消息的展示上限，防止极端长文撑爆页面 */
const USER_TEXT_MAX = 4000;

function contentText(content: unknown): string | null {
  if (typeof content === 'string') return content.trim() || null;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const c of content) {
      if (typeof c === 'string') parts.push(c);
      else if (c && typeof c === 'object' && typeof (c as Record<string, unknown>).text === 'string') {
        parts.push((c as Record<string, unknown>).text as string);
      }
    }
    const text = parts.join(' ').trim();
    return text || null;
  }
  return null;
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** 最后一条用户消息；没有 messages 时退回 prompt / input */
function lastUserText(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (Array.isArray(o.messages)) {
    for (let i = o.messages.length - 1; i >= 0; i--) {
      const m = o.messages[i];
      if (!m || typeof m !== 'object') continue;
      const rec = m as Record<string, unknown>;
      if (rec.role !== 'user') continue;
      const text = contentText(rec.content);
      if (text) return text;
    }
  }
  return contentText(o.prompt) ?? contentText(o.input);
}

/** 把一条日志的原始请求体解析成列表 / 详情需要的字段 */
export function buildRequestView(body: string): RequestView {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    /* 非 JSON 请求体原样展示 */
  }
  const userText = parsed == null ? null : lastUserText(parsed);
  return {
    summary: userText ? oneLine(userText, SUMMARY_CHARS) : null,
    userText: userText ? userText.slice(0, USER_TEXT_MAX) : null,
    pretty: parsed == null ? body : JSON.stringify(parsed, null, 2),
    bytes: new TextEncoder().encode(body).length,
  };
}

/** 字节数 → 紧凑体积（1.4 KB / 812 B） */
export function formatBodySize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
}
