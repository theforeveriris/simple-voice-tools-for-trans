/**
 * 回答中的关键数字校验
 *
 * 只校验带单位的测量数字（Hz / % / dB / 半音 / ms）。允许值来自本轮工具结果、
 * 注入的历史聚合、文档、记忆和附件；找不到依据时由调用方决定修正或标注。
 *
 * 这是「防明显编造」的轻量层，不是数学证明：派生百分比如果不在工具结果里，
 * 会被要求修正，这是有意的严格策略。
 */

const CLAIM_RE = /([+\-−]?\d+(?:\.\d+)?)\s*(Hz|hz|赫兹|%|％|dB|db|分贝|半音|semitone|st|ms|毫秒)/g;
const NUMBER_RE = /[+\-−]?\d+(?:\.\d+)?/g;

export interface NumberClaim {
  raw: string;
  value: number;
  unit: string;
}

function normalizeUnit(unit: string): string {
  const lower = unit.toLowerCase();
  if (lower === 'hz' || unit === '赫兹') return 'Hz';
  if (unit === '％') return '%';
  if (lower === 'db' || unit === '分贝') return 'dB';
  if (lower === 'semitone' || lower === 'st' || unit === '半音') return '半音';
  if (lower === 'ms' || unit === '毫秒') return 'ms';
  return unit;
}

function parseValue(raw: string): number | null {
  const normalized = raw.replace(/−/g, '-');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** 提取回答里带单位的数字声明 */
export function extractNumberClaims(text: string): NumberClaim[] {
  const out: NumberClaim[] = [];
  const re = new RegExp(CLAIM_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const value = parseValue(match[1]);
    if (value == null) continue;
    out.push({ raw: match[0], value, unit: normalizeUnit(match[2]) });
  }
  return out;
}

/** 提取任意数字（含裸数字），用于构建允许值集合 */
export function extractNumbers(text: string): number[] {
  const out: number[] = [];
  const re = new RegExp(NUMBER_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const value = parseValue(match[0]);
    if (value != null) out.push(value);
  }
  return out;
}

function closeEnough(a: number, b: number): boolean {
  const tolerance = Math.max(0.01, Math.abs(b) * 0.001);
  return Math.abs(a - b) <= tolerance;
}

function allowedFromSources(sources: string[]): number[] {
  const values: number[] = [];
  for (const source of sources) {
    if (!source) continue;
    for (const value of extractNumbers(source)) values.push(value);
  }
  return values;
}

/**
 * 返回回答中找不到依据的数字声明。
 * 同一数值在多个单位下重复出现时只保留一次，便于提示。
 */
export function findUnverifiedClaims(reply: string, sources: string[]): NumberClaim[] {
  const claims = extractNumberClaims(reply);
  if (claims.length === 0) return [];
  const allowed = allowedFromSources(sources);
  const out: NumberClaim[] = [];
  const seen = new Set<string>();
  for (const claim of claims) {
    if (allowed.some((value) => closeEnough(claim.value, value))) continue;
    const key = `${claim.value}:${claim.unit}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(claim);
  }
  return out;
}

/** 给修正模型的允许数字清单（去重、排序、限量） */
export function formatAllowedNumbers(sources: string[]): string {
  const unique = [...new Set(allowedFromSources(sources).map((value) => String(Number(value.toFixed(6)))))];
  unique.sort((a, b) => Number(a) - Number(b));
  const shown = unique.slice(0, 120);
  return shown.join('、') + (unique.length > shown.length ? ' …' : '');
}

/** 供测试/调试：判断文本是否包含带单位的数字 */
export function hasNumberClaims(text: string): boolean {
  return extractNumberClaims(text).length > 0;
}
