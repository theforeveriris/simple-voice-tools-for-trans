/**
 * 趋势计算（纯函数，供 get_trends 工具使用）
 *
 * 目标：把「最近几次怎么样 / 本周比上周如何 / 离基线多远」变成代码算好的
 * 均值、中位数、波动、斜率和命中率，模型只负责解释，避免心算数字偏差。
 */
import type { AnalysisRecord, TestMode } from '@/types';

export const TREND_METRICS = [
  'f0',
  'f1',
  'f2',
  'jitter',
  'shimmer',
  'hnr',
  'cpps',
  'inTarget',
  'duration',
] as const;

export type TrendMetric = (typeof TREND_METRICS)[number];

export type TrendCompare = 'previous' | 'baseline';

export interface TrendOptions {
  lastN?: number;
  mode?: TestMode | null;
  from?: string | null;
  to?: string | null;
  compare?: TrendCompare | null;
  baselineRecordId?: string | null;
}

export interface TrendResult {
  metric: TrendMetric;
  count: number;
  selected: number;
  coverage: number;
  recordIds: string[];
  dates: string[];
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  std: number | null;
  slopePerWeek: number | null;
  delta: number | null;
  percent: number | null;
  targetHitRate: number | null;
  previousDelta: number | null;
  baselineDelta: number | null;
  compare: TrendCompare | null;
}

const METRIC_LABEL: Record<TrendMetric, string> = {
  f0: 'F0 中位',
  f1: 'F1 均值',
  f2: 'F2 均值',
  jitter: 'Jitter',
  shimmer: 'Shimmer',
  hnr: 'HNR',
  cpps: 'CPPS',
  inTarget: '靶标命中率',
  duration: '录音时长',
};

const METRIC_UNIT: Record<TrendMetric, string> = {
  f0: 'Hz',
  f1: 'Hz',
  f2: 'Hz',
  jitter: '%',
  shimmer: '%',
  hnr: 'dB',
  cpps: 'dB',
  inTarget: '%',
  duration: 's',
};

const METRIC_DIGITS: Record<TrendMetric, number> = {
  f0: 1,
  f1: 0,
  f2: 0,
  jitter: 2,
  shimmer: 2,
  hnr: 1,
  cpps: 1,
  inTarget: 1,
  duration: 1,
};

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

export function isTrendMetric(value: unknown): value is TrendMetric {
  return typeof value === 'string' && (TREND_METRICS as readonly string[]).includes(value);
}

export function trendMetricLabel(metric: TrendMetric): string {
  return METRIC_LABEL[metric];
}

export function trendMetricUnit(metric: TrendMetric): string {
  return METRIC_UNIT[metric];
}

/** 单条记录在某指标下的值；无数据返回 null */
export function trendMetricValue(record: AnalysisRecord, metric: TrendMetric): number | null {
  const stats = record.stats;
  let value: number | null | undefined;
  switch (metric) {
    case 'f0':
      value = stats.medianF0;
      break;
    case 'f1':
      value = stats.avgF1;
      break;
    case 'f2':
      value = stats.avgF2;
      break;
    case 'jitter':
      value = stats.jitterPct;
      break;
    case 'shimmer':
      value = stats.shimmerPct;
      break;
    case 'hnr':
      value = stats.hnrDb;
      break;
    case 'cpps':
      value = stats.cppsDb;
      break;
    case 'inTarget':
      value = stats.inTargetPct;
      break;
    case 'duration':
      value = stats.durationSec;
      break;
    default:
      value = null;
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseDateStart(value: string | null | undefined): number | null {
  if (!value) return null;
  const ts = Date.parse(`${value}T00:00:00`);
  return Number.isFinite(ts) ? ts : null;
}

function parseDateEnd(value: string | null | undefined): number | null {
  if (!value) return null;
  const ts = Date.parse(`${value}T23:59:59.999`);
  return Number.isFinite(ts) ? ts : null;
}

function summarize(values: number[]): { mean: number; median: number; min: number; max: number; std: number } | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((acc, value) => acc + value, 0);
  const mean = sum / values.length;
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
  const variance = values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / values.length;
  return {
    mean,
    median,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    std: Math.sqrt(variance),
  };
}

/** 按日期线性回归，返回每周斜率；样本不足或时间跨度为零时返回 null */
function slopePerWeek(records: AnalysisRecord[], values: number[]): number | null {
  if (records.length < 2 || values.length !== records.length) return null;
  const first = records[0].createdAt;
  const xs = records.map((record) => (record.createdAt - first) / WEEK_MS);
  const xMean = xs.reduce((acc, value) => acc + value, 0) / xs.length;
  const yMean = values.reduce((acc, value) => acc + value, 0) / values.length;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < xs.length; i++) {
    numerator += (xs[i] - xMean) * (values[i] - yMean);
    denominator += (xs[i] - xMean) ** 2;
  }
  if (denominator <= 1e-9) return null;
  return numerator / denominator;
}

function filterRecords(records: AnalysisRecord[], options: TrendOptions): AnalysisRecord[] {
  const from = parseDateStart(options.from);
  const to = parseDateEnd(options.to);
  return records
    .filter((record) => (options.mode ? record.mode === options.mode : true))
    .filter((record) => (from == null ? true : record.createdAt >= from))
    .filter((record) => (to == null ? true : record.createdAt <= to))
    .sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * 计算趋势。current 取筛选后的最后 lastN 条；compare='previous' 时取紧邻的
 * 前 lastN 条作为上一周期，compare='baseline' 时使用 baselineRecordId。
 */
export function computeTrend(
  records: AnalysisRecord[],
  metric: TrendMetric,
  options: TrendOptions = {},
): TrendResult {
  const lastN = Math.max(1, Math.min(20, Math.round(options.lastN ?? 8)));
  const all = filterRecords(records, options);
  const current = all.slice(-lastN);
  const previous = options.compare === 'previous'
    ? all.slice(Math.max(0, all.length - lastN * 2), Math.max(0, all.length - lastN))
    : [];

  const valued = current
    .map((record) => ({ record, value: trendMetricValue(record, metric) }))
    .filter((entry): entry is { record: AnalysisRecord; value: number } => entry.value != null);
  const values = valued.map((entry) => entry.value);
  const summary = summarize(values);

  const previousValues = previous
    .map((record) => trendMetricValue(record, metric))
    .filter((value): value is number => value != null);
  const previousMean = previousValues.length > 0
    ? previousValues.reduce((acc, value) => acc + value, 0) / previousValues.length
    : null;

  const baseline = options.baselineRecordId
    ? records.find((record) => record.id === options.baselineRecordId) ?? null
    : null;
  const baselineValue = baseline ? trendMetricValue(baseline, metric) : null;

  const slope = slopePerWeek(valued.map((entry) => entry.record), values);
  const delta = values.length >= 2 ? values[values.length - 1] - values[0] : null;
  const first = values[0];
  const percent = delta != null && first != null && Math.abs(first) > 1e-9
    ? (delta / Math.abs(first)) * 100
    : null;

  const targetValues = metric === 'f0'
    ? current
      .map((record) => record.stats.inTargetPct)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    : [];
  const targetHitRate = targetValues.length > 0
    ? targetValues.reduce((acc, value) => acc + value, 0) / targetValues.length
    : null;

  return {
    metric,
    count: values.length,
    selected: current.length,
    coverage: current.length > 0 ? values.length / current.length : 0,
    recordIds: current.map((record) => record.id),
    dates: current.map((record) => new Date(record.createdAt).toISOString().slice(0, 10)),
    mean: summary?.mean ?? null,
    median: summary?.median ?? null,
    min: summary?.min ?? null,
    max: summary?.max ?? null,
    std: summary?.std ?? null,
    slopePerWeek: slope,
    delta,
    percent,
    targetHitRate,
    previousDelta: summary && previousMean != null ? summary.mean - previousMean : null,
    baselineDelta: summary && baselineValue != null ? summary.mean - baselineValue : null,
    compare: options.compare ?? null,
  };
}

function fmt(value: number, metric: TrendMetric): string {
  return value.toFixed(METRIC_DIGITS[metric]);
}

/** 生成给模型看的紧凑文本 */
export function formatTrendText(result: TrendResult, options: TrendOptions = {}): string {
  const label = trendMetricLabel(result.metric);
  const unit = trendMetricUnit(result.metric);
  const mode = options.mode ? ` · ${options.mode}` : '';
  const range = result.dates.length > 0
    ? `（${result.dates[0]} → ${result.dates[result.dates.length - 1]}）`
    : '';
  const lines = [
    `趋势：${label}（最近 ${options.lastN ?? 8} 条${mode}）`,
    `样本：${result.count}/${result.selected} 条有数据${range}`,
  ];
  if (result.count === 0) {
    lines.push('没有可用于计算的记录。');
  } else {
    lines.push(`均值 ${fmt(result.mean!, result.metric)} ${unit} / 中位 ${fmt(result.median!, result.metric)} ${unit}`);
    lines.push(`范围 ${fmt(result.min!, result.metric)}–${fmt(result.max!, result.metric)} ${unit} / 标准差 ${fmt(result.std!, result.metric)} ${unit}`);
    if (result.delta != null && result.percent != null) {
      const sign = result.delta >= 0 ? '+' : '';
      lines.push(`首末变化 ${sign}${fmt(result.delta, result.metric)} ${unit}（${sign}${result.percent.toFixed(1)}%）`);
    }
    lines.push(result.slopePerWeek == null
      ? '每周斜率：样本不足，无法计算'
      : `每周斜率 ${result.slopePerWeek >= 0 ? '+' : ''}${fmt(result.slopePerWeek, result.metric)} ${unit}/周`);
    if (result.targetHitRate != null) {
      lines.push(`靶标命中率均值 ${result.targetHitRate.toFixed(1)}%`);
    }
    if (result.previousDelta != null) {
      const sign = result.previousDelta >= 0 ? '+' : '';
      lines.push(`均值相比上一周期 ${sign}${fmt(result.previousDelta, result.metric)} ${unit}`);
    }
    if (result.baselineDelta != null) {
      const sign = result.baselineDelta >= 0 ? '+' : '';
      lines.push(`均值相比基线 ${sign}${fmt(result.baselineDelta, result.metric)} ${unit}`);
    }
    if (result.recordIds.length > 0) {
      lines.push(`记录 id：${result.recordIds.join(', ')}`);
    }
  }
  return lines.join('\n');
}
