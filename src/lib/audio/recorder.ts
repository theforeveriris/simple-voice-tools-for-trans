/**
 * 录音引擎（单例）
 * 负责麦克风采集、实时分析循环（音高 / 能量 / 共振峰 / 语谱频带）、
 * 实时数据缓冲供图表绘制，以及停止时生成可持久化的分析记录。
 * 同时用 MediaRecorder 抓取压缩音频，停止后解码 PCM 计算
 * 嗓音质量指标（Jitter / Shimmer / HNR）并返回音频 Blob 供持久化。
 */

import { rmsDb } from './pitch';
import { detectPitch } from './pitchAlt';
import { extractFormants } from './formants';
import { runVqMetrics } from './analysisClient';
import { getAlgoParams } from './algoParams';
import { spectrumRowToBands, base64FromBytes } from './spectrogram';
import { f2f1Gaps, aggregateResonance } from './resonance';
import {
  appendRecordingDraftChunk,
  discardRecordingDraft,
  markRecordingDraftRecordId,
  startRecordingDraft,
} from './recordingDraft';
import { SPEC_BANDS, SPEC_MAX_ROWS, getBandRanges, getPitchAlgorithm } from '@/constants';
import type { AnalysisRecord, RecordEnv, RecordSeries, TestMode, VoiceStats } from '@/types';

/** 序列降采样倍率：60fps 采集 → 约 30Hz 存储 */
const STORAGE_DECIMATE = 2;
/** 分析目标帧率（Hz）：与显示刷新率解耦的帧间隔基准 */
const ANALYSIS_FPS = 60;
/** 共振峰计算节流：每 N 帧计算一次（LPC 开销较大） */
const FORMANT_EVERY = 2;
/** 监听模式缓冲上限（帧数，约 2 分钟 @60fps）：长时间练习不无限占用内存 */
const MONITOR_BUFFER_FRAMES = 7200;
/** 未设置「最长录音时长」时的硬性上限（秒）：
 *  曲线缓冲 / 语谱行 / 音频块都随录音时长线性增长，放开会一直吃内存，
 *  到顶自动按正常录音收尾落库（与设置的最长档行为一致） */
export const RECORDING_MAX_SEC = 600;

/**
 * 由数据序列聚合统计信息
 */
export function computeStats(series: RecordSeries, sampleHz: number): VoiceStats {
  const durationSec = series.t.length > 0 ? series.t[series.t.length - 1] : 0;
  const f0s: number[] = [];
  const f1s: number[] = [];
  const f2s: number[] = [];
  const activeDb: number[] = [];
  let voiced = 0;

  for (let i = 0; i < series.t.length; i++) {
    const f0 = series.f0[i];
    if (f0 != null && f0 > 0) {
      f0s.push(f0);
      voiced++;
    }
    const f1 = series.f1[i];
    if (f1 != null) f1s.push(f1);
    const f2 = series.f2[i];
    if (f2 != null) f2s.push(f2);
    // 响度只统计发声帧：静音帧会拉低均值，且占比随录音停顿变化，录音之间不可比
    // （门限为实验性可调参数，见 algoParams）
    if (series.rmsDb[i] >= getAlgoParams().activeGateDb) activeDb.push(series.rmsDb[i]);
  }

  const sorted = (arr: number[]) => [...arr].sort((a, b) => a - b);
  const pct = (arr: number[], p: number) =>
    arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0;
  const mean = (arr: number[]) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const sf0 = sorted(f0s);
  const avgF0 = mean(f0s);
  const stdF0 = f0s.length
    ? Math.sqrt(mean(f0s.map((f) => (f - avgF0) * (f - avgF0))))
    : 0;

  let male = 0, female = 0, transition = 0;
  // 音区占比跟随自定义音区边界（与曲线着色同一来源）
  const ranges = getBandRanges();
  for (const f of f0s) {
    if (f >= ranges.male[0] && f < ranges.transition[0]) male++;
    else if (f >= ranges.transition[0] && f < ranges.female[0]) transition++;
    else if (f >= ranges.female[0] && f <= ranges.female[1]) female++;
  }

  const rmsVals = series.rmsDb;

  return {
    durationSec,
    sampleHz,
    totalSamples: series.t.length,
    voicedSamples: voiced,
    avgF0,
    medianF0: pct(sf0, 0.5),
    minF0: sf0[0] ?? 0,
    maxF0: sf0[sf0.length - 1] ?? 0,
    p10F0: pct(sf0, 0.1),
    p90F0: pct(sf0, 0.9),
    stdF0,
    malePct: voiced ? Math.round((male / voiced) * 100) : 0,
    femalePct: voiced ? Math.round((female / voiced) * 100) : 0,
    transitionPct: voiced ? Math.round((transition / voiced) * 100) : 0,
    avgF1: f1s.length ? mean(f1s) : null,
    avgF2: f2s.length ? mean(f2s) : null,
    f1Range: f1s.length ? [Math.min(...f1s), Math.max(...f1s)] : null,
    f2Range: f2s.length ? [Math.min(...f2s), Math.max(...f2s)] : null,
    // F2−F1 同帧间距（共鸣感知指标；谱倾斜需逐帧谱，由管线 metrics 下发）
    ...aggregateResonance(f2f1Gaps(series.f1, series.f2), []),
    avgDb: activeDb.length ? mean(activeDb) : -90,
    peakDb: rmsVals.length ? Math.max(...rmsVals) : -90,
    jitterPct: null,
    shimmerPct: null,
    hnrDb: null,
    cppsDb: null,
  };
}

/**
 * 训练靶标达成率：落在目标区间内的有声帧占全部有声帧的比例（%）
 * 无有声帧或未启用时返回 undefined
 */
export function computeInTargetPct(
  series: RecordSeries,
  range: [number, number] | null | undefined,
): number | null {
  if (!range) return null;
  let voiced = 0;
  let inside = 0;
  for (const f of series.f0) {
    if (f == null || f <= 0) continue;
    voiced++;
    if (f >= range[0] && f <= range[1]) inside++;
  }
  return voiced > 0 ? Math.round((inside / voiced) * 100) : null;
}

/**
 * 共振峰目标区命中率：F1/F2 同帧检出且落在目标矩形 (F1±r, F2±r) 内的
 * 有声帧占比（%）。实时计算不落库（改目标后旧记录立即可重新评估）
 */
export function computeInFormantTargetPct(
  series: RecordSeries,
  target: { f1: number; f2: number; radius: number } | null,
): number | null {
  if (!target) return null;
  let voiced = 0;
  let inside = 0;
  for (let i = 0; i < series.t.length; i++) {
    if (series.f0[i] == null) continue;
    const f1 = series.f1[i];
    const f2 = series.f2[i];
    if (f1 == null || f2 == null) continue;
    voiced++;
    if (
      f1 >= target.f1 - target.radius && f1 <= target.f1 + target.radius
      && f2 >= target.f2 - target.radius && f2 <= target.f2 + target.radius
    ) inside++;
  }
  return voiced > 0 ? Math.round((inside / voiced) * 100) : null;
}

/**
 * 将内部缓冲（NaN 缺口）转为可序列化序列（null 缺口），并降采样
 * 实时录音与音频文件导入共用（导入时 keepEvery = 1）
 */
export function toRecordSeries(
  t: number[], f0: number[], db: number[], f1: number[], f2: number[],
  keepEvery: number,
): RecordSeries {
  const s: RecordSeries = { t: [], f0: [], rmsDb: [], f1: [], f2: [] };
  for (let i = 0; i < t.length; i += keepEvery) {
    s.t.push(Math.round(t[i] * 1000) / 1000);
    s.f0.push(f0[i] >= 0 && f0[i] < Infinity ? Math.round(f0[i] * 10) / 10 : null);
    s.rmsDb.push(Math.round(db[i] * 10) / 10);
    s.f1.push(f1[i] >= 0 && f1[i] < Infinity ? Math.round(f1[i]) : null);
    s.f2.push(f2[i] >= 0 && f2[i] < Infinity ? Math.round(f2[i]) : null);
  }
  return s;
}

/** 将逐帧语谱行降采样（与分析序列对齐）、截断并编码为 base64（导入管线共用） */
export function toRecordSpec(rows: Uint8Array[], keepEvery: number): string | undefined {
  if (rows.length === 0) return undefined;
  const kept: Uint8Array[] = [];
  for (let i = 0; i < rows.length && kept.length < SPEC_MAX_ROWS; i += keepEvery) {
    kept.push(rows[i]);
  }
  const flat = new Uint8Array(kept.length * SPEC_BANDS);
  for (let r = 0; r < kept.length; r++) flat.set(kept[r], r * SPEC_BANDS);
  return base64FromBytes(flat);
}

export interface RecorderOptions {
  deviceId?: string;
  maxDurationSec?: number;
  onAutoStop?: () => void;
  /** 本次录音的测试模式（写入记录） */
  mode?: TestMode;
  /** 是否抓取录音音频（设置关闭时跳过，嗓音质量指标将不可用） */
  saveAudio?: boolean;
  /** 发声开始后持续静音达到该秒数自动结束（长音模式用，0 = 不启用） */
  silenceStopSec?: number;
  /** 训练靶标：目标音高区间（启用时统计达成率写入 stats） */
  targetRange?: [number, number] | null;
  /** 麦克风增益与降噪（默认关闭以采集原始音质） */
  micEnhance?: boolean;
  /** 录音码率（kbps；MediaRecorder audioBitsPerSecond） */
  audioBitrateKbps?: number;
}

/**
 * 实时数据快照（供图表每帧读取）
 */
export interface LiveSeries {
  t: number[];
  f0: number[];    // NaN = 未检出
  rmsDb: number[];
  f1: number[];
  f2: number[];
  elapsedSec: number;
}

/** 按浏览器支持度挑选录音容器（Chrome/Firefox: webm-opus；Safari: mp4-aac） */
function pickAudioMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* 忽略个别浏览器 isTypeSupported 抛错 */
    }
  }
  return undefined;
}

/**
 * 录音引擎
 */
class VoiceRecorder {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private rafId: number | null = null;
  private timeBuf = new Float32Array(4096);
  private freqBuf: Float32Array<ArrayBuffer> | null = null;

  private startTime = 0;
  private frameCount = 0;
  /** 上一次处理帧的时间戳（performance.now，ms）：帧率与显示刷新率解耦用 */
  private lastFrameAt = 0;
  private bufT: number[] = [];
  private bufF0: number[] = [];
  private bufDb: number[] = [];
  private bufF1: number[] = [];
  private bufF2: number[] = [];
  private bufSpec: Uint8Array[] = [];
  /** 语谱行回收池：帧循环每帧需要一行，用完回收复用，稳态零分配 */
  private specPool: Uint8Array[] = [];
  private smoothF1: number | null = null;
  private smoothF2: number | null = null;

  private maxDurationSec = 0;
  private onAutoStop: (() => void) | null = null;
  private autoStopFired = false;
  private pendingMode: TestMode | undefined;
  /** 环境元数据采集：开场底噪候选帧的电平 + 麦克风标签（stop 时组装进 record.env） */
  private pendingEnv: RecordEnv = {};
  private envNoiseSamples: number[] = [];
  /** 监听模式：只跑分析循环供练习视图读取，不抓音频不落记录 */
  private monitoring = false;
  /** 静音自动停止（长音模式）：发声开始后持续静音阈值（秒，0 = 不启用） */
  private silenceStopSec = 0;
  /** 最近一次发声帧的时间戳（相对录音起点的秒数，与 loop 内的 now 同口径） */
  private lastVoicedAt = 0;
  /** 是否已出现过发声帧（防止录完即静音的环境被立即判停） */
  private voicedSeen = false;
  /** 训练靶标目标区间（启用时统计达成率） */
  private targetRange: [number, number] | null = null;

  private mediaRecorder: MediaRecorder | null = null;
  private mediaChunks: Blob[] = [];
  /** 录音草稿：音频块在录音中持续写 IDB，崩溃后可恢复 */
  private draftId: string | null = null;
  private mediaChunkIndex = 0;
  /** 切后台 / 页面隐藏时主动催一次 MediaRecorder 数据块，减少崩溃丢失的尾巴 */
  private draftFlushOnPageHide: (() => void) | null = null;
  private draftFlushOnVisibility: (() => void) | null = null;
  /** MediaRecorder.stop() 后数据落盘完成的信号 */
  private mediaStopped: Promise<void> | null = null;

  /** getUserMedia 等待期间为 true（此时可取消启动） */
  private starting = false;
  /** 启动等待期间请求取消：授权返回后中止而不进入录音 */
  private cancelStartRequested = false;

  /** 是否正在录音（含权限等待期间） */
  isRecording(): boolean {
    return this.audioContext !== null || this.starting;
  }

  /** 是否在监听模式（实时元音落点等练习视图，不落记录） */
  isMonitoring(): boolean {
    return this.monitoring;
  }

  /** 是否仍在等待 getUserMedia（可无痕取消） */
  isStarting(): boolean {
    return this.starting;
  }

  /** 取消尚未完成的启动（权限等待期间调用，授权返回后直接释放资源） */
  cancelStart(): void {
    this.cancelStartRequested = true;
  }

  /** 读取实时序列快照（数组仍在增长，图表按需截取） */
  getLive(): LiveSeries {
    return {
      t: this.bufT,
      f0: this.bufF0,
      rmsDb: this.bufDb,
      f1: this.bufF1,
      f2: this.bufF2,
      elapsedSec: this.bufT.length > 0 ? this.bufT[this.bufT.length - 1] : 0,
    };
  }

  /** 最近一帧的检测结果（供右上角实时读数） */
  lastPitch: { freq: number; prob: number } | null = null;

  /**
   * 读取当前频谱幅度（0-255，getByteFrequencyData）填入 out（按 out 长度截取），
   * 返回采样率 Hz；非录音态返回 0（实时频谱图用，与主循环的 getFloatFrequencyData 互不干扰）
   */
  getSpectrum(out: Uint8Array<ArrayBuffer>): number {
    if (!this.analyser || !this.audioContext) return 0;
    this.analyser.getByteFrequencyData(out);
    return this.audioContext.sampleRate;
  }

  /**
   * 语谱行缓冲的实时引用（每帧一行量化频带，行序与 getLive().t 对齐）。
   * 实时声谱图逐帧读取，返回引用避免每帧复制（缓冲仅在头部 splice / 尾部 push）。
   */
  getSpecRows(): { t: number[]; rows: Uint8Array[] } {
    return { t: this.bufT, rows: this.bufSpec };
  }

  /**
   * 建立分析链路：getUserMedia → MediaStreamSource → AnalyserNode。
   * 等待权限期间被取消时释放资源并返回 false；失败向上抛由调用方提示。
   */
  private async setupGraph(ctx: AudioContext, deviceId?: string, micEnhance = false): Promise<boolean> {
    const constraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: false,
        // 增益/降噪默认关闭以采集原始音质；开启后由系统处理，适合灵敏度低的麦克风
        noiseSuppression: micEnhance,
        autoGainControl: micEnhance,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);

    // 等待权限期间被取消：释放资源直接返回
    if (this.cancelStartRequested) {
      stream.getTracks().forEach((tr) => tr.stop());
      void ctx.close();
      return false;
    }

    this.stream = stream;
    this.audioContext = ctx;
    this.source = ctx.createMediaStreamSource(stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = this.timeBuf.length;
    this.analyser.smoothingTimeConstant = 0;
    this.source.connect(this.analyser);
    this.freqBuf = new Float32Array(this.analyser.frequencyBinCount);
    return true;
  }

  /** 释放采集与分析链路 */
  private releaseGraph(): void {
    if (this.draftFlushOnPageHide) {
      document.removeEventListener('pagehide', this.draftFlushOnPageHide);
      this.draftFlushOnPageHide = null;
    }
    if (this.draftFlushOnVisibility) {
      document.removeEventListener('visibilitychange', this.draftFlushOnVisibility);
      this.draftFlushOnVisibility = null;
    }
    this.source?.disconnect();
    this.stream?.getTracks().forEach((tr) => tr.stop());
    this.audioContext?.close();
    this.audioContext = null;
    this.analyser = null;
    this.source = null;
    this.stream = null;
    this.freqBuf = null;
  }

  /** 清空帧缓冲与平滑链，为下一次采集做准备（语谱行归还回收池） */
  private clearBuffers(): void {
    this.bufT = []; this.bufF0 = []; this.bufDb = []; this.bufF1 = []; this.bufF2 = [];
    for (const row of this.bufSpec) this.specPool.push(row);
    this.bufSpec = [];
    this.smoothF1 = null; this.smoothF2 = null;
  }

  /**
   * 启动录音与分析
   * getUserMedia 等待期间 isStarting() 为 true，可通过 cancelStart() 无痕取消；
   * 权限弹窗期间用户切页/停止时，授权返回后直接释放资源，不进入录音循环。
   */
  async start(opts: RecorderOptions = {}): Promise<void> {
    if (this.audioContext || this.starting) return;
    this.starting = true;
    this.cancelStartRequested = false;

    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    try {
      if (!(await this.setupGraph(ctx, opts.deviceId, opts.micEnhance))) return;

      // 音频抓取（可选）：失败不影响分析主链路
      this.mediaRecorder = null;
      this.mediaChunks = [];
      this.mediaStopped = null;
      if (opts.saveAudio !== false) {
        const mimeType = pickAudioMime();
        const track = this.stream?.getAudioTracks()[0];
        const trackSettings = track?.getSettings?.();
        // 码率按设置档位；不适用（如部分浏览器忽略）时由浏览器自行决定
        const bitrate = (opts.audioBitrateKbps ?? 128) * 1000;
        try {
          const mr = new MediaRecorder(this.stream!, {
            ...(mimeType ? { mimeType } : {}),
            // 双声道麦克风实际带宽有限，声道数取 1 省一半体积（混音由解码端单声道取用）
            audioBitsPerSecond: (trackSettings?.channelCount ?? 1) > 1 ? bitrate * 2 : bitrate,
          });
          mr.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
              this.mediaChunks.push(e.data);
              const index = this.mediaChunkIndex++;
              appendRecordingDraftChunk(index, e.data);
            }
          };
          mr.onerror = () => {
            this.mediaRecorder = null;
          };
          this.draftId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
          this.mediaChunkIndex = 0;
          void startRecordingDraft({
            id: this.draftId,
            startedAt: Date.now(),
            mode: opts.mode ?? 'reading',
            mimeType: mr.mimeType || mimeType || 'audio/webm',
            targetRange: opts.targetRange ?? null,
          });
          mr.start(1000);
          this.mediaRecorder = mr;
          const flushDraft = () => {
            if (this.mediaRecorder?.state !== 'recording') return;
            try {
              this.mediaRecorder.requestData();
            } catch {
              // 已停止 / 浏览器不支持：忽略，下一轮 ondataavailable 仍会写入
            }
          };
          this.draftFlushOnPageHide = flushDraft;
          this.draftFlushOnVisibility = () => {
            if (document.visibilityState === 'hidden') flushDraft();
          };
          document.addEventListener('pagehide', this.draftFlushOnPageHide);
          document.addEventListener('visibilitychange', this.draftFlushOnVisibility);
        } catch (err) {
          console.warn('MediaRecorder 不可用，本次不保存音频:', err);
        }
      }

      this.startTime = performance.now();
      this.frameCount = 0;
      this.lastFrameAt = 0;
      this.clearBuffers();
      this.lastPitch = null;
      // 0/未设置 = 不限制：仍钳制到硬性上限，防止缓冲与音频块无界增长
      this.maxDurationSec = opts.maxDurationSec && opts.maxDurationSec > 0
        ? opts.maxDurationSec
        : RECORDING_MAX_SEC;
      this.onAutoStop = opts.onAutoStop ?? null;
      this.autoStopFired = false;
      this.pendingMode = opts.mode;
      this.silenceStopSec = opts.silenceStopSec ?? 0;
      this.lastVoicedAt = 0;
      this.voicedSeen = false;
      this.targetRange = opts.targetRange ?? null;
      // 环境元数据：麦克风标签 + 本地小时（底噪在 loop 开场帧采样）
      const envTrack = this.stream?.getAudioTracks()[0];
      this.pendingEnv = {
        ...(envTrack?.label ? { micLabel: envTrack.label.slice(0, 80) } : {}),
        hourOfDay: new Date().getHours(),
      };
      this.envNoiseSamples = [];

      this.loop();
    } catch (err) {
      // 启动失败（权限拒绝等）：释放已创建的 AudioContext，向上抛出由调用方提示
      void ctx.close().catch(() => undefined);
      throw err;
    } finally {
      this.starting = false;
    }
  }

  /**
   * 启动实时监听（不录音、不抓音频、不生成记录）
   * 供实时元音落点等练习视图使用：说话即见落点，无需保存
   */
  async startMonitor(opts: { deviceId?: string } = {}): Promise<void> {
    if (this.audioContext || this.starting) return;
    this.starting = true;
    this.cancelStartRequested = false;

    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    try {
      if (!(await this.setupGraph(ctx, opts.deviceId))) return;

      this.startTime = performance.now();
      this.frameCount = 0;
      this.lastFrameAt = 0;
      this.clearBuffers();
      this.lastPitch = null;
      this.monitoring = true;
      this.maxDurationSec = 0;
      this.onAutoStop = null;
      this.autoStopFired = false;
      this.pendingMode = undefined;
      this.silenceStopSec = 0;
      this.lastVoicedAt = 0;
      this.voicedSeen = false;
      this.targetRange = null;

      this.loop();
    } catch (err) {
      void ctx.close().catch(() => undefined);
      throw err;
    } finally {
      this.starting = false;
    }
  }

  /** 结束监听模式（仅释放资源，不产生任何记录） */
  stopMonitor(): void {
    if (!this.monitoring) return;
    this.monitoring = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.releaseGraph();
    this.clearBuffers();
    this.lastPitch = null;
  }

  /**
   * 停止录音并生成记录（不含嗓音质量指标，见 finishRecord）
   * @returns 录音有效时长不足 1 秒时返回 null
   */
  stop(): AnalysisRecord | null {
    if (!this.audioContext) return null;

    // 音频收尾：stop 后数据在 onstop 中冲刷完成，finishRecord 中等待
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaStopped = new Promise<void>((resolve) => {
        const mr = this.mediaRecorder as MediaRecorder;
        mr.addEventListener('stop', () => resolve(), { once: true });
        try {
          mr.stop();
        } catch {
          resolve();
        }
      });
    }

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.releaseGraph();

    const series = toRecordSeries(this.bufT, this.bufF0, this.bufDb, this.bufF1, this.bufF2, STORAGE_DECIMATE);
    const durationSec = series.t.length > 0 ? series.t[series.t.length - 1] : 0;
    const specData = toRecordSpec(this.bufSpec, STORAGE_DECIMATE);
    // 清空缓冲，为下次录音做准备
    this.clearBuffers();
    if (durationSec < 1 || series.t.length < 4) {
      this.mediaChunks = [];
      // 不落记录时同步清掉引用，避免残留到下一次 start
      this.mediaRecorder = null;
      this.mediaStopped = null;
      discardRecordingDraft();
      this.draftId = null;
      return null;
    }

    // sampleHz 由全序列时间跨度反推（帧间隔时间戳按 ms 取整，单帧差有 ≈1% 系统偏差）
    const spanSec = series.t.length > 1 ? series.t[series.t.length - 1] - series.t[0] : 0;
    const sampleHz = spanSec > 0 ? (series.t.length - 1) / spanSec : 30;
    const stats = computeStats(series, sampleHz);
    // 训练靶标达成率（未启用时为 undefined）
    const inTargetPct = computeInTargetPct(series, this.targetRange);
    if (inTargetPct != null) stats.inTargetPct = inTargetPct;
    const record: AnalysisRecord = {
      id: (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`),
      createdAt: Date.now(),
      durationSec,
      sampleHz,
      series,
      stats,
      ...(this.pendingMode ? { mode: this.pendingMode } : {}),
      ...(specData ? { spec: { bands: SPEC_BANDS, data: specData } } : {}),
      ...(this.envNoiseSamples.length >= 3
        ? { env: { ...this.pendingEnv, noiseFloorDb: Math.round(Math.min(...this.envNoiseSamples) * 10) / 10 } }
        : (Object.keys(this.pendingEnv).length > 0 ? { env: { ...this.pendingEnv } } : {})),
    };
    this.pendingMode = undefined;
    this.targetRange = null;
    this.pendingEnv = {};
    this.envNoiseSamples = [];
    if (this.draftId) {
      markRecordingDraftRecordId(record.id);
      this.draftId = null;
    }
    return record;
  }

  /**
   * 录音收尾：等待音频数据冲刷，解码 PCM，嗓音质量指标派发到 Worker 计算。
   * 解码失败时保留曲线统计继续落库，仅嗓音质量为空。
   */
  async finishRecord(record: AnalysisRecord): Promise<{ record: AnalysisRecord; audio: Blob | null }> {
    const chunks = this.mediaChunks;
    const mimeType = this.mediaRecorder?.mimeType ?? 'audio/webm';
    this.mediaChunks = [];
    this.mediaRecorder = null;
    if (this.mediaStopped) {
      // 给 MediaRecorder 冲刷留足时间：超时强 Proceed 可能读到不完整音频，
      // 导致嗓音质量指标（尤其 CPPS）失真，宁多等几秒也不算错数
      await Promise.race([this.mediaStopped, new Promise<void>((r) => setTimeout(r, 5000))]);
      this.mediaStopped = null;
    }
    if (chunks.length === 0) return { record, audio: null };

    const blob = new Blob(chunks, { type: mimeType });
    // 解码与嗓音质量分开放置：解码失败只能丢弃音频；质量计算失败时音频完好，
    // 必须保留（回放/重算能力不可逆丢失），仅嗓音质量为空
    let pcm: Float32Array;
    let sampleRate: number;
    try {
      const buf = await blob.arrayBuffer();
      const ctx = new AudioContext();
      let audioBuffer: AudioBuffer;
      try {
        audioBuffer = await ctx.decodeAudioData(buf);
      } finally {
        void ctx.close();
      }
      pcm = audioBuffer.getChannelData(0);
      sampleRate = audioBuffer.sampleRate;
    } catch (err) {
      console.error('录音音频解码失败（仅保留曲线统计落库）:', err);
      return { record, audio: null };
    }
    try {
      const metrics = await runVqMetrics(pcm, sampleRate);
      return {
        record: { ...record, stats: { ...record.stats, ...metrics } },
        audio: blob,
      };
    } catch (err) {
      console.error('嗓音质量计算失败（音频保留，指标为空，可稍后重算）:', err);
      return { record, audio: blob };
    }
  }

    /**
     * 采集与分析主循环（requestAnimationFrame 驱动 + 固定帧间隔节流）
     *
     * 帧率与显示刷新率解耦：rAF 回调按 ANALYSIS_FPS 节流。采用「累进节流」——
     * 通过后 lastFrameAt 前进一个帧间隔而非直接取当前时间：
     * - 60Hz 屏：rAF 间隔 ≈ 帧间隔，几乎每帧都处理（偶发抖动不丢帧）；
     * - 120/144Hz 屏：隔帧处理，计算量与缓冲内存不再随刷新率成倍增长；
     * - clamp 保证切后台等长时间暂停后不追帧。
     */
  private loop = (): void => {
    if (!this.analyser || !this.audioContext || !this.freqBuf) return;
    this.rafId = requestAnimationFrame(this.loop);

    const at = performance.now();
    const frameIntervalMs = 1000 / ANALYSIS_FPS;
    if (at - this.lastFrameAt < frameIntervalMs) return;
    this.lastFrameAt = Math.max(this.lastFrameAt + frameIntervalMs, at - frameIntervalMs);

    // 最长时长自动停止
    if (this.maxDurationSec > 0 && !this.autoStopFired) {
      const elapsed = (performance.now() - this.startTime) / 1000;
      if (elapsed >= this.maxDurationSec) {
        this.autoStopFired = true;
        this.onAutoStop?.();
        return;
      }
    }

    this.analyser.getFloatTimeDomainData(this.timeBuf);
    const db = rmsDb(this.timeBuf);
    const now = (performance.now() - this.startTime) / 1000;

    // 环境底噪采样：开场 0.6s 内（通常尚未开口）收集帧电平，取最小值近似底噪
    if (now < 0.6 && this.envNoiseSamples.length < 64) {
      this.envNoiseSamples.push(db);
    }

    // 静音自动停止（长音模式）：首次发声后，持续静音达到阈值即结束，
    // 不再硬性截断，保证 MPT（最长声时）测量完整
    const algo = getAlgoParams();
    if (this.silenceStopSec > 0 && !this.autoStopFired) {
      if (db > algo.activeGateDb) {
        this.voicedSeen = true;
        this.lastVoicedAt = now;
      } else if (this.voicedSeen && now - this.lastVoicedAt >= this.silenceStopSec) {
        this.autoStopFired = true;
        this.onAutoStop?.();
        return;
      }
    }

    // 音高（每帧，算法跟随设置：yin / pyin / mpm，见 pitchAlt.ts；
    // 搜索范围与发声门限为实验性可调参数，见 algoParams）
    const { pitchMinHz, pitchMaxHz, voicedGateDb } = algo;
    const pitch = db > voicedGateDb
      ? detectPitch(this.timeBuf, this.audioContext.sampleRate, pitchMinHz, pitchMaxHz, getPitchAlgorithm())
      : null;
    this.lastPitch = pitch ? { freq: pitch.freq, prob: pitch.prob } : null;

    // 共振峰（每 2 帧一次，带指数平滑）
    if (this.frameCount % FORMANT_EVERY === 0 && pitch) {
      const raw = extractFormants(this.timeBuf, this.audioContext.sampleRate, db);
      // 指数平滑减少帧间抖动
      this.smoothF1 = raw.f1 != null ? (this.smoothF1 ?? raw.f1) * 0.45 + raw.f1 * 0.55 : null;
      this.smoothF2 = raw.f2 != null ? (this.smoothF2 ?? raw.f2) * 0.45 + raw.f2 * 0.55 : null;
    } else if (!pitch) {
      // 无声帧打断平滑链，避免跨哑音段拉直线
      this.smoothF1 = null;
      this.smoothF2 = null;
    }

    // 语谱频带（每帧）：行从回收池取，避免每帧分配
    this.analyser.getFloatFrequencyData(this.freqBuf);
    const row = this.specPool.pop() ?? new Uint8Array(SPEC_BANDS);
    const binHz = this.audioContext.sampleRate / (this.freqBuf.length * 2);
    spectrumRowToBands(this.freqBuf, binHz, row);

    this.bufT.push(now);
    this.bufF0.push(pitch ? pitch.freq : NaN);
    this.bufDb.push(db);
    this.bufF1.push(this.smoothF1 ?? NaN);
    this.bufF2.push(this.smoothF2 ?? NaN);
    this.bufSpec.push(row);
    this.frameCount++;

    // 监听模式：缓冲封顶（保留最新约 2 分钟），长时间练习不无限增长
    if (this.monitoring && this.bufT.length > MONITOR_BUFFER_FRAMES) {
      const drop = this.bufT.length - MONITOR_BUFFER_FRAMES;
      this.bufT.splice(0, drop);
      this.bufF0.splice(0, drop);
      this.bufDb.splice(0, drop);
      this.bufF1.splice(0, drop);
      this.bufF2.splice(0, drop);
      for (const dropped of this.bufSpec.splice(0, drop)) this.specPool.push(dropped);
    }
  };
}

/** 全局唯一录音引擎实例 */
export const recorder = new VoiceRecorder();
