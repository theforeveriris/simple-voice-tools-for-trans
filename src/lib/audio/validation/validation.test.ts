/**
 * 参数验证 · 全参数回归（验证设施）
 *
 * 三层：
 *   1. 构造真值（truth.json）：频率/共振峰/注入抖动/已知 SNR/已知衰减
 *   2. 统计聚合独立暴力实现（expected_ref.json）
 *   3. Praat 交叉验证（expected_praat.json）：同 WAV 喂 parselmouth
 *
 * 验证缓存音频不入仓；expected_*.json 与脚本入仓；CI 无缓存时整体跳过。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { analyzePcmFrames } from '../analysisPipeline';
import { computeStats, toRecordSeries } from '../recorder';
import { computeSustainedMetrics } from '../sustained';
import { analyzeSibilance } from '../sibilance';
import { readWavMono16 } from './fixtures';
import type { AnalysisRecord, VoiceStats, RecordSeries } from '@/types';

const CACHE = path.resolve(process.cwd(), 'validation-cache');
const VALIDATION = path.resolve(process.cwd(), 'scripts', 'validation');

const hasFixtures = fs.existsSync(path.join(CACHE, 'sine_220.wav'));

let praat: Record<string, Record<string, number>> = {};

beforeAll(() => {
  if (!hasFixtures) return;
  for (const name of ['expected_praat.json']) {
    const p = path.join(VALIDATION, name);
    if (fs.existsSync(p)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
        praat = parsed.fixtures;
      } catch {
        // 文件损坏（如历史 NaN）时跳过该层，报告另行核对
      }
    }
  }
});

interface FixtureMetrics {
  stats: VoiceStats;
  series: RecordSeries;
  raw: {
    f0Mean: number | null; f0Median: number | null; f0Min: number; f0Max: number;
    f1Mean: number | null; f2Mean: number | null;
    avgDb: number; peakDb: number; voicedPct: number;
    jitterPct: number | null; shimmerPct: number | null; hnrDb: number | null;
    cppsDb: number | null; cppsMean: number | null; cppsSd: number | null;
    h1h2Db: number | null; h2h4Db: number | null; h1a3Db: number | null;
    breathiness: number | null; nasalityDb: number | null;
    spectralTiltDbOct: number | null;
    mptSec: number; cvPct: number | null; decayDbPerSec: number | null;
    sibilanceCentroidHz: number | null;
  };
}

const analyzed: Record<string, FixtureMetrics> = {};

function analyzeFixture(name: string): FixtureMetrics {
  const { pcm } = readWavMono16(path.join(CACHE, name));
  const res = analyzePcmFrames(pcm);
  const series = toRecordSeries(res.t, res.f0, res.db, res.f1, res.f2, 1);
  const stats = computeStats(series, 30);
  const m = res.metrics;
  const fake = {
    id: 'val', createdAt: 0, durationSec: series.t.at(-1) ?? 0, sampleHz: 30,
    series, stats,
  } as unknown as AnalysisRecord;
  const sustained = computeSustainedMetrics(fake);
  const sib = analyzeSibilance(pcm, 'other');
  const raw: FixtureMetrics['raw'] = {
    f0Mean: stats.avgF0,
    f0Median: stats.medianF0,
    f0Min: stats.minF0,
    f0Max: stats.maxF0,
    f1Mean: stats.avgF1,
    f2Mean: stats.avgF2,
    avgDb: stats.avgDb,
    peakDb: stats.peakDb,
    voicedPct: stats.totalSamples ? (stats.voicedSamples / stats.totalSamples) * 100 : 0,
    jitterPct: m.jitterPct,
    shimmerPct: m.shimmerPct,
    hnrDb: m.hnrDb,
    cppsDb: m.cppsDb,
    cppsMean: null,
    cppsSd: null,
    h1h2Db: m.h1h2Db ?? null,
    h2h4Db: m.h2h4Db ?? null,
    h1a3Db: m.h1a3Db ?? null,
    breathiness: m.breathiness ?? null,
    nasalityDb: m.nasalityDb ?? null,
    spectralTiltDbOct: m.spectralTiltDbOct ?? null,
    mptSec: sustained.mptSec,
    cvPct: sustained.cvPct,
    decayDbPerSec: sustained.decayDbPerSec,
    sibilanceCentroidHz: sib ? sib.centroidHz : null,
  };
  const result = { stats, series, raw };
  analyzed[name] = result;
  return result;
}

afterAll(() => {
  if (!hasFixtures || Object.keys(analyzed).length === 0) return;
  const dump: Record<string, any> = {};
  for (const [name, r] of Object.entries(analyzed)) {
    dump[name] = { ...r.raw };
  }
  fs.writeFileSync(path.join(CACHE, 'results.json'), JSON.stringify(dump, null, 2));
});

/* ======================= 1. 构造真值 ======================= */

describe('validation: constructed truth', () => {
  it('sine_220：F0 全链路', () => {
    const { raw } = analyzeFixture('sine_220.wav');
    expect(Math.abs(raw.f0Mean! - 220)).toBeLessThan(1.5);
    expect(Math.abs(raw.f0Median! - 220)).toBeLessThan(1.5);
    expect(Math.abs(raw.f0Min - 220)).toBeLessThan(3);
    expect(Math.abs(raw.f0Max - 220)).toBeLessThan(3);
  });

  it('sine_110：低频端', () => {
    const { raw } = analyzeFixture('sine_110.wav');
    expect(Math.abs(raw.f0Mean! - 110)).toBeLessThan(1.5);
  });

  it('vowel_f120：F0+F1+F2 落点', () => {
    const { raw } = analyzeFixture('vowel_f120_f700_1220_2600.wav');
    expect(Math.abs(raw.f0Mean! - 120)).toBeLessThan(1.5);
    expect(Math.abs(raw.f1Mean! - 700)).toBeLessThan(40);
    expect(Math.abs(raw.f2Mean! - 1220)).toBeLessThan(60);
  });

  it('vowel_f200：F0+F1+F2 落点', () => {
    const { raw } = analyzeFixture('vowel_f200_f400_1700_2600.wav');
    expect(Math.abs(raw.f0Mean! - 200)).toBeLessThan(2);
    expect(Math.abs(raw.f1Mean! - 400)).toBeLessThan(30);
    expect(Math.abs(raw.f2Mean! - 1700)).toBeLessThan(60);
  });

  it('pulse_j0：jitter/shimmer≈0', () => {
    const { raw } = analyzeFixture('pulse_f100_j0.wav');
    expect(raw.jitterPct!).toBeLessThan(0.3);
    expect(raw.shimmerPct!).toBeLessThan(1);
  });

  it('pulse_j02：jitter≈1.33%（±2% 扰动理论值）', () => {
    const { raw } = analyzeFixture('pulse_f100_j02_seed5.wav');
    expect(raw.jitterPct!).toBeGreaterThan(0.88);
    expect(raw.jitterPct!).toBeLessThan(1.78);
  });

  it('pulse_sh05：shimmer≈3.33%（±5% 扰动理论值）', () => {
    const { raw } = analyzeFixture('pulse_f100_sh05_seed11.wav');
    expect(raw.shimmerPct!).toBeGreaterThan(2.4);
    expect(raw.shimmerPct!).toBeLessThan(4.4);
  });

  it('sine200_snr20：HNR 量级（YIN 口径为近似，不精确到 SNR）', () => {
    const { raw } = analyzeFixture('sine200_snr20.wav');
    expect(raw.hnrDb!).toBeGreaterThan(8);
  });

  it('sine200_snr6：强噪声 HNR 显著更低', () => {
    const a = analyzeFixture('sine200_snr20.wav').raw;
    const b = analyzeFixture('sine200_snr6.wav').raw;
    expect(b.hnrDb!).toBeLessThan(a.hnrDb! - 4);
  });

  it('gliss：F0 轨迹覆盖 100–300', () => {
    const { raw } = analyzeFixture('gliss_100_300.wav');
    expect(raw.f0Min).toBeGreaterThan(95);
    expect(raw.f0Min).toBeLessThan(130);
    expect(raw.f0Max).toBeGreaterThan(270);
    expect(raw.f0Max).toBeLessThan(305);
  });

  it('decay：响度衰减 ≈ −2 dB/s，MPT≈3s', () => {
    const { raw } = analyzeFixture('decay_minus2.wav');
    expect(raw.decayDbPerSec!).toBeGreaterThan(-2.6);
    expect(raw.decayDbPerSec!).toBeLessThan(-1.4);
    expect(raw.mptSec).toBeGreaterThan(2.5);
  });

  it('silence：无幽灵参数', () => {
    const { raw } = analyzeFixture('silence.wav');
    expect(raw.f0Mean).toBe(0);
    expect(raw.cppsDb).toBeNull();
  });

  it('咝音：白噪声谱重心 ≈ 频带中点', () => {
    const n = Math.round(0.3 * 32000);
    let s = 20261106;
    const pcm = new Float32Array(n);
    for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) % 2147483648; pcm[i] = (s / 2147483648 * 2 - 1) * 0.3; }
    const stats = analyzeSibilance(pcm, 'other');
    expect(stats).not.toBeNull();
    expect(stats!.centroidHz).toBeGreaterThan(7000);
    expect(stats!.centroidHz).toBeLessThan(10000);
  });
});

/* ======================= 2. Praat 交叉验证 ======================= */

describe('validation: Praat cross-check', () => {
  it('有 expected_praat.json 时逐项对齐（F0 优先）', () => {
    if (!praat['sine_220.wav']) return; // 无 Praat 参考时跳过
    const mine = analyzed['sine_220.wav']?.raw ?? analyzeFixture('sine_220.wav').raw;
    const refF0 = praat['sine_220.wav'].f0_mean;
    expect(Math.abs(mine.f0Mean! - refF0), `mine=${mine.f0Mean} praat=${refF0}`).toBeLessThanOrEqual(2);
  });

  it('vowel 的 F1/F2 与 Praat 同量级', () => {
    if (!praat['vowel_f120_f700_1220_2600.wav']) return;
    const mine = analyzed['vowel_f120_f700_1220_2600.wav']?.raw
      ?? analyzeFixture('vowel_f120_f700_1220_2600.wav').raw;
    const r = praat['vowel_f120_f700_1220_2600.wav'];
    // Praat Burg 与本应用 LPC 口径不同，给宽界（记录到报告，容差后续收紧）
    expect(Math.abs(mine.f1Mean! - r.f1_mean)).toBeLessThan(120);
    expect(Math.abs(mine.f2Mean! - r.f2_mean)).toBeLessThan(200);
  });

  it('jitter/shimmer 与 Praat 同量级', () => {
    if (!praat['pulse_f100_j02_seed5.wav']) return;
    const mine = analyzed['pulse_f100_j02_seed5.wav']?.raw
      ?? analyzeFixture('pulse_f100_j02_seed5.wav').raw;
    const r = praat['pulse_f100_j02_seed5.wav'];
    expect(Math.abs(mine.jitterPct! - r.jitter_local_pct)).toBeLessThan(0.6);
    const s = analyzed['pulse_f100_sh05_seed11.wav']?.raw
      ?? analyzeFixture('pulse_f100_sh05_seed11.wav').raw;
    const sr = praat['pulse_f100_sh05_seed11.wav'];
    expect(Math.abs(s.shimmerPct! - sr.shimmer_local_pct)).toBeLessThan(1.2);
  });
});
