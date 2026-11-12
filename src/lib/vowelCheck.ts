/**
 * 长音元音检查：从一段持续发声里取中段稳定帧，自动判断最接近哪个普通话
 * 主元音（a / o / e / i / u / ü），再与该元音的同性别参考均值比较。
 *
 * 和「自由朗读的最近邻元音分布」不同：
 *   - 只取最长连续有声段的中段，避开起音、收音和偶发丢帧；
 *   - 元音判定在同一段稳定发声上完成，不再逐帧贴标签；
 *   - 位置只在判定出的同一个元音内部比较（男 / 女参考），不跨元音；
 *   - 给出置信度：与第二候选太接近、或离所有参考都太远时明确标"不确定"，
 *     不强行给一个元音。
 * 仍然不是诊断；参考值为群体均值，个体差异很大。
 */
import type { RecordSeries } from '@/types';
import { MANDARIN_VOWELS, type MandarinVowelRef } from './mandarinVowels';

/** 最少稳定帧数（30Hz 下 8 帧 ≈ 0.27 秒） */
export const VOWEL_MIN_FRAMES = 8;
/** 允许的连续缺帧数（共振峰偶发丢失） */
const MAX_GAP_FRAMES = 2;
/** 稳态段去头尾比例 */
const TRIM_RATIO = 0.2;
/** 稳态判定阈值：log-F1 + log-F2 的中位绝对偏差；约 7% 共振峰波动 */
const STABLE_SPREAD = 0.07;
/** 离最近的参考元音超过该 log 距离 → 不匹配任何主元音 */
const MAX_MATCH_DISTANCE = 0.35;
/** 与第二候选的差距：低于 LOW = 不确定，低于 HIGH = 中等置信 */
const MARGIN_LOW = 0.06;
const MARGIN_HIGH = 0.12;

export interface StableSegment {
  /** 稳定段中位 F1（Hz） */
  f1: number;
  /** 稳定段中位 F2（Hz） */
  f2: number;
  /** 稳定段中位 F0（Hz） */
  f0: number;
  /** 稳定段时长（秒） */
  seconds: number;
  /** 稳定段帧数 */
  frames: number;
  /** 整段录音中的有效帧数 */
  totalFrames: number;
  /** 稳定段内 log-F1/F2 的中位绝对偏差（越小越稳） */
  spread: number;
  /** 共振峰是否足够稳定 */
  stable: boolean;
  /** 是否达到最小样本量 */
  enough: boolean;
}

export interface VowelDetection {
  segment: StableSegment;
  /** 最佳候选元音（样本不足时为 null） */
  best: MandarinVowelRef | null;
  /** 第二候选（用于不确定时展示） */
  second: MandarinVowelRef | null;
  /** 最佳候选的 log 空间距离 */
  distance: number;
  /** 与第二候选的差距（越大越确定） */
  margin: number;
  confidence: 'high' | 'medium' | 'low' | 'none';
  /** −1 = 男性参考均值，+1 = 女性参考均值（相对最佳候选元音） */
  position: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function logDist(f1a: number, f2a: number, f1b: number, f2b: number): number {
  return Math.hypot(Math.log(f1a / f1b), Math.log(f2a / f2b));
}

/** 取最长连续有声段的中段（去掉头尾各 20%），返回中位 F1/F2/F0 与稳定性 */
function extractStableSegment(series: RecordSeries): StableSegment {
  const step = series.t.length > 1 && series.t[1] > series.t[0]
    ? series.t[1] - series.t[0]
    : 1 / 30;

  const frames: { i: number; f0: number; f1: number; f2: number }[] = [];
  for (let i = 0; i < series.t.length; i++) {
    const f0 = series.f0[i];
    const f1 = series.f1[i];
    const f2 = series.f2[i];
    if (f0 == null || f1 == null || f2 == null) continue;
    if (!Number.isFinite(f0) || !Number.isFinite(f1) || !Number.isFinite(f2)) continue;
    if (f0 <= 0 || f1 <= 0 || f2 <= f1) continue;
    frames.push({ i, f0, f1, f2 });
  }

  const empty: StableSegment = {
    f1: 0,
    f2: 0,
    f0: 0,
    seconds: 0,
    frames: 0,
    totalFrames: frames.length,
    spread: 0,
    stable: false,
    enough: false,
  };
  if (frames.length === 0) return empty;

  // 最长连续段（允许少量丢帧）
  let bestStart = 0;
  let bestEnd = 0;
  let start = 0;
  for (let k = 0; k < frames.length; k++) {
    if (k > 0 && frames[k].i - frames[k - 1].i > MAX_GAP_FRAMES + 1) start = k;
    if (k - start > bestEnd - bestStart) {
      bestStart = start;
      bestEnd = k;
    }
  }

  const runLen = bestEnd - bestStart + 1;
  if (runLen < VOWEL_MIN_FRAMES) {
    return { ...empty, frames: runLen };
  }

  const cut = Math.floor(runLen * TRIM_RATIO);
  const from = bestStart + cut;
  const to = bestEnd - cut;
  const slice = frames.slice(from, to + 1);
  if (slice.length < VOWEL_MIN_FRAMES) {
    return { ...empty, frames: slice.length };
  }

  const f1 = median(slice.map((x) => x.f1));
  const f2 = median(slice.map((x) => x.f2));
  const f0 = median(slice.map((x) => x.f0));

  const logF1 = slice.map((x) => Math.log(x.f1));
  const logF2 = slice.map((x) => Math.log(x.f2));
  const medL1 = median(logF1);
  const medL2 = median(logF2);
  const spread = median(slice.map((_, k) => Math.abs(logF1[k] - medL1) + Math.abs(logF2[k] - medL2)));

  const firstIdx = slice[0].i;
  const lastIdx = slice[slice.length - 1].i;

  return {
    f1,
    f2,
    f0,
    seconds: (lastIdx - firstIdx + 1) * step,
    frames: slice.length,
    totalFrames: frames.length,
    spread,
    stable: spread <= STABLE_SPREAD,
    enough: true,
  };
}

/**
 * 自动判断长音最接近的普通话主元音。
 * 每个元音取「到男性参考」与「到女性参考」中更近的那个作为分数，
 * 避免因为说话人性别 / 声道尺寸未知而先验偏向某一套参考。
 */
export function detectSustainedVowel(series: RecordSeries): VowelDetection {
  const segment = extractStableSegment(series);
  if (!segment.enough) {
    return {
      segment,
      best: null,
      second: null,
      distance: 0,
      margin: 0,
      confidence: 'none',
      position: 0,
    };
  }

  const scores = MANDARIN_VOWELS.map((ref) => {
    const dMale = logDist(segment.f1, segment.f2, ref.male.f1, ref.male.f2);
    const dFemale = logDist(segment.f1, segment.f2, ref.female.f1, ref.female.f2);
    return { ref, dMale, dFemale, score: Math.min(dMale, dFemale) };
  }).sort((a, b) => a.score - b.score);

  const best = scores[0];
  // 第二候选必须换一个元音：同一元音的另一性别参考不算"另一个可能"
  const second = scores.find((s) => s.ref.code !== best.ref.code)!;
  const margin = second.score - best.score;

  let confidence: VowelDetection['confidence'];
  if (best.score > MAX_MATCH_DISTANCE) confidence = 'none';
  else if (margin < MARGIN_LOW) confidence = 'low';
  else if (margin < MARGIN_HIGH) confidence = 'medium';
  else confidence = 'high';

  const sum = best.dMale + best.dFemale;
  const position = sum > 1e-9 ? (best.dMale - best.dFemale) / sum : 0;

  return {
    segment,
    best: best.ref,
    second: second.ref,
    distance: best.score,
    margin,
    confidence,
    position: Math.max(-1, Math.min(1, position)),
  };
}
