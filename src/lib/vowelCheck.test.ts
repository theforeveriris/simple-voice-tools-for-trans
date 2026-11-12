import { describe, expect, it } from 'vitest';
import type { RecordSeries } from '@/types';
import { MANDARIN_VOWELS } from './mandarinVowels';
import { detectSustainedVowel } from './vowelCheck';

function makeSeries(
  f1: number,
  f2: number,
  { f0 = 140, seconds = 3, hz = 30 }: { f0?: number; seconds?: number; hz?: number } = {},
): RecordSeries {
  const n = Math.round(seconds * hz);
  return {
    t: Array.from({ length: n }, (_, i) => i / hz),
    f0: Array.from({ length: n }, () => f0),
    rmsDb: Array.from({ length: n }, () => -20),
    f1: Array.from({ length: n }, () => f1),
    f2: Array.from({ length: n }, () => f2),
  };
}

describe('detectSustainedVowel', () => {
  it('六个主元音的男女参考点都能被判回自己', () => {
    for (const ref of MANDARIN_VOWELS) {
      for (const sex of ['male', 'female'] as const) {
        const r = detectSustainedVowel(makeSeries(ref[sex].f1, ref[sex].f2));
        expect(r.segment.enough, `${ref.code}-${sex}`).toBe(true);
        expect(r.best?.code, `${ref.code}-${sex}`).toBe(ref.code);
        expect(r.confidence, `${ref.code}-${sex}`).not.toBe('low');
        expect(r.confidence, `${ref.code}-${sex}`).not.toBe('none');
      }
    }
  });

  it('落在男性 / 女性参考均值 → position ≈ ∓1', () => {
    const a = MANDARIN_VOWELS.find((v) => v.code === 'a')!;
    expect(detectSustainedVowel(makeSeries(a.male.f1, a.male.f2)).position).toBeLessThan(-0.99);
    expect(detectSustainedVowel(makeSeries(a.female.f1, a.female.f2)).position).toBeGreaterThan(0.99);
  });

  it('两个元音中间 → 低置信并给出两个候选', () => {
    const e = MANDARIN_VOWELS.find((v) => v.code === 'e')!;
    const u = MANDARIN_VOWELS.find((v) => v.code === 'u')!;
    const r = detectSustainedVowel(
      makeSeries(Math.sqrt(e.male.f1 * u.male.f1), Math.sqrt(e.male.f2 * u.male.f2)),
    );
    expect(r.segment.enough).toBe(true);
    expect(r.confidence).toBe('low');
    expect(r.best?.code).not.toBe(r.second?.code);
    expect([r.best?.code, r.second?.code].sort()).toEqual(['o', 'u']);
  });

  it('样本不足时返回 enough=false / best=null', () => {
    const r = detectSustainedVowel(makeSeries(795, 1168, { seconds: 0.2 }));
    expect(r.segment.enough).toBe(false);
    expect(r.best).toBeNull();
    expect(r.confidence).toBe('none');
  });

  it('忽略起音 / 收音的异常段，只取中段', () => {
    const series = makeSeries(795, 1168);
    for (let i = 0; i < 15; i++) {
      series.f1[i] = 300;
      series.f2[i] = 2400;
      series.f1[series.f1.length - 1 - i] = 300;
      series.f2[series.f2.length - 1 - i] = 2400;
    }
    const r = detectSustainedVowel(series);
    expect(r.segment.enough).toBe(true);
    expect(r.best?.code).toBe('a');
  });

  it('允许偶发丢帧（连续 2 帧缺失）', () => {
    const series = makeSeries(795, 1168);
    series.f1[40] = null;
    series.f1[41] = null;
    series.f2[40] = null;
    series.f2[41] = null;
    const r = detectSustainedVowel(series);
    expect(r.segment.enough).toBe(true);
    expect(r.best?.code).toBe('a');
  });

  it('缺少 F0 的帧不参与', () => {
    const series = makeSeries(795, 1168);
    for (let i = 0; i < series.f0.length; i++) series.f0[i] = null;
    const r = detectSustainedVowel(series);
    expect(r.segment.enough).toBe(false);
    expect(r.segment.totalFrames).toBe(0);
  });

  it('恒定输入 → spread = 0 且 stable', () => {
    const r = detectSustainedVowel(makeSeries(952, 1371));
    expect(r.segment.spread).toBe(0);
    expect(r.segment.stable).toBe(true);
  });

  it('离所有参考都太远 → 不强行匹配', () => {
    const r = detectSustainedVowel(makeSeries(2000, 3000));
    expect(r.segment.enough).toBe(true);
    expect(r.confidence).toBe('none');
    expect(r.best).not.toBeNull();
    expect(r.distance).toBeGreaterThan(0.35);
  });
});
