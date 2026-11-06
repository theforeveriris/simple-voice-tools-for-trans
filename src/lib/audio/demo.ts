/**
 * 示例录音数据生成器
 * 在没有麦克风的环境下（或首次体验时）生成一段合成的人声风格数据，
 * 用于演示分析页与历史页。统计信息走与真实录音完全相同的 computeStats，
 * 语谱与嗓音质量指标为合成值，保证分析页所有图表都有内容可看。
 */

import { computeStats } from './recorder';
import { SPEC_BANDS, SPEC_FMIN, SPEC_FMAX, SPEC_DB_MIN, SPEC_DB_MAX } from '@/constants';
import { base64FromBytes, dbToU8 } from './spectrogram';
import type { AnalysisRecord, RecordSeries } from '@/types';

/** 生成一段约 14 秒的示例记录（30Hz 采样） */
export function createDemoRecord(): AnalysisRecord {
  const hz = 30;
  const dur = 14;
  const n = hz * dur;
  const series: RecordSeries = { t: [], f0: [], rmsDb: [], f1: [], f2: [] };
  const specRows: Uint8Array[] = [];

  let voiced = true;
  let segEnd = 1.2;
  let rand = 1;
  const rnd = () => {
    // 确定性伪随机（mulberry32），保证示例稳定
    rand |= 0; rand = (rand + 0x6d2b79f5) | 0;
    let x = Math.imul(rand ^ (rand >>> 15), 1 | rand);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };

  for (let i = 0; i < n; i++) {
    const t = i / hz;
    if (t >= segEnd) {
      voiced = !voiced;
      segEnd = t + (voiced ? 1.5 + rnd() * 2.2 : 0.4 + rnd() * 0.7);
    }

    series.t.push(Math.round(t * 1000) / 1000);

    let f0: number | null = null;
    const row = new Uint8Array(SPEC_BANDS);
    if (voiced) {
      const base = 128 + 34 * Math.sin(t / 3.1) + 10 * Math.sin(t / 1.3);
      const vibrato = 4.5 * Math.sin(2 * Math.PI * 5.2 * t);
      const drift = 6 * Math.sin(t / 0.9 + 2);
      f0 = Math.round((base + vibrato + drift + rnd() * 3) * 10) / 10;
      series.f0.push(f0);
      series.rmsDb.push(Math.round((-26 + 6 * Math.sin(t / 2.2) + rnd() * 3) * 10) / 10);
      series.f1.push(Math.round(380 + 190 * Math.sin(t / 2.4) + rnd() * 40));
      series.f2.push(Math.round(1250 + 480 * Math.sin(t / 3.3 + 1) + rnd() * 90));

      // 合成语谱：以 f0 为基频的谐波列 + 共振峰包络增亮 + 噪声底
      for (let b = 0; b < SPEC_BANDS; b++) {
        const freq = SPEC_FMIN * Math.pow(SPEC_FMAX / SPEC_FMIN, b / (SPEC_BANDS - 1));
        const harm = Math.abs(Math.log2(freq / Math.max(f0, 60))) % 1;
        const harmonicLevel = harm < 0.06 || harm > 0.94 ? -22 - 8 * Math.log2(freq / 500) : -60;
        const f1Boost = -10 * Math.exp(-Math.pow((freq - 500) / 260, 2));
        const f2Boost = -12 * Math.exp(-Math.pow((freq - 1400) / 500, 2));
        row[b] = dbToU8(harmonicLevel + f1Boost + f2Boost + rnd() * 8);
      }
    } else {
      series.f0.push(null);
      series.rmsDb.push(Math.round((-62 + rnd() * 6) * 10) / 10);
      series.f1.push(null);
      series.f2.push(null);
      for (let b = 0; b < SPEC_BANDS; b++) {
        row[b] = Math.round(Math.max(0, Math.min(1, (-78 + rnd() * 8 - SPEC_DB_MIN) / (SPEC_DB_MAX - SPEC_DB_MIN))) * 255);
      }
    }
    specRows.push(row);
  }

  const flat = new Uint8Array(specRows.length * SPEC_BANDS);
  for (let r = 0; r < specRows.length; r++) flat.set(specRows[r], r * SPEC_BANDS);

  const stats = computeStats(series, hz);
  return {
    id: `demo-${Date.now()}`,
    createdAt: Date.now(),
    // 与系列/统计同源（真实路径一律取 series 末帧时间），避免时长对不上
    durationSec: stats.durationSec,
    sampleHz: hz,
    series,
    stats: {
      ...stats,
      jitterPct: 0.72,
      shimmerPct: 3.4,
      hnrDb: 15.8,
      cppsDb: 14.2,
      // 谱类指标：与上面的 HNR/CPPS 口径一致的合成值，保证示例记录四组指标都有内容
      h1h2Db: 7.4,
      h2h4Db: 5.1,
      h1a3Db: 19.6,
      breathiness: 0.32,
      nasalityDb: -10.8,
    },
    mode: 'reading',
    spec: { bands: SPEC_BANDS, data: base64FromBytes(flat) },
  };
}
