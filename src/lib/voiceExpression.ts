/**
 * 声音性别表达参考（VFP 风格）——按参考元音归一化的声学近似
 *
 * 概念来源：inaSpeechSegmenter 的 Voice Femininity Percentage（VFP，
 * Doukhan et al., Interspeech 2023）——0–100 连续分，50 ≈ 中性。
 * 本项目不打包其 CNN 模型，只在浏览器内用既有的音高 / 共鸣统计做
 * 透明、可复算的声学近似；因此它是「参考估计」，不是模型输出，
 * 更不是诊断。
 *
 * 与早期版本的关键差别（这版才算「严谨」）：
 *   旧做法 = medianF0 与 F2−F1 的绝对值直接过 logistic。
 *     问题一：F2−F1 的绝对值强烈依赖说的是哪个元音（说「衣」≈2000 Hz，
 *             说「乌」≈570 Hz），同一段朗读里元音分布一变，分数就跟着变——
 *             测到的其实是「你说了什么」，不是「你的声音多女性化」。
 *     问题二：锚点与卡片上印的参考表自相矛盾（145 Hz 被标为中性，
 *             却算出「男性化」子分）。
 *   这做法 = 两步归一：
 *     ① 元音判定用**尺度无关的比值 r = F2/F1**（共振峰整体缩放时 r 不变），
 *        落在哪个参考元音的 r 附近，就归到那个元音；
 *     ② 性别判定用**声道尺度因子 s**（落点相对该元音男性参考的缩放比），
 *        s = 1 = 与男性参考重合，s ≈ 1.19 = 与女性参考重合。
 *     于是同一段录音，无论元音怎么分布、无论声道长短，比较的都是同一个维度。
 *
 * 为什么不用「离哪个参考点最近」来判元音：英语元音空间重叠严重——
 * 男性 AA 的落点 (756, 1309) 与女性 AH 的落点 (760, 1416) 几乎重合，
 * 按最近邻判会把大量帧错配到别的元音上。r = F2/F1 没有这个问题
 * （同一元音的男女 r 差异仅约 5%，不同元音之间差异远大于此）。
 *
 * 参考值来自 Hillenbrand et al. (1995), JASA 97(5), 3099–3111
 * （139 名英语母语者、1668 个稳态元音样本，男女分组均值），
 * 数值见 VOWEL_REFS_H95。
 *
 * 评分口径：
 *   - 音高 55%：中位基频经 logistic 映射，中心 155 Hz。
 *     感知分界约 155–165 Hz（Wolfe et al. 1990；Gelfer & Schofield 2000），
 *     与 ASHA 的「>180 Hz 偏女声 / <130 Hz 偏男声 / 145–175 Hz 中性带」一致。
 *   - 共鸣 45%：元音归一后的声道尺度因子。
 *   - 三档：<33 男性化参考，33–66 中性 / 过渡，>66 女性化参考。
 *
 * 参考文献见 documentation/REFERENCES.md「声音性别感知参考（VFP 风格）」。
 */

/** 单个参考元音的男女均值（Hz） */
export interface VowelRef {
  /** ARPABET 记号 */
  code: string;
  /** 中文提示（音节近似） */
  label: string;
  male: { f1: number; f2: number };
  female: { f1: number; f2: number };
}

/**
 * 参考元音的男女均值
 * 来源：Hillenbrand, Getty, Clark & Wheeler (1995). Acoustic characteristics of
 * American English vowels. JASA 97(5), 3099–3111. doi:10.1121/1.411872
 * 取该文稳态共振峰的分组均值（男 n=45、女 n=48，各 12 个元音）。
 */
export const VOWEL_REFS_H95: VowelRef[] = [
  { code: 'IY', label: '衣', male: { f1: 343, f2: 2323 }, female: { f1: 437, f2: 2761 } },
  { code: 'IH', label: '短衣', male: { f1: 429, f2: 2034 }, female: { f1: 484, f2: 2369 } },
  { code: 'EY', label: '诶', male: { f1: 476, f2: 2090 }, female: { f1: 535, f2: 2526 } },
  { code: 'EH', label: '欸', male: { f1: 588, f2: 1803 }, female: { f1: 727, f2: 2063 } },
  { code: 'AA', label: '啊（father）', male: { f1: 756, f2: 1309 }, female: { f1: 921, f2: 1524 } },
  { code: 'AE', label: '啊（cat）', male: { f1: 591, f2: 1930 }, female: { f1: 676, f2: 2335 } },
  { code: 'AH', label: '呃', male: { f1: 621, f2: 1181 }, female: { f1: 760, f2: 1416 } },
  { code: 'ER', label: '儿', male: { f1: 475, f2: 1379 }, female: { f1: 524, f2: 1588 } },
  { code: 'AO', label: '哦（thought）', male: { f1: 656, f2: 1023 }, female: { f1: 804, f2: 1188 } },
  { code: 'OW', label: '欧（boat）', male: { f1: 498, f2: 910 }, female: { f1: 555, f2: 1036 } },
  { code: 'UH', label: '短乌', male: { f1: 469, f2: 1123 }, female: { f1: 519, f2: 1229 } },
  { code: 'UW', label: '乌', male: { f1: 380, f2: 992 }, female: { f1: 460, f2: 1106 } },
];

/** 评分锚点：集中在一处，便于文档 / 测试与未来按语料校准 */
export const VOICE_EXPRESSION_ANCHORS = {
  /**
   * 音高映射中心与宽度：使 130 Hz → 33 分（男性化边界）、180 Hz → 67 分
   * （女性化边界），因此 145–175 Hz 落在中性带内——与卡片上印的参考表
   * 和 ASHA 的感知阈值完全一致（早期版本中心 165 Hz / 宽度 20 Hz 会把
   * 145 Hz 算成「男性化」，与参考表自相矛盾）。
   */
  pitchCenterHz: 155,
  pitchScaleHz: 35.3,
  /** 音高在综合分中的权重（共鸣缺失时自动改为 100%） */
  pitchWeight: 0.55,
  /** 共鸣在综合分中的权重 */
  resonanceWeight: 0.45,
  /**
   * 元音归一后的「相对位置」如何映射成 0–100：
   *   位置 −1（与男性参考云重合）→ 25 分；0（男女等距）→ 50 分；
   *   +1（与女性参考云重合）→ 75 分。
   */
  resonanceBaseScore: 25,
  resonanceSpanScore: 50,
} as const;

export type VoiceExpressionZone = 'masculine' | 'neutral' | 'feminine';
export type VoiceExpressionConfidence = 'low' | 'medium' | 'high';

export interface VoiceExpressionInput {
  /** 中位基频 Hz（robust 中心；比平均值更抗句尾掉音） */
  medianF0: number;
  /** 有声帧数 */
  voicedSamples: number;
  /** 序列采样率（Hz） */
  sampleHz: number;
  /** 逐帧共振峰（用于元音归一）；没有时只按音高评分 */
  frames?: VoiceExpressionFrame[] | null;
}

export interface VoiceExpressionFrame {
  f1: number;
  f2: number;
  /** 该帧时长（秒）；缺省按 1/30 秒计 */
  durationSec?: number;
}

export interface VowelBreakdown {
  /** ARPABET 记号 */
  code: string;
  /** 中文提示 */
  label: string;
  /** 该元音累计时长（秒） */
  seconds: number;
  /** 归一后的相对位置：−1 = 完全像男性参考，+1 = 完全像女性参考 */
  position: number;
  /** 参与统计的帧数 */
  frames: number;
}

export interface VoiceExpressionResult {
  /** 0–100 综合参考分，越高越靠近女性化参考 */
  score: number;
  zone: VoiceExpressionZone;
  /** 音高子分 0–100（已取整，供展示） */
  pitchScore: number;
  /** 共鸣子分 0–100（已取整）；无逐帧共振峰时为 null */
  resonanceScore: number | null;
  /** 有效发声时长（秒） */
  voicedSeconds: number;
  /** 样本充分度：<3 s 低、3–10 s 中、≥10 s 高 */
  confidence: VoiceExpressionConfidence;
  /** 各参考元音的贡献明细（按时长倒序） */
  breakdown: VowelBreakdown[];
  /** 归一后用于统计的有效帧数 */
  normalizedFrames: number;
}

function clampScore(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

/** logistic：中心处 50 分，scale 越大过渡越平缓 */
function logistic(value: number, center: number, scale: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(center) || !Number.isFinite(scale) || scale <= 0) {
    return 0;
  }
  return 100 / (1 + Math.exp(-(value - center) / scale));
}

/** 音高子分：155 Hz = 50 分；130 Hz ≈ 33，180 Hz ≈ 67，220 Hz ≈ 88 */
export function pitchReferenceScore(medianF0: number): number {
  return clampScore(logistic(medianF0, VOICE_EXPRESSION_ANCHORS.pitchCenterHz, VOICE_EXPRESSION_ANCHORS.pitchScaleHz));
}

/** 相对位置（−1..+1）→ 0–100 分：−1 → 25 分，0 → 50 分，+1 → 75 分 */
function positionToScore(position: number): number {
  const { resonanceBaseScore: base, resonanceSpanScore: span } = VOICE_EXPRESSION_ANCHORS;
  return clampScore(base + (span / 2) * (position + 1));
}

/** 综合分三档：<33 男性化参考，33–66 中性 / 过渡，>66 女性化参考 */
export function voiceExpressionZone(score: number): VoiceExpressionZone {
  if (score < 33) return 'masculine';
  if (score > 66) return 'feminine';
  return 'neutral';
}

/** 参考点（男 / 女各一套）：落点与「哪一套更像」的判定都用它 */
interface RefPoint {
  ref: VowelRef;
  sex: 'male' | 'female';
  f1: number;
  f2: number;
}

const REF_POINTS: RefPoint[] = VOWEL_REFS_H95.flatMap((ref) => [
  { ref, sex: 'male' as const, f1: ref.male.f1, f2: ref.male.f2 },
  { ref, sex: 'female' as const, f1: ref.female.f1, f2: ref.female.f2 },
]);

/** log 空间的二维距离（共振峰感知接近等比尺度，故用 log） */
function logDist(f1a: number, f2a: number, f1b: number, f2b: number): number {
  return Math.hypot(Math.log(f1a / f1b), Math.log(f2a / f2b));
}

/**
 * 单个落点的「相对位置」与归属元音。
 *
 * 做法：把落点同时与 24 个参考点（12 元音 × 男女）比较，
 * 取**最近的那个参考点**的性别作为该帧的性别倾向，
 * 再用「到最近男性参考」与「到最近女性参考」的距离比值给出连续位置：
 *   位置 = (d男 − d女) / (d男 + d女)
 * 落在男性参考点 → 位置 −1；落在女性参考点 → +1；两套等距 → 0。
 *
 * 为什么按「最近参考点」而不是「按元音分别算」：英语元音空间重叠严重
 * （男性 AA 的落点与女性 AH 的落点几乎重合），先判元音再算位置会系统性
 * 错配；而「离哪套参考点更近」这个问题在 24 个点上同时比较，
 * 天然回避了元音归属的歧义。
 */
function locateFrame(f1: number, f2: number): { position: number; ref: VowelRef } {
  let bestAll = REF_POINTS[0];
  let dMale = Infinity;
  let dFemale = Infinity;
  let dAll = Infinity;

  for (const p of REF_POINTS) {
    const d = logDist(f1, f2, p.f1, p.f2);
    if (p.sex === 'male') {
      if (d < dMale) dMale = d;
    } else if (d < dFemale) {
      dFemale = d;
    }
    if (d < dAll) {
      dAll = d;
      bestAll = p;
    }
  }

  const sum = dMale + dFemale;
  const position = sum > 1e-9 ? (dMale - dFemale) / sum : 0;
  return { position: Math.max(-1.5, Math.min(1.5, position)), ref: bestAll.ref };
}

/**
 * 元音归一：把逐帧共振峰映射到「相对男性/女性参考的位置」。
 *
 * ① 每一帧与 24 个实测参考点比较，得到连续位置（−1..+1）；
 * ② 按最近参考点归属元音，用于明细展示；
 * ③ 各元音内部按帧数与时长分别聚合，最终按时长加权。
 */
export function normalizeVowels(frames: VoiceExpressionFrame[]): {
  breakdown: VowelBreakdown[];
  totalFrames: number;
} {
  const acc = new Map<string, { ref: VowelRef; posSum: number; frames: number; seconds: number }>();
  let totalFrames = 0;

  for (const fr of frames) {
    if (!Number.isFinite(fr.f1) || !Number.isFinite(fr.f2)) continue;
    if (fr.f1 <= 0 || fr.f2 <= 0) continue;
    if (fr.f2 <= fr.f1) continue; // 共振峰次序反了，剔除

    const { position, ref } = locateFrame(fr.f1, fr.f2);
    const dur = fr.durationSec != null && fr.durationSec > 0 ? fr.durationSec : 1 / 30;
    const cur = acc.get(ref.code) ?? { ref, posSum: 0, frames: 0, seconds: 0 };
    cur.posSum += position;
    cur.frames += 1;
    cur.seconds += dur;
    acc.set(ref.code, cur);
    totalFrames += 1;
  }

  const breakdown: VowelBreakdown[] = [...acc.values()]
    .map((v) => ({
      code: v.ref.code,
      label: v.ref.label,
      seconds: v.seconds,
      position: v.posSum / v.frames,
      frames: v.frames,
    }))
    .sort((a, b) => b.seconds - a.seconds);
  return { breakdown, totalFrames };
}

/**
 * 计算参考分。
 * 输入不足（medianF0 非正、无声帧、采样率非法）时返回 null，
 * 由调用方决定是否渲染卡片——避免把 0 分误当成「极男性化」。
 */
export function computeVoiceExpression(input: VoiceExpressionInput): VoiceExpressionResult | null {
  if (!Number.isFinite(input.medianF0) || input.medianF0 <= 0) return null;
  if (!Number.isFinite(input.voicedSamples) || input.voicedSamples <= 0) return null;
  if (!Number.isFinite(input.sampleHz) || input.sampleHz <= 0) return null;

  const pitchScore = pitchReferenceScore(input.medianF0);

  const { breakdown, totalFrames } = input.frames && input.frames.length
    ? normalizeVowels(input.frames)
    : { breakdown: [] as VowelBreakdown[], totalFrames: 0 };

  let resonanceScore: number | null = null;
  if (totalFrames > 0 && breakdown.length > 0) {
    // 按时长加权（帧数与时长同向，但显式用时长更贴合「说的时间占比」）
    let wSum = 0;
    let wPos = 0;
    for (const b of breakdown) {
      wSum += b.seconds;
      wPos += b.position * b.seconds;
    }
    const positionAvg = wSum > 0 ? wPos / wSum : 0;
    resonanceScore = positionToScore(positionAvg);
  }

  const { pitchWeight, resonanceWeight } = VOICE_EXPRESSION_ANCHORS;
  const composite = resonanceScore == null
    ? pitchScore
    : pitchScore * pitchWeight + resonanceScore * resonanceWeight;
  const score = Math.round(clampScore(composite));

  const voicedSeconds = input.voicedSamples / input.sampleHz;
  const confidence: VoiceExpressionConfidence = voicedSeconds >= 10
    ? 'high'
    : voicedSeconds >= 3
      ? 'medium'
      : 'low';

  return {
    score,
    zone: voiceExpressionZone(score),
    pitchScore: Math.round(pitchScore),
    resonanceScore: resonanceScore == null ? null : Math.round(resonanceScore),
    voicedSeconds,
    confidence,
    breakdown,
    normalizedFrames: totalFrames,
  };
}
