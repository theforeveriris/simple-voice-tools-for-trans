/**
 * 大模型训练建议与周报（业务层）
 * 提示词（分析标准 / 用户画像）、数据载荷组装、结构化结果解析，
 * 以及调用入口 fetchLlmAdvice / fetchWeeklyReport。请求层见 llmClient.ts，
 * 缓存见 llmCache.ts（公共入口 re-export 见 llm.ts）。
 */

import type { AgeGroup, AnalysisRecord, UserGoal } from '@/types';
import type { AdviceTarget } from '@/lib/advice';
import { computeSustainedMetrics } from '@/lib/audio/sustained';
import { LOCALES, getAiLocaleLabel, getLocale } from '@/i18n';
import type { LlmConfig } from './llmClient';
import { llmChatStream } from './llmClient';

/** 要求模型以当前界面语言回答（AI 语言用其语言名；AI 助手复用） */
export function languageName(): string {
  return LOCALES.find((l) => l.id === getLocale())?.label
    ?? getAiLocaleLabel()
    ?? '简体中文';
}

/** 单维度评估结论 */
export interface AdviceAssessment {
  aspect: string;
  status: 'good' | 'fair' | 'attention';
  comment: string;
}

/** 大模型建议的结构化结果（模型输出异常时可能只有 advice 兜底行） */
export interface LlmAdviceResult {
  summary: string | null;
  assessments: AdviceAssessment[];
  advice: string[];
}

/* ------------------------------ 分析标准（提示词） ------------------------------ */

const SYSTEM_PROMPT = [
  'You are the training advisor inside "Simple Voice Tool for Trans", a voice-tracking app built for',
  'transgender voice training (feminization / masculinization) and general voice health.',
  'It measures pitch (YIN), formants (LPC), loudness (dBFS, uncalibrated), voice quality',
  '(Jitter / Shimmer / HNR estimate / CPPS) and sustained phonation (MPT / pitch CV / decay).',
  'The user message contains the statistics of one recording — or two recordings (A, B) to',
  'compare — plus, when the user pinned a baseline, its deltas. Analyze strictly by the',
  'standard below, then give advice.',
  '',
  '## First lens: gender-affirming training',
  'The user is almost certainly training their voice toward a gender goal. Infer the direction',
  'from the data: a target range in the female band or high female-band time share means',
  'feminization (MtF); the reverse means masculinization (FtM); no target means judge both',
  'directions. Read every dimension through that goal:',
  '- Perceptual passability pivots around conversational avg F0 of roughly 155-165 Hz; a',
  '  common MtF stage goal is 165-220 Hz. Prioritize the MEDIAN over the mean: median below',
  '  mean means a few high frames lift the average while typical pitch sits lower (the classic',
  '  "rises in practice, drops in conversation" signature).',
  '- Pitch stability gates progress: before advising to raise the target, CV must be stable at',
  '  the current pitch. P10 is the MtF trouble spot (sentence-end drop, "breaking" back down);',
  '  P90 too low = flat, lifeless prosody. Bandwidth < 30 Hz sounds robotic even in range.',
  '- Resonance outranks pitch: F0 is physiologically capped, formants are not. F1 tracks jaw',
  '  opening (vowel "a": male 700-800 Hz, female 850-1100 Hz); F2 tracks tongue frontness',
  '  (vowel "i": male 1900-2300 Hz, female 2600-2900 Hz — the largest gender gap). If F0 is on',
  '  target but formants lag, say so: pitch alone does not pass.',
  '- The breathiness trap: airy voice can mask pitch but HNR stays low and it strains the',
  '  larynx long-term — advise resonance work over breathy voice.',
  '- FtM: do not advise pressing the larynx down for depth; aim for stable, relaxed low pitch',
  '  with clean closure instead.',
  '- Band percentages reflect user-tuned boundaries, not universal ones.',
  '',
  '## Analysis standard (apply in this order)',
  '1. Data validity gate. If framesTotal < 30, or voicedPct < 35%, or avgDb < -35 dB or',
  '   > -10 dB, or peakDb > -3 dB (clipping), point it out and treat other numbers with',
  '   caution. Expected voicedPct: reading > 60%, sustained > 95%.',
  '2. Pitch vs the affirmed goal (see first lens). If a target range is given, judge',
  '   inTargetPct: < 20% the target is too ambitious (suggest lowering it), > 90% suggest',
  '   raising it.',
  '3. Intonation vs stability. Reading: stdF0 around 15-35 Hz is natural intonation; < 10 Hz',
  '   is pressed flat, > 45 Hz is uncontrolled. Sustained: cvPct should be near 0% and',
  '   decayDbPerSec near 0; interpret MPT together with decay (long MPT + large decay =',
  '   endurance problem, not capacity).',
  '4. Resonance (formants) — for trans training this is the highest-leverage dimension.',
  '   f1Range span 200-500 Hz and f2Range span 500-1500 Hz are normal for reading; clearly',
  '   narrower = monotonous articulation.',
  '5. Voice quality is a health monitor, not a training goal; single-session spikes are',
  '   meaningless — judge by baseline trend. Jitter < 1% (capped 5%); Shimmer < 4-5%',
  '   (capped 15%); HNR > 20 dB (estimate); CPPS roughly 10-20 dB with no absolute threshold.',
  '   Combos: only Jitter up = strained pitch (ease the target 5-10 Hz); Shimmer up + HNR',
  '   down = leaky/breathy closure (breath support); all four worse = overuse (rest, and if',
  '   Jitter stays > 2-3% after rest suggest an ENT check).',
  '6. Sustained phonation. MPT 15-25 s is healthy; < 12 s short; < 10 s practice breath',
  '   support before anything else — high pitch + high resonance posture cost more air, so a',
  '   short MPT distorts every other metric.',
  '7. Baseline deltas (when given) are current minus baseline: comment on the direction of',
  '   change, never compare across different test modes.',
  '8. Comparing A/B: describe what changed and what it likely means, then advise what to',
  '   keep and what to adjust next.',
  '',
  '## Principles',
  '- Use only the numbers given; never invent measurements. null means not measured — skip',
  '  it silently. Loudness is uncalibrated dBFS, so only self-comparison is meaningful.',
  '- Advice: 2-4 items, concrete and actionable, each one sentence, tied to the numbers, and',
  '  put the gender-affirming priority first (resonance/stability before absolute pitch).',
  '  If everything is within range, say so and encourage.',
  '- These are self-tracking reference ranges, not medical advice; do not diagnose.',
  '',
  '## Output',
  `Respond ONLY with JSON, written in ${languageName()}:`,
  '{"summary": "1-2 sentence overall assessment",',
  ' "assessments": [{"aspect": "dimension name", "status": "good|fair|attention",',
  '                 "comment": "one sentence citing the numbers"}],',
  ' "advice": ["...", "..."]}',
  'Give 4-6 assessments covering the dimensions that matter for this recording; skip',
  'dimensions whose data is missing.',
].join('\n');

/**
 * 组装 system prompt：默认用内置分析标准并把补充规则追加在末尾（冲突时以规则为准）；
 * 用户整体覆写时完全使用覆写内容
 */
/* ------------------------------ 数据载荷 ------------------------------ */

/** 本地时间戳（YYYY-MM-DD [HH:mm]）：模型侧的时间口径与界面其余部分一致（UTC 会让晨/晚判断失真） */
function localStamp(ms: number, withTime: boolean): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return withTime ? `${date} ${p(d.getHours())}:${p(d.getMinutes())}` : date;
}

/** 单条记录的全部统计指标（键值行；口径与文档一致，含派生量） */
function recordPayload(rec: AnalysisRecord, target: AdviceTarget): string {
  const s = rec.stats;
  const voicedPct = s.totalSamples > 0 ? (s.voicedSamples / s.totalSamples) * 100 : 0;
  const cvPct = s.medianF0 > 0 ? (s.stdF0 / s.medianF0) * 100 : null;
  const lines: (string | null)[] = [
    `date: ${localStamp(rec.createdAt, true)}`,
    `mode: ${rec.mode ?? 'unknown'}`,
    rec.note ? `note: ${rec.note}` : null,
    `durationSec: ${s.durationSec.toFixed(1)}`,
    `sampleHz: ${s.sampleHz.toFixed(0)}`,
    `framesTotal: ${s.totalSamples}`,
    `framesVoiced: ${s.voicedSamples} (${voicedPct.toFixed(0)}%)`,
    `avgF0: ${s.avgF0.toFixed(1)} Hz`,
    `medianF0: ${s.medianF0.toFixed(1)} Hz`,
    `minF0: ${s.minF0.toFixed(0)} Hz`,
    `maxF0: ${s.maxF0.toFixed(0)} Hz`,
    `p10F0: ${s.p10F0.toFixed(0)} Hz`,
    `p90F0: ${s.p90F0.toFixed(0)} Hz`,
    `p10P90bandwidth: ${(s.p90F0 - s.p10F0).toFixed(0)} Hz`,
    `stdF0: ${s.stdF0.toFixed(1)} Hz${cvPct != null ? ` (cv ${cvPct.toFixed(1)}%)` : ''}`,
    `bandPct male/female/transition: ${s.malePct.toFixed(0)}/${s.femalePct.toFixed(0)}/${s.transitionPct.toFixed(0)}%`,
    s.avgF1 != null ? `avgF1: ${s.avgF1.toFixed(0)} Hz` : null,
    s.avgF2 != null ? `avgF2: ${s.avgF2.toFixed(0)} Hz` : null,
    s.avgF1 != null && s.avgF2 != null && s.avgF2 > 0
      ? `f1F2ratio: ${(s.avgF1 / s.avgF2).toFixed(2)}`
      : null,
    s.f1Range ? `f1Range: ${s.f1Range[0].toFixed(0)}-${s.f1Range[1].toFixed(0)} Hz (span ${(s.f1Range[1] - s.f1Range[0]).toFixed(0)})` : null,
    s.f2Range ? `f2Range: ${s.f2Range[0].toFixed(0)}-${s.f2Range[1].toFixed(0)} Hz (span ${(s.f2Range[1] - s.f2Range[0]).toFixed(0)})` : null,
    `avgDb: ${s.avgDb.toFixed(1)} dB`,
    `peakDb: ${s.peakDb.toFixed(1)} dB`,
    s.jitterPct != null ? `jitterPct: ${s.jitterPct.toFixed(2)}%` : null,
    s.shimmerPct != null ? `shimmerPct: ${s.shimmerPct.toFixed(2)}%` : null,
    s.hnrDb != null ? `hnrDb: ${s.hnrDb.toFixed(1)} dB` : null,
    s.cppsDb != null ? `cppsDb: ${s.cppsDb.toFixed(1)} dB` : null,
    target.enabled ? `targetF0Range: ${target.min}-${target.max} Hz` : null,
    s.inTargetPct != null ? `inTargetPct: ${s.inTargetPct.toFixed(0)}%` : null,
  ];
  if (rec.mode === 'sustained') {
    const { mptSec, cvPct: sCv, decayDbPerSec } = computeSustainedMetrics(rec);
    lines.push(`mptSec: ${mptSec.toFixed(1)}`);
    if (sCv != null) lines.push(`sustainedCvPct: ${sCv.toFixed(1)}%`);
    if (decayDbPerSec != null) lines.push(`decayDbPerSec: ${decayDbPerSec.toFixed(2)}`);
  }
  return lines.filter((l): l is string => l != null).join('\n');
}

/** 基线 Δ（当前 − 基线；仅在用户钉选基线且与当前记录不同时提供） */
function baselinePayload(rec: AnalysisRecord, baseline: AnalysisRecord): string {
  const s = rec.stats;
  const b = baseline.stats;
  const d = (a: number | null | undefined, c: number | null | undefined, dg = 1) =>
    a != null && c != null ? `${a - c > 0 ? '+' : ''}${(a - c).toFixed(dg)}` : null;
  const lines: (string | null)[] = [
    `baselineDate: ${new Date(baseline.createdAt).toISOString().slice(0, 16).replace('T', ' ')}`,
    `baselineMode: ${baseline.mode ?? 'unknown'}`,
    `baselineAvgF0: ${b.avgF0.toFixed(1)} Hz`,
    baseline.note ? `baselineNote: ${baseline.note}` : null,
    `deltaAvgF0: ${d(s.avgF0, b.avgF0)} Hz`,
    `deltaMedianF0: ${d(s.medianF0, b.medianF0)} Hz`,
    `deltaP10F0: ${d(s.p10F0, b.p10F0, 0)} Hz`,
    `deltaP90F0: ${d(s.p90F0, b.p90F0, 0)} Hz`,
    `deltaStdF0: ${d(s.stdF0, b.stdF0)} Hz`,
    s.avgF1 != null && b.avgF1 != null ? `deltaAvgF1: ${d(s.avgF1, b.avgF1, 0)} Hz` : null,
    s.avgF2 != null && b.avgF2 != null ? `deltaAvgF2: ${d(s.avgF2, b.avgF2, 0)} Hz` : null,
    `deltaAvgDb: ${d(s.avgDb, b.avgDb)} dB`,
    s.jitterPct != null && b.jitterPct != null ? `deltaJitterPct: ${d(s.jitterPct, b.jitterPct, 2)}%` : null,
    s.shimmerPct != null && b.shimmerPct != null ? `deltaShimmerPct: ${d(s.shimmerPct, b.shimmerPct, 2)}%` : null,
    s.hnrDb != null && b.hnrDb != null ? `deltaHnrDb: ${d(s.hnrDb, b.hnrDb)} dB` : null,
    s.cppsDb != null && b.cppsDb != null ? `deltaCppsDb: ${d(s.cppsDb, b.cppsDb)} dB` : null,
  ];
  return lines.filter((l): l is string => l != null).join('\n');
}

/** 组装用户消息：单条记录 / 两条记录（A/B 对比）/ 可选基线 Δ */
function buildUserPrompt(
  records: AnalysisRecord[],
  target: AdviceTarget,
  baseline: AnalysisRecord | null,
  ctx?: LlmPromptOptions,
): string {
  const parts: string[] = [];
  if (records.length >= 2) {
    parts.push(
      'Two recordings from the same user are compared below (A and B; dates show which is '
      + 'earlier). Analyze the change between them, then advise:',
    );
    records.forEach((rec, i) => {
      parts.push(`--- Recording ${i === 0 ? 'A' : 'B'} ---`);
      parts.push(recordPayload(rec, target));
    });
  } else {
    parts.push('One voice recording from the user:');
    parts.push(recordPayload(records[0], target));
    if (baseline && baseline.id !== records[0].id) {
      parts.push('Pinned baseline (earlier recording; deltas = current − baseline; ignore if its mode differs):');
      parts.push(baselinePayload(records[0], baseline));
    }
  }
  if (ctx?.goal || ctx?.ageGroup) {
    const meta: string[] = [];
    if (ctx.goal) meta.push(`userGoal: ${ctx.goal}`);
    if (ctx.ageGroup) meta.push(`ageGroup: ${ctx.ageGroup}`);
    parts.push(`User context: ${meta.join(', ')}`);
  }
  parts.push(`Answer language: ${languageName()}`);
  return parts.join('\n');
}


/** 提示词定制：补充规则 / 整体覆写（来自 设置 → 实验性功能 → 提示词） */
export interface LlmPromptOptions {
  extraRules?: string[];
  promptOverride?: string;
  /** 用户训练方向（mtf / ftm / other），显式传给提示词取代从数据反推 */
  goal?: UserGoal;
  /** 用户年龄段，影响基频 / 共振峰参考范围口径 */
  ageGroup?: AgeGroup;
}

/**
 * 按用户训练方向 / 年龄段拼接一段「User profile」段落，
 * 追加在分析标准之后、用户规则之前；空上下文返回空串。
 * 取代了原先「靠数据反推 MtF / FtM」的口径。
 */
function userContextBlock(goal: UserGoal | undefined, ageGroup: AgeGroup | undefined): string {
  if (!goal && !ageGroup) return '';
  const lines = ['## User profile (explicit, do NOT re-derive from data)'];
  if (goal === 'mtf') {
    lines.push('- Training goal: feminization (MtF / transfeminine). Read every dimension through a female-affirming lens: target higher F0, female formants, lighter / larger resonance posture.');
  } else if (goal === 'ftm') {
    lines.push('- Training goal: masculinization (FtM / transmasculine). Read every dimension through a male-affirming lens: target lower F0, male formants, relaxed down-pitch posture; do NOT advise pressing the larynx down.');
  } else if (goal === 'other') {
    lines.push('- Training goal: unspecified / non-binary. Assess both feminization and masculinization directions and note which the data currently supports; do not assume one direction.');
  }
  if (ageGroup === 'child') {
    lines.push('- Age group: child (pre-pubescent). Reference pitch is higher (typical speaking F0 ~250-400 Hz). Do NOT flag typical child pitch as "high" or "out of range".');
  } else if (ageGroup === 'adolescent') {
    lines.push('- Age group: adolescent (puberty / voice change). Pitch is in transition and varies widely day-to-day; interpret ranges leniently.');
  } else if (ageGroup === 'adult') {
    lines.push('- Age group: adult.');
  } else if (ageGroup === 'senior') {
    lines.push('- Age group: senior. Reference pitch is lower; do NOT flag typical lower pitch as "low" or "out of range".');
  }
  return lines.join('\n');
}

/**
 * 组装 system prompt：默认用内置分析标准，把「User profile」段落在中间注入，
 * 末尾追加用户补充规则（冲突时以规则为准）；用户整体覆写时完全使用覆写内容
 */
export function buildSystemPrompt(base: string, prompt?: LlmPromptOptions): string {
  const override = prompt?.promptOverride?.trim();
  if (override) return override;
  const ctx = userContextBlock(prompt?.goal, prompt?.ageGroup);
  const parts = [base];
  if (ctx) parts.push(ctx);
  const rules = (prompt?.extraRules ?? []).map((r) => r.trim()).filter(Boolean);
  if (rules.length > 0) {
    parts.push(`## User rules (follow these too; on conflict they win)\n${rules
      .map((r, i) => `${i + 1}. ${r}`)
      .join('\n')}`);
  }
  return parts.join('\n\n');
}

export async function fetchLlmAdvice(
  records: AnalysisRecord[],
  target: AdviceTarget,
  cfg: LlmConfig,
  opts: {
    baseline?: AnalysisRecord | null;
    prompt?: LlmPromptOptions;
    signal?: AbortSignal;
    onDelta?: (accumulated: string) => void;
  } = {},
): Promise<LlmAdviceResult> {
  const { baseline = null, prompt, signal, onDelta } = opts;
  const content = await llmChatStream(
    cfg,
    buildSystemPrompt(SYSTEM_PROMPT, prompt),
    buildUserPrompt(records, target, baseline, prompt),
    { temperature: 0.4, signal, onDelta, feature: 'advice' },
  );
  return parseLlmAdviceResult(content);
}

const STATUS_VALUES = new Set(['good', 'fair', 'attention']);

/**
 * 解析模型回复：
 * 1) 取首个 {...} 作结构化结果（summary + assessments + advice，字段逐个校验，
 *    status 非法值归为 fair）；
 * 2) 仅含 advice 数组的旧格式同样接受；
 * 3) JSON 解析失败时按非空行兜底（去掉行首序号/项目符号）；
 * 4) 什么都取不到则抛错。
 */
export function parseLlmAdviceResult(content: string): LlmAdviceResult {
  const m = content.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const obj = JSON.parse(m[0]) as Record<string, unknown>;
      const result = structuredResult(obj);
      if (result) return result;
    } catch {
      /* 落到行拆分兜底 */
    }
  }
  const lines = fallbackLines(content);
  if (lines.length > 0) return { summary: null, assessments: [], advice: lines };
  throw new Error('No advice in response');
}

/** 从已解析的 JSON 对象提取结构化结果；完全无有效字段时返回 null */
function structuredResult(obj: Record<string, unknown>): LlmAdviceResult | null {
  const advice = strArr(obj.advice).slice(0, 4);
  const summary = typeof obj.summary === 'string' && obj.summary.trim() ? obj.summary.trim() : null;
  const assessments: AdviceAssessment[] = [];
  if (Array.isArray(obj.assessments)) {
    for (const raw of obj.assessments) {
      if (typeof raw !== 'object' || raw == null) continue;
      const o = raw as Record<string, unknown>;
      const aspect = typeof o.aspect === 'string' ? o.aspect.trim() : '';
      const comment = typeof o.comment === 'string' ? o.comment.trim() : '';
      if (!aspect || !comment) continue;
      const status = typeof o.status === 'string' && STATUS_VALUES.has(o.status)
        ? (o.status as AdviceAssessment['status'])
        : 'fair';
      assessments.push({ aspect, status, comment });
    }
  }
  if (!summary && assessments.length === 0 && advice.length === 0) return null;
  return { summary, assessments: assessments.slice(0, 6), advice };
}

/** 兜底：按非空行拆分为建议列表（跳过疑似 JSON 的行） */
function fallbackLines(content: string): string[] {
  return content
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
    .filter((l) => l.length > 0 && l.length <= 200 && !l.startsWith('{'))
    .slice(0, 4);
}

function strArr(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim())
    : [];
}

/* ------------------------------ AI 周报 ------------------------------ */

const WEEKLY_PROMPT = [
  'You are the weekly review writer inside "Simple Voice Tool for Trans", a voice-tracking app for',
  'transgender voice training (feminization / masculinization) and general voice health.',
  'The user message aggregates the LAST 7 DAYS of recordings, grouped per test mode — modes',
  'are never cross-compared. Write the weekly review strictly by this standard:',
  '1. Consistency first: practice days / 7, recording count, total minutes. Frequency is the',
  '   biggest variable — acknowledge it honestly, without scolding.',
  '2. Pitch trend vs the affirmed goal (median over mean; P10 position is the classic trouble',
  '   spot; inTargetPct < 20% = target too ambitious, > 90% = time to raise it).',
  '3. Resonance before pitch: F1/F2 week means and spans; formant progress outranks pitch.',
  '4. Health monitor: Jitter / Shimmer / HNR / CPPS week means; single-day spikes are noise —',
  '   only the trend matters. All four worse together = overuse (rest first). Jitter staying',
  '   > 2-3% after rest → suggest an ENT check.',
  '5. Sustained (when present): MPT / cvPct / decay week means.',
  '6. Comparisons are only valid within the same mode and same device/environment; "first →',
  '   last" deltas inside the week are trend hints, not verdicts.',
  '- Use only the numbers given; skip missing (null) values silently.',
  '- Tone: encouraging but honest; call out overtraining when the quality combo says so.',
  `Respond ONLY with JSON, written in ${languageName()}:`,
  '{"summary": "3-5 sentences covering consistency, pitch vs goal, resonance, health",',
  ' "assessments": [{"aspect": "dimension name", "status": "good|fair|attention",',
  '                 "comment": "one sentence citing the numbers"}],',
  ' "advice": ["2-4 concrete items for next week"]}',
  'Give 3-5 assessments.',
].join('\n');

const DAY_MS = 86_400_000;

/** 最近 7 天的记录（含今天，按时间升序） */
export function weekRecords(records: AnalysisRecord[], now = Date.now()): AnalysisRecord[] {
  const start = now - 7 * DAY_MS;
  return records
    .filter((r) => r.createdAt >= start && r.createdAt <= now)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** 数值均值（跳过 null/undefined），无有效值返回 null */
function mean(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter((x): x is number => x != null && isFinite(x));
  return v.length > 0 ? v.reduce((a, b) => a + b, 0) / v.length : null;
}


/** 单一模式一周聚合（均值 + 首末对比给趋势信号）；该模式无记录返回 null */
function modePayload(records: AnalysisRecord[], mode: AnalysisRecord['mode']): string | null {
  const rs = records.filter((r) => r.mode === mode);
  if (rs.length === 0) return null;
  const st = rs.map((r) => r.stats);
  const first = rs[0].stats;
  const last = rs[rs.length - 1].stats;
  const durMin = rs.reduce((a, r) => a + r.stats.durationSec, 0) / 60;
  const lines: string[] = [
    `mode: ${mode ?? 'unknown'} | recordings: ${rs.length} | totalMin: ${durMin.toFixed(1)}`,
  ];
  const push = (label: string, m: number | null, unit: string, firstV?: number, lastV?: number, dg = 1) => {
    if (m == null) return;
    const trend = firstV != null && lastV != null ? ` (first ${firstV.toFixed(dg)} -> last ${lastV.toFixed(dg)})` : '';
    lines.push(`${label}: mean ${m.toFixed(dg)}${unit}${trend}`);
  };
  push('avgF0', mean(st.map((x) => x.avgF0)), ' Hz', first.avgF0, last.avgF0);
  push('medianF0', mean(st.map((x) => x.medianF0)), ' Hz', first.medianF0, last.medianF0);
  push('p10F0', mean(st.map((x) => x.p10F0)), ' Hz', first.p10F0, last.p10F0, 0);
  push('p90F0', mean(st.map((x) => x.p90F0)), ' Hz', first.p90F0, last.p90F0, 0);
  push('stdF0', mean(st.map((x) => x.stdF0)), ' Hz', first.stdF0, last.stdF0);
  push('avgF1', mean(st.map((x) => x.avgF1)), ' Hz', first.avgF1 ?? undefined, last.avgF1 ?? undefined, 0);
  push('avgF2', mean(st.map((x) => x.avgF2)), ' Hz', first.avgF2 ?? undefined, last.avgF2 ?? undefined, 0);
  push('avgDb', mean(st.map((x) => x.avgDb)), ' dB', first.avgDb, last.avgDb);
  push('jitterPct', mean(st.map((x) => x.jitterPct)), '%', first.jitterPct ?? undefined, last.jitterPct ?? undefined, 2);
  push('shimmerPct', mean(st.map((x) => x.shimmerPct)), '%', first.shimmerPct ?? undefined, last.shimmerPct ?? undefined, 2);
  push('hnrDb', mean(st.map((x) => x.hnrDb)), ' dB', first.hnrDb ?? undefined, last.hnrDb ?? undefined);
  push('cppsDb', mean(st.map((x) => x.cppsDb)), ' dB', first.cppsDb ?? undefined, last.cppsDb ?? undefined);
  push('inTargetPct', mean(st.map((x) => x.inTargetPct)), '%', first.inTargetPct ?? undefined, last.inTargetPct ?? undefined, 0);
  return lines.join('\n');
}

/** 组装周报用户消息；7 天内无记录返回 null（调用方提示先去录音） */
export function buildWeeklyPayload(records: AnalysisRecord[], now = Date.now(), ctx?: LlmPromptOptions): string | null {
  const week = weekRecords(records, now);
  if (week.length === 0) return null;
  const start = localStamp(week[0].createdAt, false);
  const end = localStamp(now, false);
  const days = new Set(week.map((r) => new Date(r.createdAt).toDateString())).size;
  const totalMin = (week.reduce((a, r) => a + r.stats.durationSec, 0) / 60).toFixed(1);
  const parts = [
    `Week range: ${start} ~ ${end}`,
    `practiceDays: ${days} / 7 | recordings: ${week.length} | totalMin: ${totalMin}`,
  ];
  for (const mode of ['reading', 'sustained', 'glide'] as const) {
    const m = modePayload(week, mode);
    if (m) parts.push(`--- ${m}`);
  }
  if (ctx?.goal || ctx?.ageGroup) {
    const meta: string[] = [];
    if (ctx.goal) meta.push(`userGoal: ${ctx.goal}`);
    if (ctx.ageGroup) meta.push(`ageGroup: ${ctx.ageGroup}`);
    parts.push(`User context: ${meta.join(', ')}`);
  }
  parts.push(`Answer language: ${languageName()}`);
  return parts.join('\n');
}

/** 调用接口生成周报；失败抛出含可读原因的 Error，由调用方展示 */
export async function fetchWeeklyReport(
  records: AnalysisRecord[],
  cfg: LlmConfig,
  opts: { prompt?: LlmPromptOptions; signal?: AbortSignal; onDelta?: (accumulated: string) => void } = {},
): Promise<LlmAdviceResult> {
  const { prompt, signal, onDelta } = opts;
  const payload = buildWeeklyPayload(records, Date.now(), prompt);
  if (payload == null) throw new Error('No records in the last 7 days');
  const content = await llmChatStream(
    cfg,
    buildSystemPrompt(WEEKLY_PROMPT, prompt),
    payload,
    { temperature: 0.4, signal, onDelta, feature: 'weekly' },
  );
  return parseLlmAdviceResult(content);
}
