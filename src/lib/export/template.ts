/**
 * 导出格式自定义模板（零代码导出生态）
 * 语法：文本模板 + {{path}} 占位符，路径为 record 视图的点分链
 *   {{stats.avgF0}}          → 162.3（数值原样）
 *   {{stats.avgF0|%.1f}}     → 162.3（printf 风格格式化：%.1f %.2f %d 等）
 *   {{date}}                 → 2026/1/31（本地化日期）
 *   {{time}}                 → 14:05（本地化时间）
 *   {{mode}}                 → reading（原文）或 {{mode|label}} → 随意朗读（本地化标签）
 *   {{note}}                 → 备注（空则空串）
 *   {{stats.cppsDb|%.1f|dB}} → 14.2dB（缺失字段整段替换为空串，含后缀）
 * 未知字段 / 缺失字段 → 整个占位符替换为空串（不是 "undefined"），随访单不会出现坏字样。
 * 模板以 JSON 文件分享（.svt-template：{ name, template }），导入导出各一行代码。
 */

import { t } from '@/i18n';
import { APP_ID } from '@/lib/appId';
import type { AnalysisRecord, RecordSeries } from '@/types';

export interface ExportTemplate {
  name: string;
  template: string;
}

/** 模板分享文件（.svt-template） */
export interface TemplateExport {
  app: typeof APP_ID;
  kind: 'template';
  version: 1;
  name: string;
  template: string;
}

const MAX_TEMPLATE = 64 * 1024;
const MAX_OUTPUT = 4 * 1024 * 1024;

/* ------------------------------ 取值层 ------------------------------ */

/** record 视图：模板可见的字段（刻意收窄，不暴露 series 全量帧——大数据量请用 Lua 桥） */
function recordView(rec: AnalysisRecord): Record<string, unknown> {
  const s = rec.stats;
  return {
    id: rec.id,
    date: formatDate(rec.createdAt),
    time: formatTime(rec.createdAt),
    mode: rec.mode ?? 'reading',
    note: rec.note ?? '',
    durationSec: rec.durationSec,
    sampleHz: rec.sampleHz,
    stats: s as unknown as Record<string, unknown>,
    target: null, // 由调用方注入（settings.targetF0Min/Max）
  };
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 点分路径安全取值：任一环缺失 → undefined（不抛错） */
function pick(obj: Record<string, unknown>, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/* ------------------------------ 格式化层 ------------------------------ */

/** printf 风格的最小实现：%d %f %.Nf %s（够模板用） */
function formatPrintf(value: number, spec: string): string {
  const m = spec.match(/^%(\d*)(?:\.(\d+))?([dfs])$/);
  if (!m) return String(value);
  const [, widthStr, precStr, kind] = m;
  if (kind === 'd') {
    const s = String(Math.round(value));
    const width = Number(widthStr) || 0;
    return width > s.length ? s.padStart(width, '0') : s;
  }
  if (kind === 's') return String(value);
  const prec = precStr != null ? Number(precStr) : 6;
  return value.toFixed(prec);
}

/** 模式标签（本地化） */
function modeLabel(mode: string): string {
  const keys: Record<string, Parameters<typeof t>[0]> = {
    reading: 'mode.reading',
    sustained: 'mode.sustained',
    glide: 'mode.glide',
  };
  return keys[mode] ? t(keys[mode]) : mode;
}

/* ------------------------------ 渲染 ------------------------------ */

const PLACEHOLDER_RE = /\{\{([^{}]+)\}\}/g;

/**
 * 渲染模板：占位符替换为值；缺失/未知字段 → 空串。
 * 无效模板（超限）→ null。
 */
export function renderTemplate(tpl: ExportTemplate, record: AnalysisRecord, target?: { min: number; max: number } | null): string | null {
  if (tpl.template.length > MAX_TEMPLATE) return null;
  const view = recordView(record);
  if (target) view.target = target;
  const out = tpl.template.replace(PLACEHOLDER_RE, (_whole, rawExpr: string) => {
    const parts = rawExpr.split('|').map((p) => p.trim());
    const [path, fmt, suffix] = parts;
    const value = pick(view, path);
    if (value == null || value === '') return ''; // 缺失字段整段消失（含后缀）
    if (path === 'mode' && fmt === 'label') return modeLabel(String(value));
    let text: string;
    if (fmt && typeof value === 'number') text = formatPrintf(value, fmt);
    else if (fmt && !suffix && !/^%/.test(fmt) && path !== 'mode') text = `${value}${fmt}`; // 无 % 前缀的第二段当作后缀
    else text = String(value);
    return suffix != null ? `${text}${suffix}` : text;
  });
  if (out.length > MAX_OUTPUT) return null;
  return out;
}

/** 模板文件序列化（分享用） */
export function exportTemplateFile(tpl: ExportTemplate): string {
  const payload: TemplateExport = {
    app: APP_ID,
    kind: 'template',
    version: 1,
    name: tpl.name,
    template: tpl.template,
  };
  return JSON.stringify(payload, null, 2);
}

/** 模板文件解析（导入用；宽松校验） */
export function parseTemplateFile(raw: string): ExportTemplate | null {
  try {
    const p = JSON.parse(raw) as Partial<TemplateExport>;
    if (p.kind !== 'template' || typeof p.template !== 'string' || !p.template.trim()) return null;
    return {
      name: (typeof p.name === 'string' && p.name.trim() ? p.name.trim() : 'template').slice(0, 60),
      template: p.template.slice(0, MAX_TEMPLATE),
    };
  } catch {
    return null;
  }
}

/** 帧级序列视图：给模板提供 series 摘要（帧数 / 有声占比），完整帧请走 Lua 桥 */
export function seriesSummary(series: RecordSeries): { frames: number; voiced: number } {
  let voiced = 0;
  for (const f of series.f0) if (f != null) voiced++;
  return { frames: series.t.length, voiced };
}
