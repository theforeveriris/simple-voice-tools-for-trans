/**
 * 嗓音质量指标：Jitter（基频微扰）/ Shimmer（振幅微扰）/ HNR（谐噪比）
 *
 * 由录音音频的 PCM 离线计算（stop 时一次完成），口径对齐临床常用定义：
 *   Jitter(local)  相邻基音周期长度波动率均值 ×100%，正常嗓音约 0.2–2%
 *   Shimmer(local) 相邻基音周期幅度波动率均值 ×100%，正常嗓音约 1–8%
 *   HNR            谐波能量 / 噪声能量（dB），正常嗓音约 10–25dB
 * HNR 由归一化自相关峰值换算：HNR = 10·log10(r/(1−r))，r 为周期处自相关。
 * （对齐 Praat Harmonicity 口径；旧实现用 YIN 置信度换算，干净信号下饱和于 23dB）
 *
 * 周期检测：128ms 分析窗内做峰检测（抛物线插值细化峰位），
 * 帧内相邻峰距即周期序列；跨帧用基频连续性（±25%）防护八度跳变。
 */

import { detectPitchYin } from './pitch';
import { getAlgoParams } from './algoParams';

export interface VoiceQuality {
  jitterPct: number | null;
  shimmerPct: number | null;
  hnrDb: number | null;
}

/** 分析窗长（秒）：约容纳 12+ 个最低频周期，保证 Jitter 统计有意义 */
const WIN_SEC = 0.128;
/** 窗移（秒）：不重叠 */
const HOP_SEC = 0.128;
/** Jitter / Shimmer 离群上限（超过视为检测错误丢弃） */
const JITTER_CAP = 5;
const SHIMMER_CAP = 15;

interface PeriodInfo {
  periods: number[];
  amps: number[];
}

/**
 * 在一帧内检测基音周期序列（峰检测 + 抛物线插值）
 * @param f0 YIN 给出的帧基频，作为峰间距的先验
 */
function extractPeriods(frame: Float32Array, sampleRate: number, f0: number): PeriodInfo | null {
  const expect = sampleRate / f0;
  const minDist = Math.max(2, Math.floor(expect * 0.5));

  let maxAbs = 0;
  for (let i = 0; i < frame.length; i++) {
    const a = Math.abs(frame[i]);
    if (a > maxAbs) maxAbs = a;
  }
  if (maxAbs < 1e-4) return null;
  const thr = maxAbs * 0.3;

  // 峰位（细化后）与峰幅
  const pos: number[] = [];
  const amp: number[] = [];
  let lastPeak = -minDist;
  for (let i = 1; i < frame.length - 1; i++) {
    if (frame[i] > thr && frame[i] >= frame[i - 1] && frame[i] > frame[i + 1] && i - lastPeak >= minDist) {
      // 抛物线插值细化峰位
      const y0 = frame[i - 1], y1 = frame[i], y2 = frame[i + 1];
      const denom = y0 - 2 * y1 + y2;
      const shift = Math.abs(denom) > 1e-12 ? (0.5 * (y0 - y2)) / denom : 0;
      pos.push(i + shift);
      // 抛物线顶点处的幅度（周期峰值强度）：段扫描会把下一峰也扫进来，
      // 相邻幅度互相污染导致 shimmer 系统性偏低（验证设施抓出的口径 bug）
      amp.push(Math.abs(denom) > 1e-12 ? y1 - (0.125 * (y0 - y2) * (y0 - y2)) / denom : y1);
      lastPeak = i;
    }
  }

  // 相邻峰距 → 周期；过滤偏离先验过多的（漏峰/双峰）
  const periods: number[] = [];
  const amps: number[] = [];
  for (let k = 1; k < pos.length; k++) {
    const d = pos[k] - pos[k - 1];
    if (d >= expect * 0.6 && d <= expect * 1.7) {
      periods.push(d);
      // 该周期的幅度 = 左峰的峰值强度（插值细化，Praat 的 period strength 同语义）
      amps.push(amp[k - 1]);
    }
  }
  return periods.length >= 2 ? { periods, amps } : null;
}

function mean(a: number[]): number {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
}

/**
 * 由归一化自相关峰值估算 HNR（dB）
 * HNR = 10·log10(r / (1−r))，r = 周期处归一化自相关
 * 对齐 Praat Harmonicity (cc/ac) 口径；干净信号 r→1 时钳制在 40dB
 */
function hnrFromAcf(frame: Float32Array, sampleRate: number, f0: number): number | null {
  const tau0 = Math.round(sampleRate / f0);
  const n = frame.length;
  // 分段归一化（不能用全长能量——尾部长度不同会系统性压低 r）
  let bestR = 0;
  for (let d = -5; d <= 5; d++) {
    const tau = tau0 + d;
    if (tau < 1 || tau >= n) continue;
    let corr = 0;
    let sum1 = 0;
    let tailEnergy = 0;
    for (let i = 0; i < n - tau; i++) {
      corr += frame[i] * frame[i + tau];
      sum1 += frame[i] * frame[i];
      tailEnergy += frame[i + tau] * frame[i + tau];
    }
    if (sum1 <= 0 || tailEnergy <= 0) continue;
    const r = corr / Math.sqrt(sum1 * tailEnergy);
    if (r > bestR) bestR = r;
  }
  if (bestR <= 0.05) return null; // 无周期性
  // 干净信号 r→1 时 HNR→∞，Praat 因窗相关给 37–43dB；这里钳制在 40dB
  if (bestR >= 0.999) return 40;
  return 10 * Math.log10(bestR / (1 - bestR));
}

/**
 * 由完整录音 PCM 计算嗓音质量指标
 * @param samples 音频 PCM（任一通道）
 * @param sampleRate 采样率
 */
export function computeVoiceQuality(samples: Float32Array, sampleRate: number): VoiceQuality {
  const win = Math.max(1024, Math.round(WIN_SEC * sampleRate));
  const hop = Math.max(win, Math.round(HOP_SEC * sampleRate));
  const yinWindow = Math.min(win, 2048); // YIN 只需覆盖 tauMax，取子窗即可
  // 实验性可调参数：活跃门限 / 置信度门槛 / 最少周期数，音高搜索范围随全局参数
  const { activeGateDb, vqMinProb, vqMinPeriods, pitchMinHz, pitchMaxHz } = getAlgoParams();

  const jitters: number[] = [];
  const shimmers: number[] = [];
  const hnrs: number[] = [];
  let prevF0 = 0;

  for (let start = 0; start + win <= samples.length; start += hop) {
    const frame = samples.subarray(start, start + win);

    // 能量门限
    let sum = 0;
    for (let i = 0; i < win; i++) sum += frame[i] * frame[i];
    const db = 20 * Math.log10(Math.sqrt(sum / win) + 1e-10);
    if (db < activeGateDb) {
      prevF0 = 0;
      continue;
    }

    // YIN 音高（用帧首子窗降低开销）
    const pitch = detectPitchYin(frame.subarray(0, yinWindow), sampleRate, pitchMinHz, pitchMaxHz);
    if (!pitch || pitch.prob < vqMinProb) {
      prevF0 = 0;
      continue;
    }
    // 基频连续性防护（八度跳变）
    if (prevF0 > 0 && Math.abs(pitch.freq / prevF0 - 1) > 0.25) {
      prevF0 = 0;
      continue;
    }
    prevF0 = pitch.freq;

    // HNR：归一化自相关峰值换算（对齐 Praat Harmonicity 口径，
    // 替代旧的 YIN 置信度换算——后者在干净信号下饱和于 23dB）
    const hnr = hnrFromAcf(frame.subarray(0, yinWindow), sampleRate, pitch.freq);
    if (hnr != null) hnrs.push(hnr);

    // Jitter / Shimmer：帧内周期序列
    const info = extractPeriods(frame, sampleRate, pitch.freq);
    if (!info || info.periods.length < vqMinPeriods) continue;
    const tMean = mean(info.periods);
    const aMean = mean(info.amps);
    if (tMean <= 0 || aMean <= 0) continue;
    let dt = 0;
    let da = 0;
    for (let i = 1; i < info.periods.length; i++) {
      dt += Math.abs(info.periods[i] - info.periods[i - 1]);
      da += Math.abs(info.amps[i] - info.amps[i - 1]);
    }
    const n = info.periods.length - 1;
    const jitter = (dt / n / tMean) * 100;
    const shimmer = (da / n / aMean) * 100;
    if (jitter < JITTER_CAP) jitters.push(jitter);
    if (shimmer < SHIMMER_CAP) shimmers.push(shimmer);
  }

  return {
    jitterPct: jitters.length > 0 ? Math.round(mean(jitters) * 1000) / 1000 : null,
    shimmerPct: shimmers.length > 0 ? Math.round(mean(shimmers) * 100) / 100 : null,
    hnrDb: hnrs.length > 0 ? Math.round(mean(hnrs) * 10) / 10 : null,
  };
}
