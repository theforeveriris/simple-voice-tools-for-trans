/**
 * 音高算法对比（实验性）
 * 取记录的录音音频 → 解码混音 → 统一重采样到管线采样率 → 用备选算法
 * （pYIN / MPM）逐帧重算基频，产出与记录序列同时间轴的备选曲线；
 * 并给出与录音时原始曲线的一致率与中位偏差（cents）。
 * 纯对比不落库：结果只活在分析页的对比卡片里。
 */

import {
  mixdown, resample as resamplePcm, decodeBlob, IMPORT_MAX_SEC,
} from './importAudio';
import { runPitchOnly } from './analysisClient';
import { PIPELINE_HZ, FRAME_SAMPLES } from './analysisPipeline';
import type { PitchAlgorithm, AnalysisRecord, RecordSeries } from '@/types';

/** 备选算法集合（与原始 YIN 相对） */
export const ALT_ALGOS: PitchAlgorithm[] = ['pyin', 'mpm'];

/**
 * 两条曲线的时间轴补偿（秒）。
 *
 * 记录曲线（实时录音）与备选曲线（离线重算）的时间戳语义不同：
 *   - 记录曲线：时间戳 = 采样时刻 now，帧覆盖「now 之前的 4096 样本」（85ms @48k）
 *   - 备选曲线：时间戳 = (start + 2048) / 32000，即该帧窗的**末尾**
 *
 * 两者帧间隔几乎相同（约 33.4ms），但离线时间戳整体比记录曲线晚
 * **整整一个分析窗长**（64ms）——实测最近帧匹配会稳定地选中基准曲线的
 * 后两帧（女声 92%、男声 83% 的帧偏移 +2）。
 *
 * 错开两帧对不同嗓音的影响天差地别（±50 cents 一致阈值下）：
 *   - 语调平缓的嗓音（女声）相邻帧仅差几 cents → 错开两帧仍在阈值内
 *   - 音高起伏大的嗓音（男声）相邻帧常差 20–80 cents → 错开两帧即判不一致
 * 于是同一处系统性错位，让女声看起来「一致率 78%」、男声「只有 20–30%」。
 *
 * 补偿：把备选帧的时间戳减去一个窗长，回到与记录曲线相同的语义。
 */
const ALT_TIMESTAMP_COMPENSATION_SEC = FRAME_SAMPLES / PIPELINE_HZ;

/** 备选算法的音高序列（时间轴与记录序列对齐，null = 未检出） */
export interface AltPitchSeries {
  algo: PitchAlgorithm;
  t: number[];
  f0: (number | null)[];
}

/** 与原始曲线的一致性指标（基于两曲线同时有声的帧） */
export interface AlgoAgreement {
  /** 一致帧占比（%）：两算法同时检出且 cents 偏差 ≤ ±50 */
  agreePct: number;
  /** cents 偏差的中位数（绝对值） */
  medAbsCents: number;
  /** 参与对比的帧数 */
  compared: number;
}

export interface AltCompareResult {
  algo: PitchAlgorithm;
  series: AltPitchSeries;
  agreement: AlgoAgreement;
}

/**
 * 用备选算法重算一条记录的音高
 * @param audio 录音音频 Blob
 * @param algo 备选算法
 * @param onProgress 进度回调（0-1）
 */
export async function recomputePitch(
  audio: Blob,
  algo: PitchAlgorithm,
  onProgress?: (frac: number) => void,
): Promise<AltPitchSeries> {
  // 1. 解码 + 单声道化 + 统一重采样（与导入分析同一口径；超长截断到 5 分钟）
  const decoded = await decodeBlob(audio);
  const useSec = Math.min(decoded.duration, IMPORT_MAX_SEC);
  let pcm = mixdown(decoded, useSec);
  if (decoded.sampleRate !== PIPELINE_HZ) {
    pcm = await resamplePcm(pcm, decoded.sampleRate);
  }

  // 2. 逐帧重算（Worker 或主线程回退）
  const { t, f0 } = await runPitchOnly(pcm, algo, onProgress);

  return {
    algo,
    t,
    f0: f0.map((v) => (isFinite(v) && v > 0 ? v : null)),
  };
}

/**
 * 与记录原始曲线的一致性。
 *
 * 按补偿后的时间戳做最近帧匹配（见 ALT_TIMESTAMP_COMPENSATION_SEC 的说明）。
 * 只统计双方同时有声的帧；cents 偏差 ≤ ±50 记为一致。
 */
export function compareWithRecord(
  record: AnalysisRecord,
  alt: AltPitchSeries,
): AlgoAgreement {
  const base = record.series;
  const devs: number[] = [];
  for (let i = 0; i < alt.t.length; i++) {
    const a = alt.f0[i];
    if (a == null) continue;
    const b = nearestF0(base, alt.t[i] - ALT_TIMESTAMP_COMPENSATION_SEC);
    if (b == null) continue;
    devs.push(1200 * Math.log2(a / b));
  }
  if (devs.length === 0) return { agreePct: 0, medAbsCents: 0, compared: 0 };
  const abs = devs.map(Math.abs).sort((x, y) => x - y);
  const med = abs[Math.floor(abs.length / 2)];
  const agree = abs.filter((d) => d <= 50).length;
  return {
    agreePct: Math.round((agree / abs.length) * 100),
    medAbsCents: Math.round(med * 10) / 10,
    compared: abs.length,
  };
}

/** 最近帧查找：记录序列约 30Hz 均匀采样 */
function nearestF0(series: RecordSeries, t: number): number | null {
  const ts = series.t;
  if (ts.length === 0) return null;
  // 二分找第一个 >= t 的索引，与前一帧比距离
  let lo = 0;
  let hi = ts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  const idx = lo > 0 && Math.abs(ts[lo - 1] - t) < Math.abs(ts[lo] - t) ? lo - 1 : lo;
  if (Math.abs(ts[idx] - t) > 0.1) return null; // 时间对不上（截断等）不参与对比
  const f = series.f0[idx];
  return f != null && isFinite(f) && f > 0 ? f : null;
}
