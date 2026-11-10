/**
 * 兼容部分模型把工具调用写成普通文本的格式：
 *
 *   <tool_call>get_stats(mode='朗读', range='last_7d')</tool_call>
 *   <tool_call>{"name":"get_stats","arguments":{"selector":"week"}}</tool_call>
 *
 * 正常 OpenAI / Anthropic 的结构化 tool_calls 仍由 llmClient 解析；这里只做兜底，
 * 解析出的调用仍经过 assistantAgent 的工具名校验、参数 schema 校验和超时包装。
 */
import type { LlmToolCall } from './llmClient';

const BLOCK_RE = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
const CALL_RE = /^([A-Za-z_][\w]*)\s*\(([\s\S]*)\)\s*$/;

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** 按顶层逗号拆分参数（忽略引号 / 括号内的逗号） */
function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth = Math.max(0, depth - 1);
    } else if (ch === ',' && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

function parseValue(raw: string): unknown {
  const text = raw.trim();
  const quoted = text.match(/^(['"])([\s\S]*)\1$/);
  if (quoted) {
    return quoted[2]
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\(['"\\])/g, '$1');
  }
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null' || text === 'nil') return null;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  const json = tryJson(text);
  if (json !== undefined) return json;
  return text;
}

function parseKwargs(raw: string): Record<string, unknown> | null {
  const args: Record<string, unknown> = {};
  for (const part of splitTopLevel(raw)) {
    const match = part.match(/^([A-Za-z_][\w]*)\s*=\s*([\s\S]+)$/);
    if (!match) return null;
    args[match[1]] = parseValue(match[2]);
  }
  return args;
}

function toCall(body: string, index: number): LlmToolCall | null {
  const json = tryJson(body);
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const obj = json as Record<string, unknown>;
    const fn = obj.function && typeof obj.function === 'object'
      ? obj.function as Record<string, unknown>
      : obj;
    const name = typeof fn.name === 'string' ? fn.name : '';
    const args = fn.arguments ?? fn.parameters;
    if (name) {
      const parsed = typeof args === 'string' ? tryJson(args) : args;
      return {
        id: `text-${index + 1}`,
        name,
        arguments: parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? parsed as Record<string, unknown>
          : {},
      };
    }
  }

  const match = body.match(CALL_RE);
  if (!match) return null;
  const name = match[1];
  const rawArgs = match[2].trim();
  if (!rawArgs) return { id: `text-${index + 1}`, name, arguments: {} };
  const jsonArgs = tryJson(rawArgs);
  if (jsonArgs && typeof jsonArgs === 'object' && !Array.isArray(jsonArgs)) {
    return {
      id: `text-${index + 1}`,
      name,
      arguments: jsonArgs as Record<string, unknown>,
    };
  }
  const kwargs = parseKwargs(rawArgs);
  return kwargs ? { id: `text-${index + 1}`, name, arguments: kwargs } : null;
}

/** 从模型正文中提取文本形式的工具调用；没有则返回空数组 */
export function parseTextToolCalls(content: string): LlmToolCall[] {
  const calls: LlmToolCall[] = [];
  for (const match of content.matchAll(BLOCK_RE)) {
    const call = toCall(match[1].trim(), calls.length);
    if (call) calls.push(call);
  }
  return calls;
}
