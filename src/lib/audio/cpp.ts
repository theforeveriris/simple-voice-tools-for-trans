/**
 * CPPS：平滑倒谱峰突出度（Cepstral Peak Prominence, Smoothed）
 *
 * 与 Jitter / Shimmer / HNR 互补的嗓音质量指标，最大优势是对连续语音
 * （朗读模式）同样稳健——J/S 依赖周期序列，在连续语流中易受协同发音干扰。
 * 口径（Hillenbrand 回归线法 + 时间平滑）：
 *   1. 40ms 帧 / 10ms 帧移，能量过 −50dB 门限的帧参与统计
 *   2. 每帧：汉宁窗 → FFT → 功率谱 → 对数功率谱（dB）→ IFFT 得实倒谱
 *   3. 在基频搜索范围对应的 quefrency 区间内取倒谱峰值，减去同区间
 *      倒谱包络回归线在该点的值 → 帧级 CPP（dB）
 *   4. 帧序列做 5 帧滑动平均（时间平滑），CPPS = 平滑后的均值
 *
 * 说明：本实现按 Hillenbrand 标准定义（dB 谱 + 均值）。与 Praat 的
 * PowerCepstrogram 存在量级差异（验证设施 scripts/validation/ 交叉验证显示
 * 本口径数值约为 Praat 的 1/20），绝对数值不可直接比较，相对趋势一致。
 * 本口径对合成信号做构造真值回归（见 validation.test.ts）。
 *
 * 经验参考：连续语音健康嗓音多在 4–20dB，<4dB 提示谐波结构不显著
 * （气息声/噪声成分高）。数值仅供参考，不构成医学诊断。
 */

import { getAlgoParams } from './algoParams';

/** FFT 必须为 2 的幂：返回 >= n 的最小 2 的幂 */
function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * 基-2 迭代 FFT（原地，实部/虚部分离数组）
 * 也用于实倒谱计算：对偶对称的实序列做正变换即得其实倒谱（除以 N）
 * 导出供音频导入管线的语谱图频谱计算复用
 */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  // 位反转重排
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** 帧长（秒） */
const FRAME_SEC = 0.04;
/** 帧移（秒） */
const HOP_SEC = 0.01;
/** 基频搜索下限（Hz）→ quefrency 区间下界（上限为实验性可调参数，见 algoParams） */
const F0_MIN = 60;
/** 参与统计的最少有效帧数 */
const MIN_FRAMES = 10;

/** 最小二乘回归线 y = a·x + b */
function fitLine(xs: number[], ys: number[]): { a: number; b: number } {
  const n = xs.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
    sxx += xs[i] * xs[i];
    sxy += xs[i] * ys[i];
  }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-9) return { a: 0, b: sy / n };
  const a = (n * sxy - sx * sy) / denom;
  return { a, b: (sy - a * sx) / n };
}

/** 单帧帧级 CPP（dB）：倒谱峰值 − quefrency 区间回归线在峰值处的值 */
function frameCpp(
  frame: Float32Array,
  sampleRate: number,
  fftSize: number,
  window: Float32Array,
  re: Float32Array,
  im: Float32Array,
): number | null {
  const n = frame.length;
  // 汉宁窗 + 零填充
  for (let i = 0; i < fftSize; i++) {
    re[i] = i < n ? frame[i] * window[i] : 0;
    im[i] = 0;
  }
  fft(re, im);

  // 对数功率谱（半谱 + 镜像，保持共轭对称 → 逆变换为实偶序列）
  const half = fftSize / 2;
  const logSpec = new Float32Array(fftSize);
  for (let k = 0; k <= half; k++) {
    const p = re[k] * re[k] + im[k] * im[k];
    const db = 10 * Math.log10(p + 1e-10);
    logSpec[k] = db;
    if (k > 0 && k < half) logSpec[fftSize - k] = db;
  }

  // 实倒谱：对称实序列的正变换 / N
  re.set(logSpec);
  im.fill(0);
  fft(re, im);
  const inv = 1 / fftSize;

  // quefrency 搜索区间（样本）：基频上限 → 短 quefrency 下界，下限 → 长 quefrency 上界；
  // 上限为实验性可调参数（见 algoParams）
  const { cppsF0Max } = getAlgoParams();
  const qMin = Math.max(2, Math.floor(sampleRate / cppsF0Max));
  const qMax = Math.min(half - 1, Math.ceil(sampleRate / F0_MIN));
  if (qMax <= qMin + 4) return null;

  const xs: number[] = [];
  const ys: number[] = [];
  let peakQ = -1;
  let peakVal = -Infinity;
  for (let q = qMin; q <= qMax; q++) {
    const v = re[q] * inv;
    xs.push(q);
    ys.push(v);
    if (v > peakVal) {
      peakVal = v;
      peakQ = q;
    }
  }
  const { a, b } = fitLine(xs, ys);
  const baseline = a * peakQ + b;
  return peakVal - baseline;
}

/**
 * 由完整录音 PCM 计算 CPPS（dB）
 * @param samples 音频 PCM（任一通道）
 * @param sampleRate 采样率
 * @returns CPPS 值；有效帧不足时返回 null
 */
export function computeCpps(samples: Float32Array, sampleRate: number): number | null {
  const frameLen = Math.round(FRAME_SEC * sampleRate);
  const hop = Math.round(HOP_SEC * sampleRate);
  const fftSize = nextPow2(frameLen);
  if (samples.length < frameLen + hop) return null;

  // 汉宁窗（按实际帧长生成，零填充至 fftSize）
  const window = new Float32Array(frameLen);
  for (let i = 0; i < frameLen; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frameLen - 1));

  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  // 实验性可调参数：活跃帧门限与时间平滑窗（见 algoParams）
  const { activeGateDb, cppsSmoothFrames } = getAlgoParams();

  const raw: number[] = [];
  for (let start = 0; start + frameLen <= samples.length; start += hop) {
    const frame = samples.subarray(start, start + frameLen);
    // 能量门限
    let sum = 0;
    for (let i = 0; i < frameLen; i++) sum += frame[i] * frame[i];
    const db = 20 * Math.log10(Math.sqrt(sum / frameLen) + 1e-10);
    if (db < activeGateDb) continue;
    const cpp = frameCpp(frame, sampleRate, fftSize, window, re, im);
    if (cpp != null && isFinite(cpp)) raw.push(cpp);
  }

  if (raw.length < MIN_FRAMES) return null;

  // 时间平滑：滑动平均（抑制帧间倒谱峰跳动）
  const smoothed: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const lo = Math.max(0, i - Math.floor(cppsSmoothFrames / 2));
    const hi = Math.min(raw.length, i + Math.floor(cppsSmoothFrames / 2) + 1);
    let s = 0;
    for (let j = lo; j < hi; j++) s += raw[j];
    smoothed.push(s / (hi - lo));
  }

  // CPPS = 平滑后的均值（Hillenbrand 标准口径；不再减标准差）
  const mean = smoothed.reduce((s, v) => s + v, 0) / smoothed.length;
  const cpps = mean;
  return isFinite(cpps) ? Math.round(cpps * 10) / 10 : null;
}
