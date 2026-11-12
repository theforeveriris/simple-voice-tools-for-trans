/**
 * 外部音频文件离线分析
 * 把手机录音 / 微信语音等外部音频拖进来，走与实时录音同一套分析管线
 * （YIN 音高 / LPC 共振峰 / 语谱频带 / 统计聚合 / 嗓音质量）出完整报告。
 *
 * 与实时管线的对应关系：
 *   解码任意容器（decodeAudioData）→ 统一重采样到 32kHz 单声道
 *   → 逐帧分析派发到 Worker（analysisPipeline：YIN / 隔帧共振峰 / Blackman FFT 语谱
 *     / Jitter / Shimmer / HNR / CPPS；Worker 不可用时主线程回退）
 *   → computeStats / 靶标达成率 → 落库结构
 *
 * 32k 折中点：fs/4 = 8k 抽取率下 F2 覆盖到 3.4k，且 YIN 开销约为 48k 的 1/3，
 * 长音频也能在秒级出结果。分析上限 5 分钟（与实时最长档一致），超出截断。
 */

import { computeStats, computeInTargetPct, toRecordSeries, toRecordSpec } from './recorder';
import { runFrameAnalysis } from './analysisClient';
import { estimateImportGainDb, applyGainDb } from './normalize';
import { PIPELINE_HZ, FRAME_HZ, FRAME_SAMPLES } from './analysisPipeline';
import { SPEC_BANDS } from '@/constants';
import type { AnalysisRecord } from '@/types';

/** 单次导入的最长分析时长（秒）：超出部分截断 */
export const IMPORT_MAX_SEC = 300;
/** 时长预检上限（秒）：超过直接拒绝，避免超长文件解码爆内存 */
const PROBE_MAX_SEC = 600;

/** 导入失败原因（调用方据此映射提示文案） */
export type ImportFailReason = 'decode' | 'tooShort' | 'tooLong';

/** erasableSyntaxOnly 下不能用参数属性，改用显式字段 */
export class AudioImportError extends Error {
  reason: ImportFailReason;
  constructor(reason: ImportFailReason) {
    super(`audio import failed: ${reason}`);
    this.reason = reason;
  }
}

/** 由异常映射 toast 文案键（保持本模块不依赖 i18n） */
export function importErrorKey(err: unknown): 'toast.importAudioDecodeFail' | 'toast.importAudioTooShort' | 'toast.importAudioTooLong' {
  const reason = err instanceof AudioImportError ? err.reason : 'decode';
  if (reason === 'tooShort') return 'toast.importAudioTooShort';
  if (reason === 'tooLong') return 'toast.importAudioTooLong';
  return 'toast.importAudioDecodeFail';
}

export interface AnalyzeAudioOptions {
  /** 训练靶标目标区间（启用时统计达成率写入 stats） */
  targetRange?: [number, number] | null;
  /** 分析进度回调（0-1） */
  onProgress?: (frac: number) => void;
  /** 是否保留原音频用于回放（默认保留；关闭设置时不入库） */
  saveAudio?: boolean;
  /** 最长分析时长（秒）；默认 IMPORT_MAX_SEC，崩溃恢复可传录音硬上限 */
  maxSec?: number;
}

export interface AnalyzeAudioResult {
  record: AnalysisRecord;
  /** 原始音频（saveAudio = false 时为 null） */
  audio: Blob | null;
  /** 是否因超过上限被截断 */
  truncated: boolean;
}

/** 解码任意音频 Blob 为 AudioBuffer（音高算法对比重算共用） */
export async function decodeBlob(blob: Blob): Promise<AudioBuffer> {
  const raw = await blob.arrayBuffer();
  const decodeCtx = new AudioContext();
  try {
    return await decodeCtx.decodeAudioData(raw);
  } finally {
    void decodeCtx.close();
  }
}

/** 用 <audio> 元素轻量探测时长（秒），读不出（如流式 webm）或超时返回 0 */
function probeDurationSec(file: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = new Audio();
    const done = (sec: number) => {
      clearTimeout(timer);
      el.onloadedmetadata = null;
      el.onerror = null;
      URL.revokeObjectURL(url);
      resolve(sec);
    };
    // 某些损坏文件 loadedmetadata/error 都不触发，超时按探测失败放行（后续解码兜底）
    const timer = setTimeout(() => done(0), 4000);
    el.preload = 'metadata';
    el.onloadedmetadata = () => done(isFinite(el.duration) && el.duration > 0 ? el.duration : 0);
    el.onerror = () => done(0);
    el.src = url;
  });
}

/** 多声道混合为单声道（截取前 maxSec 秒）；音高算法对比重算共用 */
export function mixdown(decoded: AudioBuffer, maxSec: number): Float32Array<ArrayBuffer> {
  const len = Math.min(decoded.length, Math.ceil(maxSec * decoded.sampleRate));
  const chs = decoded.numberOfChannels;
  const out = new Float32Array(len);
  for (let c = 0; c < chs; c++) {
    const data = decoded.getChannelData(c);
    for (let i = 0; i < len; i++) out[i] += data[i] / chs;
  }
  return out;
}

/** 重采样到管线采样率（OfflineAudioContext，线性插值质量足够分析用）；音高算法对比重算共用 */
export async function resample(pcm: Float32Array<ArrayBuffer>, fromHz: number): Promise<Float32Array<ArrayBuffer>> {
  const targetLen = Math.max(1, Math.ceil((pcm.length / fromHz) * PIPELINE_HZ));
  const off = new OfflineAudioContext(1, targetLen, PIPELINE_HZ);
  const buf = off.createBuffer(1, pcm.length, fromHz);
  buf.copyToChannel(pcm, 0);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start(0);
  return (await off.startRendering()).getChannelData(0);
}

/**
 * 分析一个外部音频文件，产出与录音完全同构的分析记录
 * @throws AudioImportError（decode / tooShort / tooLong）
 */
export async function analyzeAudioFile(
  file: File,
  opts: AnalyzeAudioOptions = {},
): Promise<AnalyzeAudioResult> {
  // 1. 时长预检：超长文件直接拒绝，避免整段解码爆内存
  const probeSec = await probeDurationSec(file);
  if (probeSec > PROBE_MAX_SEC) throw new AudioImportError('tooLong');

  // 2. 解码（任意浏览器支持的容器/编码）
  let decoded: AudioBuffer;
  try {
    decoded = await decodeBlob(file);
  } catch {
    throw new AudioImportError('decode');
  }
  if (!isFinite(decoded.duration) || decoded.duration < 1) throw new AudioImportError('tooShort');

  const maxSec = opts.maxSec && opts.maxSec > 0 ? opts.maxSec : IMPORT_MAX_SEC;
  const truncated = decoded.duration > maxSec + 0.5;
  const useSec = Math.min(decoded.duration, maxSec);

  // 3. 单声道化 + 统一重采样
  let pcm = mixdown(decoded, useSec);
  if (decoded.sampleRate !== PIPELINE_HZ) {
    pcm = await resample(pcm, decoded.sampleRate);
  }

  // 3.5 自动增益归一：电平过低的外部文件抬到可分析范围
  // （只提升、以峰值留白封顶不削波、不改原文件；增益记入 env 便于溯源）
  const inputGainDb = estimateImportGainDb(pcm, PIPELINE_HZ);
  applyGainDb(pcm, inputGainDb);

  // 4. 逐帧分析：派发到 Worker（或主线程回退），进度经回调上抛
  const hop = Math.round(PIPELINE_HZ / FRAME_HZ);
  const frames = Math.max(0, Math.floor((pcm.length - FRAME_SAMPLES) / hop) + 1);
  if (frames < 4) throw new AudioImportError('tooShort');

  const {
    t: bufT, f0: bufF0, db: bufDb, f1: bufF1, f2: bufF2,
    specFlat, specRows, metrics,
  } = await runFrameAnalysis(pcm, opts.onProgress);

  // 5. 聚合落库结构（复用实时管线的序列化与统计）
  const series = toRecordSeries(bufT, bufF0, bufDb, bufF1, bufF2, 1);
  const durationSec = series.t.length > 0 ? series.t[series.t.length - 1] : 0;
  if (durationSec < 1 || series.t.length < 4) throw new AudioImportError('tooShort');
  // sampleHz 由全序列时间跨度反推（帧间隔时间戳按 ms 取整，单帧差有 ≈1% 系统偏差）
  const spanSec = series.t.length > 1 ? series.t[series.t.length - 1] - series.t[0] : 0;
  const sampleHz = spanSec > 0 ? (series.t.length - 1) / spanSec : FRAME_HZ;
  const stats = computeStats(series, sampleHz);
  const inTargetPct = computeInTargetPct(series, opts.targetRange ?? null);
  if (inTargetPct != null) stats.inTargetPct = inTargetPct;

  const note = file.name.replace(/\.[^.]+$/, '').trim().slice(0, 60);
  const spec = specData(specFlat, specRows);
  const record: AnalysisRecord = {
    id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    createdAt: Date.now(),
    durationSec,
    sampleHz,
    series,
    stats: { ...stats, ...metrics },
    ...(note ? { note } : {}),
    ...(inputGainDb > 0 ? { env: { inputGainDb } } : {}),
    ...(spec ? { spec } : {}),
  };

  return { record, audio: opts.saveAudio === false ? null : file, truncated };
}

/** 语谱行解码：把 Worker 返回的扁平量化行切成行视图并编码 base64（行率 1，导入序列本身按 30fps 存储）；重算共用 */
export function specData(flat: Uint8Array, rows: number): { bands: number; data: string } | undefined {
  if (rows <= 0 || flat.length < rows * SPEC_BANDS) return undefined;
  const arr: Uint8Array[] = [];
  for (let r = 0; r < rows; r++) {
    arr.push(flat.subarray(r * SPEC_BANDS, (r + 1) * SPEC_BANDS));
  }
  const data = toRecordSpec(arr, 1);
  return data ? { bands: SPEC_BANDS, data } : undefined;
}

/* ------------------------------ PWA Share Target ------------------------------ */

/** Service Worker 存放系统分享文件的位置（与 public/sw-custom.js 约定一致） */
const SHARE_CACHE = 'svt-share-target';
const SHARE_ENTRY = 'shared-audio';

/**
 * 取回「分享到本应用」的音频文件（存在即取走并清除缓存）
 * Service Worker 把 POST 分享的文件暂存在 Cache API 后 303 重定向到应用，
 * 应用启动时检测 ?share-target=1 并调用本函数。无则返回 null。
 */
export async function takeSharedFile(): Promise<File | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(SHARE_CACHE);
    const res = await cache.match(SHARE_ENTRY);
    if (!res) return null;
    await cache.delete(SHARE_ENTRY);
    const blob = await res.blob();
    if (blob.size === 0) return null;
    const name = decodeURIComponent(res.headers.get('x-file-name') ?? 'shared-audio');
    return new File([blob], name, { type: blob.type || 'audio/webm' });
  } catch {
    return null;
  }
}
