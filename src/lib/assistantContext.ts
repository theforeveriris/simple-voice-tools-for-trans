/**
 * AI 助手上下文组装（可单测的纯逻辑）
 *
 * 一次请求注入三类信息：
 * 1. 用户画像 / 训练靶标：来自设置，显式给模型，避免从数据反推方向；
 * 2. 历史聚合 + 钉选基线 Δ：按周 / 按模式汇总，回答趋势与进步幅度；
 * 3. 最近记录明细：保留 record:// 图表所需的记录 id，并补齐持续发声、
 *    嗓音质量与录音环境字段。
 *
 * 预算按 token 估算裁剪：画像固定保留，聚合优先，基线其次，明细按剩余预算
 * 从最新往回装。
 */

import type { AnalysisRecord, AppSettings, TestMode, VoiceStats } from '@/types';
import { computeSustainedMetrics, type SustainedMetrics } from '@/lib/audio/sustained';
import { estimateTokens } from '@/lib/llmUsage';
import { baselinePayload } from './llmAdvice';

/** 助手需要的设置子集（其余设置不进入对话上下文） */
export type AssistantContextSettings = Pick<
  AppSettings,
  | 'userGoal'
  | 'ageGroup'
  | 'targetEnabled'
  | 'targetF0Min'
  | 'targetF0Max'
  | 'formantTargetEnabled'
  | 'formantTargetF1'
  | 'formantTargetF2'
  | 'formantTargetRadius'
  | 'bandBounds'
  | 'baselineRecordId'
>;

export interface AssistantContext {
  /** 用户画像与训练靶标（无记录时也注入） */
  profile: string;
  /** 历史聚合、基线 Δ 与最近记录明细 */
  history: string;
}

const GOAL_LABELS: Record<AppSettings['userGoal'], string> = {
  mtf: '女性化（MtF）',
  ftm: '男性化（FtM）',
  other: '其他 / 未指定',
};

const AGE_LABELS: Record<AppSettings['ageGroup'], string> = {
  child: '儿童',
  adolescent: '青少年',
  adult: '成人',
  senior: '长者',
};

const MODE_LABELS: Record<TestMode | 'free', string> = {
  reading: '朗读',
  sustained: '持续发声',
  glide: '滑音',
  free: '自由 / 未标注',
};

const MODE_ORDER: (TestMode | 'free')[] = ['reading', 'sustained', 'glide', 'free'];

/** 最近记录明细上限（更旧的记录已在聚合里体现） */
const MAX_RAW_RECORDS = 40;
/** 按周聚合最多展示的周数 */
const MAX_WEEKS = 8;

const pad = (n: number) => String(n).padStart(2, '0');

function localDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localDateTime(ts: number): string {
  const d = new Date(ts);
  return `${localDate(ts)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 单行文本清洗：防止备注 / 麦克风标签里的换行或分隔符破坏记录行 */
function oneLine(s: string, max = 80): string {
  const clean = s.replace(/[\r\n|]+/g, ' / ').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function num(n: number | null | undefined, digits = 1): string | null {
  return n == null || !Number.isFinite(n) ? null : n.toFixed(digits);
}

function mean(values: (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

function median(values: (number | null | undefined)[]): number | null {
  const nums = values
    .filter((v): v is number => v != null && Number.isFinite(v))
    .sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

/** F2−F1 间距：新记录有同帧均值，旧记录回退到两个均值之差 */
function f2f1Gap(stats: VoiceStats): number | null {
  if (stats.f2f1GapHz != null) return stats.f2f1GapHz;
  if (stats.avgF1 != null && stats.avgF2 != null) return stats.avgF2 - stats.avgF1;
  return null;
}

function modeOf(rec: AnalysisRecord): TestMode | 'free' {
  return rec.mode ?? 'free';
}

function sustainedOf(rec: AnalysisRecord): SustainedMetrics | null {
  if (rec.mode !== 'sustained') return null;
  try {
    return computeSustainedMetrics(rec);
  } catch {
    return null;
  }
}

/** 用户画像与训练靶标：让助手与建议卡 / 周报使用同一套口径 */
export function buildAssistantProfile(settings: AssistantContextSettings): string {
  const goal = GOAL_LABELS[settings.userGoal] ?? GOAL_LABELS.other;
  const age = AGE_LABELS[settings.ageGroup] ?? AGE_LABELS.adult;
  const bounds = settings.bandBounds?.length === 4 ? settings.bandBounds : [85, 165, 180, 255];
  const lines = [
    '## 用户画像与训练目标（显式设置，勿从数据反推方向）',
    `- 训练方向：${goal}`,
    `- 年龄段：${age}`,
  ];

  if (settings.targetEnabled) {
    lines.push(`- 目标音高区间：${settings.targetF0Min}–${settings.targetF0Max} Hz（已启用）`);
  } else {
    lines.push(
      `- 目标音高区间：未启用（当前配置 ${settings.targetF0Min}–${settings.targetF0Max} Hz，仅作参考）`,
    );
  }

  if (settings.formantTargetEnabled) {
    lines.push(
      `- 共振峰目标区：F1 ${settings.formantTargetF1} ± ${settings.formantTargetRadius} Hz，`
      + `F2 ${settings.formantTargetF2} ± ${settings.formantTargetRadius} Hz（已启用）`,
    );
  } else {
    lines.push('- 共振峰目标区：未启用');
  }

  lines.push(
    `- 音区边界：${bounds.join(' / ')} Hz（${settings.bandBounds ? '自定义' : '默认'}；`
    + '用于解释男声 / 过渡 / 女声区间占比）',
  );
  lines.push('- 回答时请按以上区间与目标判断，不要自行假设用户的训练方向或目标音高。');

  return lines.join('\n');
}

interface Aggregate {
  count: number;
  days: number;
  avgF0: number | null;
  p10: number | null;
  p90: number | null;
  targetPct: number | null;
  jitter: number | null;
  shimmer: number | null;
  hnr: number | null;
  cpps: number | null;
  gap: number | null;
  breathiness: number | null;
  nasality: number | null;
  tilt: number | null;
  mpt: number | null;
  decay: number | null;
  avgDb: number | null;
  noiseDb: number | null;
}

function aggregateOf(
  records: AnalysisRecord[],
  sustained: Map<string, SustainedMetrics | null>,
): Aggregate {
  const days = new Set(records.map((r) => localDate(r.createdAt))).size;
  const sustainedRecords = records
    .map((r) => sustained.get(r.id))
    .filter((m): m is SustainedMetrics => m != null);
  return {
    count: records.length,
    days,
    avgF0: mean(records.map((r) => r.stats.avgF0)),
    p10: mean(records.map((r) => r.stats.p10F0)),
    p90: mean(records.map((r) => r.stats.p90F0)),
    targetPct: mean(records.map((r) => r.stats.inTargetPct)),
    jitter: mean(records.map((r) => r.stats.jitterPct)),
    shimmer: mean(records.map((r) => r.stats.shimmerPct)),
    hnr: mean(records.map((r) => r.stats.hnrDb)),
    cpps: mean(records.map((r) => r.stats.cppsDb)),
    gap: mean(records.map((r) => f2f1Gap(r.stats))),
    breathiness: mean(records.map((r) => r.stats.breathiness)),
    nasality: mean(records.map((r) => r.stats.nasalityDb)),
    tilt: mean(records.map((r) => r.stats.spectralTiltDbOct)),
    mpt: mean(sustainedRecords.map((m) => m.mptSec)),
    decay: mean(sustainedRecords.map((m) => m.decayDbPerSec)),
    avgDb: mean(records.map((r) => r.stats.avgDb)),
    noiseDb: median(records.map((r) => r.env?.noiseFloorDb)),
  };
}

function metricParts(a: Aggregate): string[] {
  const parts = [
    a.avgF0 != null ? `avgF0 ${num(a.avgF0)}Hz` : null,
    a.p10 != null && a.p90 != null ? `P10–P90 ${num(a.p10, 0)}–${num(a.p90, 0)}Hz` : null,
    a.targetPct != null ? `靶标 ${num(a.targetPct, 0)}%` : null,
    a.jitter != null ? `Jitter ${num(a.jitter, 2)}%` : null,
    a.shimmer != null ? `Shimmer ${num(a.shimmer, 2)}%` : null,
    a.hnr != null ? `HNR ${num(a.hnr)}dB` : null,
    a.cpps != null ? `CPPS ${num(a.cpps)}dB` : null,
    a.gap != null ? `F2−F1 ${num(a.gap, 0)}Hz` : null,
    a.breathiness != null ? `气声 ${num(a.breathiness, 2)}` : null,
    a.nasality != null ? `鼻化 ${num(a.nasality)}dB` : null,
    a.tilt != null ? `谱倾斜 ${num(a.tilt, 1)}dB/oct` : null,
    a.mpt != null ? `MPT ${num(a.mpt)}s` : null,
    a.decay != null ? `衰减 ${num(a.decay, 2)}dB/s` : null,
    a.avgDb != null ? `响度 ${num(a.avgDb)}dB` : null,
    a.noiseDb != null ? `底噪中位 ${num(a.noiseDb)}dB` : null,
  ];
  return parts.filter((p): p is string => p != null);
}

function weekStartLocal(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const offset = (d.getDay() + 6) % 7; // 周一为一周起点
  d.setDate(d.getDate() - offset);
  return d.getTime();
}

function shortWeek(ts: number): string {
  const start = new Date(ts);
  const end = new Date(ts);
  end.setDate(end.getDate() + 6);
  return `${pad(start.getMonth() + 1)}-${pad(start.getDate())}~${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;
}

/** 趋势：首周 → 末周（均按周均值），只输出两边都有值的指标 */
function trendLine(weeks: { agg: Aggregate }[]): string | null {
  if (weeks.length < 2) return null;
  const first = weeks[0].agg;
  const last = weeks[weeks.length - 1].agg;
  const d = (a: number | null, b: number | null, digits = 1, unit = ''): string | null => {
    if (a == null || b == null) return null;
    const diff = a - b;
    return `${diff > 0 ? '+' : ''}${diff.toFixed(digits)}${unit}`;
  };
  const parts = [
    d(last.avgF0, first.avgF0, 1, ' Hz') ? `avgF0 ${d(last.avgF0, first.avgF0, 1, ' Hz')}` : null,
    d(last.targetPct, first.targetPct, 0, ' 个百分点')
      ? `靶标 ${d(last.targetPct, first.targetPct, 0, ' 个百分点')}` : null,
    d(last.cpps, first.cpps, 1, ' dB') ? `CPPS ${d(last.cpps, first.cpps, 1, ' dB')}` : null,
    d(last.jitter, first.jitter, 2, '%') ? `Jitter ${d(last.jitter, first.jitter, 2, '%')}` : null,
    d(last.hnr, first.hnr, 1, ' dB') ? `HNR ${d(last.hnr, first.hnr, 1, ' dB')}` : null,
    d(last.gap, first.gap, 0, ' Hz') ? `F2−F1 ${d(last.gap, first.gap, 0, ' Hz')}` : null,
    d(last.mpt, first.mpt, 1, ' s') ? `MPT ${d(last.mpt, first.mpt, 1, ' s')}` : null,
    d(last.breathiness, first.breathiness, 2) ? `气声 ${d(last.breathiness, first.breathiness, 2)}` : null,
    d(last.nasality, first.nasality, 1, ' dB') ? `鼻化 ${d(last.nasality, first.nasality, 1, ' dB')}` : null,
  ].filter((p): p is string => p != null);
  return parts.length ? `- 趋势（首周 → 末周，按周均）：${parts.join('；')}` : null;
}

/** 最佳 / 最弱周：优先靶标达成率，未启用或缺少数据时按 CPPS */
function bestWorstLine(
  weeks: { ts: number; agg: Aggregate }[],
  targetEnabled: boolean,
): string | null {
  if (weeks.length < 2) return null;
  const useTarget = targetEnabled && weeks.some((w) => w.agg.targetPct != null);
  const key = (w: { agg: Aggregate }) => useTarget ? w.agg.targetPct : w.agg.cpps;
  const withValue = weeks.filter((w) => key(w) != null);
  if (withValue.length < 2) return null;
  const sorted = [...withValue].sort((a, b) => (key(b) ?? 0) - (key(a) ?? 0));
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  const fmt = (w: { ts: number; agg: Aggregate }) => {
    const v = key(w);
    const unit = useTarget ? '%' : ' dB';
    return `${shortWeek(w.ts)} ${v?.toFixed(useTarget ? 0 : 1)}${unit}`;
  };
  return `- 最佳 / 最弱周（按${useTarget ? '靶标达成率' : 'CPPS'}）：最佳 ${fmt(best)}；最弱 ${fmt(worst)}`;
}

/** 历史聚合：整体、按模式、按周、趋势、最佳/最弱周 */
export function buildAggregateSection(
  records: AnalysisRecord[],
  sustained: Map<string, SustainedMetrics | null>,
  maxWeeks = MAX_WEEKS,
  targetEnabled = true,
): string {
  if (records.length === 0) return '';
  const sorted = [...records].sort((a, b) => a.createdAt - b.createdAt);
  const overall = aggregateOf(sorted, sustained);
  const first = localDate(sorted[0].createdAt);
  const last = localDate(sorted[sorted.length - 1].createdAt);
  const totalMin = (sorted.reduce((n, r) => n + r.durationSec, 0) / 60).toFixed(1);

  const lines = [
    `## 历史聚合（共 ${overall.count} 条，覆盖 ${overall.days} 天，${first} ~ ${last}，总时长 ${totalMin} 分钟）`,
    '按模式：',
  ];

  const byMode = new Map<TestMode | 'free', AnalysisRecord[]>();
  for (const rec of sorted) {
    const mode = modeOf(rec);
    const list = byMode.get(mode) ?? [];
    list.push(rec);
    byMode.set(mode, list);
  }
  for (const mode of MODE_ORDER) {
    const list = byMode.get(mode);
    if (!list?.length) continue;
    const agg = aggregateOf(list, sustained);
    lines.push(`- ${MODE_LABELS[mode]}：${agg.count} 条 / ${agg.days} 天 | ${metricParts(agg).join(' | ')}`);
  }

  const byWeek = new Map<number, AnalysisRecord[]>();
  for (const rec of sorted) {
    const key = weekStartLocal(rec.createdAt);
    const list = byWeek.get(key) ?? [];
    list.push(rec);
    byWeek.set(key, list);
  }
  const weeks = [...byWeek.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(-maxWeeks)
    .map(([ts, list]) => ({ ts, agg: aggregateOf(list, sustained) }));

  if (weeks.length) {
    lines.push(`按周（最近 ${weeks.length} 周）：`);
    for (const w of weeks) {
      const a = w.agg;
      const parts = [
        `${a.count} 条 / ${a.days} 天`,
        a.avgF0 != null ? `avgF0 ${num(a.avgF0)}Hz` : null,
        a.p10 != null && a.p90 != null ? `P10–P90 ${num(a.p10, 0)}–${num(a.p90, 0)}Hz` : null,
        a.targetPct != null ? `靶标 ${num(a.targetPct, 0)}%` : null,
        a.cpps != null ? `CPPS ${num(a.cpps)}dB` : null,
        a.jitter != null ? `Jitter ${num(a.jitter, 2)}%` : null,
        a.hnr != null ? `HNR ${num(a.hnr)}dB` : null,
        a.gap != null ? `F2−F1 ${num(a.gap, 0)}Hz` : null,
        a.mpt != null ? `MPT ${num(a.mpt)}s` : null,
      ].filter((p): p is string => p != null);
      lines.push(`- ${shortWeek(w.ts)}：${parts.join(' | ')}`);
    }
    const trend = trendLine(weeks);
    if (trend) lines.push(trend);
    const bestWorst = bestWorstLine(weeks, targetEnabled);
    if (bestWorst) lines.push(bestWorst);
  }

  return lines.join('\n');
}

/** 钉选基线：最新记录 − 基线，复用建议卡的 Δ 口径 */
export function buildBaselineSection(
  records: AnalysisRecord[],
  baselineId: string | undefined,
): string {
  if (!baselineId) return '';
  const baseline = records.find((r) => r.id === baselineId);
  if (!baseline) return '';
  const candidates = records
    .filter((r) => r.id !== baselineId)
    .sort((a, b) => b.createdAt - a.createdAt);
  if (!candidates.length) {
    return `## 钉选基线\n- 基线记录：${baseline.id}（${localDateTime(baseline.createdAt)}），目前还没有可对比的新记录。`;
  }
  const current = candidates[0];
  const modeNote = modeOf(current) !== modeOf(baseline)
    ? '\n- 注意：当前记录与基线模式不同，Δ 仅供参考。'
    : '';
  return [
    '## 钉选基线对比（最新记录 − 基线）',
    `- 当前记录：${current.id}（${localDateTime(current.createdAt)}，${MODE_LABELS[modeOf(current)]}）`,
    `- 基线记录：${baseline.id}（${localDateTime(baseline.createdAt)}，${MODE_LABELS[modeOf(baseline)]}）${modeNote}`,
    baselinePayload(current, baseline),
  ].join('\n');
}

/** 单条记录明细（含图表 id、嗓音质量、持续发声与环境字段） */
export function formatRecordLine(
  rec: AnalysisRecord,
  sustained: SustainedMetrics | null = sustainedOf(rec),
): string {
  const s = rec.stats;
  const gap = f2f1Gap(s);
  const parts = [
    `id ${rec.id}`,
    localDateTime(rec.createdAt),
    MODE_LABELS[modeOf(rec)],
    `${Math.round(rec.durationSec)}s`,
    `avgF0 ${num(s.avgF0)}Hz`,
    `P10–P90 ${num(s.p10F0, 0)}–${num(s.p90F0, 0)}Hz`,
    `min–max ${num(s.minF0, 0)}–${num(s.maxF0, 0)}Hz`,
    `音域宽 ${num(s.p90F0 - s.p10F0, 0)}Hz`,
    s.avgF1 != null ? `F1 ${num(s.avgF1, 0)}` : null,
    s.avgF2 != null ? `F2 ${num(s.avgF2, 0)}` : null,
    gap != null ? `F2−F1 ${num(gap, 0)}Hz` : null,
    s.inTargetPct != null ? `靶标 ${num(s.inTargetPct, 0)}%` : null,
    s.jitterPct != null ? `Jitter ${num(s.jitterPct, 2)}%` : null,
    s.shimmerPct != null ? `Shimmer ${num(s.shimmerPct, 2)}%` : null,
    s.hnrDb != null ? `HNR ${num(s.hnrDb)}dB` : null,
    s.cppsDb != null ? `CPPS ${num(s.cppsDb)}dB` : null,
    s.h1h2Db != null ? `H1–H2 ${num(s.h1h2Db)}dB` : null,
    s.h2h4Db != null ? `H2–H4 ${num(s.h2h4Db)}dB` : null,
    s.h1a3Db != null ? `H1–A3 ${num(s.h1a3Db)}dB` : null,
    s.breathiness != null ? `气声 ${num(s.breathiness, 2)}` : null,
    s.nasalityDb != null ? `鼻化 ${num(s.nasalityDb)}dB` : null,
    s.spectralTiltDbOct != null ? `谱倾斜 ${num(s.spectralTiltDbOct, 1)}dB/oct` : null,
    sustained ? `MPT ${num(sustained.mptSec)}s` : null,
    sustained?.decayDbPerSec != null ? `衰减 ${num(sustained.decayDbPerSec, 2)}dB/s` : null,
    `响度 ${num(s.avgDb)}/${num(s.peakDb)}dB`,
    s.malePct != null ? `男/女/过渡 ${num(s.malePct, 0)}/${num(s.femalePct, 0)}/${num(s.transitionPct, 0)}%` : null,
    rec.note ? `备注「${oneLine(rec.note)}」` : null,
    rec.env?.noiseFloorDb != null ? `底噪 ${num(rec.env.noiseFloorDb)}dB` : null,
    rec.env?.hourOfDay != null ? `${rec.env.hourOfDay}时` : null,
    rec.env?.micLabel ? `麦克风「${oneLine(rec.env.micLabel, 40)}」` : null,
    rec.env?.inputGainDb != null ? `增益 +${num(rec.env.inputGainDb)}dB` : null,
  ];
  return `- ${parts.filter((p): p is string => p != null).join(' | ')}`;
}

/** 最近记录明细：按 token 预算从最新往回装，保留 record:// 所需的 id */
export function buildRawSection(
  records: AnalysisRecord[],
  sustained: Map<string, SustainedMetrics | null>,
  budgetTokens: number,
): string {
  if (records.length === 0 || budgetTokens <= 0) return '';
  const sorted = [...records].sort((a, b) => a.createdAt - b.createdAt);
  const kept: string[] = [];
  let used = 0;
  for (let i = sorted.length - 1; i >= 0 && kept.length < MAX_RAW_RECORDS; i -= 1) {
    const rec = sorted[i];
    const line = formatRecordLine(rec, sustained.get(rec.id) ?? null);
    const cost = estimateTokens(line) + 2;
    if (used + cost > budgetTokens) break;
    used += cost;
    kept.unshift(line);
  }
  if (!kept.length) return '';
  const omitted = sorted.length - kept.length;
  const header = `## 最近记录明细（共 ${sorted.length} 条${omitted > 0 ? `，以下为最近 ${kept.length} 条，其余见上方聚合` : ''}，时间从旧到新）`;
  return `${header}\n${kept.join('\n')}`;
}

/** 当前会话固定记录：/attach 指定的记录优先完整展示，按预算从最新开始装入 */
export function buildPinnedSection(
  records: AnalysisRecord[],
  pinnedIds: string[],
  sustained: Map<string, SustainedMetrics | null>,
  budgetTokens = Number.POSITIVE_INFINITY,
): string {
  if (!pinnedIds.length) return '';
  const byId = new Map(records.map((r) => [r.id, r]));
  const pinned = pinnedIds
    .map((id) => byId.get(id))
    .filter((r): r is AnalysisRecord => r != null)
    .sort((a, b) => b.createdAt - a.createdAt);
  if (!pinned.length) return '';

  const lines: string[] = [];
  let used = 0;
  for (const rec of pinned) {
    const line = formatRecordLine(rec, sustained.get(rec.id) ?? null);
    const cost = estimateTokens(line) + 2;
    if (used + cost > budgetTokens) break;
    used += cost;
    lines.push(line);
  }
  if (!lines.length) return '';
  const omitted = pinned.length - lines.length;
  return `## 当前会话固定记录（用户通过 /attach 指定，共 ${pinned.length} 条${omitted > 0 ? `，以下为最近 ${lines.length} 条` : ''}）\n${lines.join('\n')}`;
}

/**
 * 组装助手上下文。预算只约束历史部分，画像始终保留。
 * 顺序：画像（由调用方放系统提示）→ 固定记录 → 聚合 → 基线 → 最近明细。
 */
export function buildAssistantContext(
  records: AnalysisRecord[],
  settings: AssistantContextSettings,
  budgetTokens: number,
  pinnedIds: string[] = [],
): AssistantContext {
  const profile = buildAssistantProfile(settings);
  if (records.length === 0) return { profile, history: '' };

  const sustained = new Map<string, SustainedMetrics | null>(
    records.map((r) => [r.id, sustainedOf(r)]),
  );
  let remaining = budgetTokens - estimateTokens(profile);
  if (remaining <= 40) return { profile, history: '' };

  const parts: string[] = [];
  const pinned = buildPinnedSection(
    records,
    pinnedIds,
    sustained,
    Math.max(120, remaining * 0.6),
  );
  if (pinned) {
    const cost = estimateTokens(pinned);
    parts.push(pinned);
    remaining -= cost;
  }

  // 聚合优先：预算紧时逐步减少周数，至少保留整体与按模式汇总
  let agg = '';
  for (let weeks = MAX_WEEKS; weeks >= 0; weeks -= 2) {
    agg = buildAggregateSection(records, sustained, weeks, settings.targetEnabled);
    if (estimateTokens(agg) <= remaining * 0.6 || weeks === 0) break;
  }
  if (agg) {
    parts.push(agg);
    remaining -= estimateTokens(agg);
  }

  const baseline = buildBaselineSection(records, settings.baselineRecordId);
  if (baseline && estimateTokens(baseline) <= Math.max(80, remaining * 0.35)) {
    parts.push(baseline);
    remaining -= estimateTokens(baseline);
  }

  if (remaining > 60) {
    const raw = buildRawSection(records, sustained, remaining);
    if (raw) parts.push(raw);
  }

  return { profile, history: parts.join('\n\n') };
}
