/**
 * 声音性别表达参考分（VFP 风格）
 *
 * 概念来源：inaSpeechSegmenter 的 Voice Femininity Percentage（VFP，
 * Doukhan et al., Interspeech 2023）——0–100 连续分，50 ≈ 中性。
 * 本项目不打包其 CNN 模型，只在浏览器内用既有的音高 / 共鸣统计做
 * 透明、可复算的声学近似；因此它是一个「参考估计」，不是模型输出，
 * 更不是诊断。
 *
 * 评分口径：
 *   - 音高 55%：medianF0 经 logistic 映射，中心 165 Hz。
 *     感知分界约 155–165 Hz（Wolfe et al. 1990；Gelfer & Schofield 2000），
 *     与 ASHA 的「>180 Hz 偏女声 / <130 Hz 偏男声 / 145–175 Hz 中性带」一致。
 *   - 共鸣 45%：F2−F1 经 logistic 映射，中心 900 Hz。
 *     项目女性化参考线 ≥1000 Hz（PARAMETERS-GUIDE 2.6）约 75 分，
 *     男性化靶标 F2−F1 ≈800 Hz 约 25 分。
 *     旧记录没有 F2−F1 时退回平均 F2（中心 1700 Hz）；两者都没有则只按音高。
 *   - 三档：<33 男性化参考，33–66 中性 / 过渡，>66 女性化参考。
 *
 * 参考文献见 documentation/REFERENCES.md「声音性别感知参考（VFP 风格）」。
 */

/** 评分锚点：集中在一处，便于文档 / 测试与未来按语料校准 */
export const VOICE_EXPRESSION_ANCHORS = {
  pitchCenterHz: 165,
  pitchScaleHz: 20,
  gapCenterHz: 900,
  gapScaleHz: 90,
  f2CenterHz: 1700,
  f2ScaleHz: 150,
  /** 音高在综合分中的权重（共鸣缺失时自动改为 100%） */
  pitchWeight: 0.55,
  /** 共鸣在综合分中的权重 */
  resonanceWeight: 0.45,
} as const;

export type VoiceExpressionZone = 'masculine' | 'neutral' | 'feminine';
export type VoiceExpressionConfidence = 'low' | 'medium' | 'high';

export interface VoiceExpressionInput {
  /** 中位基频 Hz（robust 中心；比平均值更抗句尾掉音） */
  medianF0: number;
  /** F2−F1 同帧间距均值 Hz；旧记录可能缺失 */
  f2f1GapHz?: number | null;
  /** 平均 F2 Hz（F2−F1 缺失时的退路） */
  avgF2?: number | null;
  /** 有声帧数 */
  voicedSamples: number;
  /** 序列采样率（Hz） */
  sampleHz: number;
}

export interface VoiceExpressionResult {
  /** 0–100 综合参考分，越高越靠近女性化参考 */
  score: number;
  zone: VoiceExpressionZone;
  /** 音高子分 0–100（已取整，供展示） */
  pitchScore: number;
  /** 共鸣子分 0–100（已取整）；无共振峰时为 null */
  resonanceScore: number | null;
  /** 共鸣子分实际使用的依据 */
  resonanceBasis: 'gap' | 'f2' | null;
  /** 有效发声时长（秒） */
  voicedSeconds: number;
  /** 样本充分度：<3 s 低、3–10 s 中、≥10 s 高 */
  confidence: VoiceExpressionConfidence;
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

/** 音高子分：165 Hz = 50 分；130 Hz ≈ 15，180 Hz ≈ 68，220 Hz ≈ 94 */
export function pitchReferenceScore(medianF0: number): number {
  return clampScore(logistic(medianF0, VOICE_EXPRESSION_ANCHORS.pitchCenterHz, VOICE_EXPRESSION_ANCHORS.pitchScaleHz));
}

/** 共鸣子分（F2−F1）：1000 Hz ≈ 75 分；800 Hz ≈ 25 */
export function resonanceReferenceScoreGap(gapHz: number): number {
  return clampScore(logistic(gapHz, VOICE_EXPRESSION_ANCHORS.gapCenterHz, VOICE_EXPRESSION_ANCHORS.gapScaleHz));
}

/** 共鸣子分（平均 F2）：1900 Hz ≈ 79 分；1500 Hz ≈ 21 */
export function resonanceReferenceScoreF2(f2Hz: number): number {
  return clampScore(logistic(f2Hz, VOICE_EXPRESSION_ANCHORS.f2CenterHz, VOICE_EXPRESSION_ANCHORS.f2ScaleHz));
}

/** 综合分三档：<33 男性化参考，33–66 中性 / 过渡，>66 女性化参考 */
export function voiceExpressionZone(score: number): VoiceExpressionZone {
  if (score < 33) return 'masculine';
  if (score > 66) return 'feminine';
  return 'neutral';
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

  const gap = input.f2f1GapHz;
  const f2 = input.avgF2;
  let resonanceScore: number | null = null;
  let resonanceBasis: 'gap' | 'f2' | null = null;

  if (gap != null && Number.isFinite(gap) && gap > 0) {
    resonanceScore = resonanceReferenceScoreGap(gap);
    resonanceBasis = 'gap';
  } else if (f2 != null && Number.isFinite(f2) && f2 > 0) {
    resonanceScore = resonanceReferenceScoreF2(f2);
    resonanceBasis = 'f2';
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
    resonanceBasis,
    voicedSeconds,
    confidence,
  };
}
