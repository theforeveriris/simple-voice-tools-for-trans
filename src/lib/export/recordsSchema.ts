/**
 * 记录格式校验器（records-v2 开放标准的轻量实现）
 * 面向外部工具与本应用的「导入体检」：不引第三方 Schema 库，手写结构与范围校验，
 * 返回人类可读的错误清单（路径 + 原因）。目标是「宽容读入、严格报告」：
 * 导入链路（parseRecordsPayload）保持向后兼容，本校验器用于显式验证文件是否
 * 符合公开 Schema（documentation/schema/records-v2.schema.json）。
 */

import type { AnalysisRecord } from '@/types';
import { APP_ID, isKnownAppId } from '@/lib/appId';

export interface ValidationIssue {
  /** JSON 路径（如 records[3].series.f0） */
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  /** 校验过的记录条数 */
  recordCount: number;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && isFinite(v);
const isNumOrNull = (v: unknown): boolean => v === null || isNum(v);

/** 单条记录校验（series 等长 + stats 必备字段 + 数值范围抽检） */
export function validateRecord(rec: unknown, prefix: string, issues: ValidationIssue[]): void {
  if (rec == null || typeof rec !== 'object') {
    issues.push({ path: prefix, message: 'record is not an object' });
    return;
  }
  const r = rec as Record<string, unknown>;
  for (const key of ['id', 'createdAt', 'durationSec', 'sampleHz', 'series', 'stats']) {
    if (r[key] === undefined) issues.push({ path: prefix, message: `missing required field "${key}"` });
  }
  if (!isNum(r.createdAt) || r.createdAt <= 0) {
    issues.push({ path: `${prefix}.createdAt`, message: 'must be a positive epoch-ms integer' });
  }
  if (r.mode !== undefined && !['reading', 'sustained', 'glide'].includes(r.mode as string)) {
    issues.push({ path: `${prefix}.mode`, message: `unknown mode "${String(r.mode)}"` });
  }

  // series：等长、t 升序、元素数值或 null
  const series = r.series as Record<string, unknown> | undefined;
  if (series != null && typeof series === 'object') {
    const t = series.t as unknown[];
    if (!Array.isArray(t)) {
      issues.push({ path: `${prefix}.series.t`, message: 'must be an array' });
    } else {
      for (const col of ['f0', 'rmsDb', 'f1', 'f2']) {
        const arr = series[col] as unknown[] | undefined;
        if (arr !== undefined && (!Array.isArray(arr) || arr.length !== t.length)) {
          issues.push({ path: `${prefix}.series.${col}`, message: `length ${Array.isArray(arr) ? arr.length : 'n/a'} != t.length ${t.length}` });
        }
      }
      for (let i = 1; i < Math.min(t.length, 8); i++) {
        if (!isNum(t[i]) || !isNum(t[i - 1]) || (t[i] as number) <= (t[i - 1] as number)) {
          issues.push({ path: `${prefix}.series.t[${i}]`, message: 't must be strictly ascending numbers' });
          break;
        }
      }
    }
  }

  // stats：必备标量
  const stats = r.stats as Record<string, unknown> | undefined;
  if (stats != null && typeof stats === 'object') {
    for (const key of ['durationSec', 'sampleHz', 'totalSamples', 'voicedSamples', 'avgF0', 'medianF0', 'minF0', 'maxF0', 'p10F0', 'p90F0', 'stdF0', 'avgDb', 'peakDb']) {
      if (!isNum(stats[key])) issues.push({ path: `${prefix}.stats.${key}`, message: 'missing or non-finite number' });
    }
    for (const key of ['malePct', 'femalePct', 'transitionPct']) {
      const v = stats[key];
      if (!isNum(v) || (v as number) < 0 || (v as number) > 100) {
        issues.push({ path: `${prefix}.stats.${key}`, message: 'must be a number in [0, 100]' });
      }
    }
    for (const key of ['avgF1', 'avgF2', 'jitterPct', 'shimmerPct', 'hnrDb', 'cppsDb', 'inTargetPct', 'h1h2Db', 'h2h4Db', 'h1a3Db', 'breathiness', 'nasalityDb']) {
      if (stats[key] !== undefined && !isNumOrNull(stats[key])) {
        issues.push({ path: `${prefix}.stats.${key}`, message: 'must be a number or null' });
      }
    }
  }

  // env：可选，字段类型抽检
  const env = r.env as Record<string, unknown> | undefined;
  if (env !== undefined && env !== null && typeof env === 'object') {
    if (env.noiseFloorDb !== undefined && !isNum(env.noiseFloorDb)) {
      issues.push({ path: `${prefix}.env.noiseFloorDb`, message: 'must be a number' });
    }
    if (env.hourOfDay !== undefined && !(isNum(env.hourOfDay) && Number.isInteger(env.hourOfDay) && (env.hourOfDay as number) >= 0 && (env.hourOfDay as number) <= 23)) {
      issues.push({ path: `${prefix}.env.hourOfDay`, message: 'must be an integer in [0, 23]' });
    }
    if (env.inputGainDb !== undefined && !isNum(env.inputGainDb)) {
      issues.push({ path: `${prefix}.env.inputGainDb`, message: 'must be a number' });
    }
  }
}

/** 校验整个导出 JSON（解析后的对象） */
export function validateRecordsPayload(parsed: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (parsed == null || typeof parsed !== 'object') {
    return { ok: false, issues: [{ path: '', message: 'payload is not an object' }], recordCount: 0 };
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.app !== undefined && !isKnownAppId(obj.app)) {
    issues.push({ path: 'app', message: `expected "${APP_ID}", got "${String(obj.app)}"` });
  }
  if (obj.version !== undefined && obj.version !== 2 && obj.version !== 1) {
    issues.push({ path: 'version', message: `unsupported version ${String(obj.version)} (validator supports 1-2)` });
  }
  if (!Array.isArray(obj.records)) {
    return { ok: false, issues: [{ path: 'records', message: 'missing records array' }], recordCount: 0 };
  }
  obj.records.forEach((rec, i) => validateRecord(rec, `records[${i}]`, issues));
  return { ok: issues.length === 0, issues, recordCount: obj.records.length };
}

/** 便捷入口：校验 JSON 字符串 */
export function validateRecordsJson(json: string): ValidationResult & { parseError?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { ok: false, issues: [], recordCount: 0, parseError: e instanceof Error ? e.message : String(e) };
  }
  return validateRecordsPayload(parsed);
}

/** 类型收窄辅助：校验通过的记录数组（不修改数据，仅断言形状） */
export function asAnalysisRecords(parsed: unknown): AnalysisRecord[] {
  return Array.isArray((parsed as { records?: unknown })?.records)
    ? ((parsed as { records: AnalysisRecord[] }).records)
    : [];
}
