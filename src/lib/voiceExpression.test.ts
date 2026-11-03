import { describe, it, expect } from 'vitest';
import {
  VOICE_EXPRESSION_ANCHORS,
  computeVoiceExpression,
  pitchReferenceScore,
  resonanceReferenceScoreF2,
  resonanceReferenceScoreGap,
  voiceExpressionZone,
} from './voiceExpression';

describe('pitchReferenceScore', () => {
  it('把 165 Hz 作为中性中心（50 分）', () => {
    expect(pitchReferenceScore(165)).toBeCloseTo(50, 6);
  });

  it('与感知锚点一致：130 偏男、180 偏女、220 接近满分', () => {
    expect(pitchReferenceScore(130)).toBeLessThan(20);
    expect(pitchReferenceScore(145)).toBeGreaterThan(25);
    expect(pitchReferenceScore(145)).toBeLessThan(35);
    expect(pitchReferenceScore(180)).toBeGreaterThan(60);
    expect(pitchReferenceScore(220)).toBeGreaterThan(90);
  });

  it('单调递增并钳制在 0–100', () => {
    let prev = -1;
    for (const hz of [60, 85, 100, 130, 165, 180, 220, 300, 500]) {
      const s = pitchReferenceScore(hz);
      expect(s).toBeGreaterThanOrEqual(prev);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
      prev = s;
    }
    expect(pitchReferenceScore(-100)).toBeLessThan(0.01);
    expect(pitchReferenceScore(10_000)).toBeGreaterThan(99.99);
  });
});

describe('resonanceReferenceScore*', () => {
  it('F2−F1 的 1000 Hz 参考线约 75 分，800 Hz 约 25 分', () => {
    expect(resonanceReferenceScoreGap(1000)).toBeGreaterThan(70);
    expect(resonanceReferenceScoreGap(1000)).toBeLessThan(80);
    expect(resonanceReferenceScoreGap(800)).toBeGreaterThan(20);
    expect(resonanceReferenceScoreGap(800)).toBeLessThan(30);
  });

  it('平均 F2 退路：1900 Hz 偏女、1500 Hz 偏男', () => {
    expect(resonanceReferenceScoreF2(1900)).toBeGreaterThan(75);
    expect(resonanceReferenceScoreF2(1500)).toBeLessThan(25);
  });
});

describe('voiceExpressionZone', () => {
  it('三档边界：33 / 67', () => {
    expect(voiceExpressionZone(0)).toBe('masculine');
    expect(voiceExpressionZone(32)).toBe('masculine');
    expect(voiceExpressionZone(33)).toBe('neutral');
    expect(voiceExpressionZone(66)).toBe('neutral');
    expect(voiceExpressionZone(67)).toBe('feminine');
    expect(voiceExpressionZone(100)).toBe('feminine');
  });
});

describe('computeVoiceExpression', () => {
  const base = { medianF0: 165, f2f1GapHz: 1000, avgF2: 1900, voicedSamples: 900, sampleHz: 30 };

  it('按 55% 音高 + 45% 共鸣合成', () => {
    const r = computeVoiceExpression(base);
    expect(r).not.toBeNull();
    if (!r) return;
    const expected = Math.round(
      pitchReferenceScore(165) * VOICE_EXPRESSION_ANCHORS.pitchWeight
      + resonanceReferenceScoreGap(1000) * VOICE_EXPRESSION_ANCHORS.resonanceWeight,
    );
    expect(r.score).toBe(expected);
    expect(r.resonanceBasis).toBe('gap');
    expect(r.voicedSeconds).toBeCloseTo(30, 6);
    expect(r.confidence).toBe('high');
  });

  it('F2−F1 缺失时退回平均 F2', () => {
    const r = computeVoiceExpression({ ...base, f2f1GapHz: null });
    expect(r?.resonanceBasis).toBe('f2');
    expect(r?.resonanceScore).toBe(Math.round(resonanceReferenceScoreF2(1900)));
  });

  it('共振峰全缺失时只按音高，且不伪造共鸣分', () => {
    const r = computeVoiceExpression({ ...base, f2f1GapHz: null, avgF2: null });
    expect(r?.resonanceBasis).toBeNull();
    expect(r?.resonanceScore).toBeNull();
    expect(r?.score).toBe(Math.round(pitchReferenceScore(165)));
  });

  it('不打分的输入返回 null', () => {
    expect(computeVoiceExpression({ ...base, medianF0: 0 })).toBeNull();
    expect(computeVoiceExpression({ ...base, voicedSamples: 0 })).toBeNull();
    expect(computeVoiceExpression({ ...base, sampleHz: 0 })).toBeNull();
  });

  it('样本时长决定置信度', () => {
    expect(computeVoiceExpression({ ...base, voicedSamples: 30, sampleHz: 30 })?.confidence).toBe('low');
    expect(computeVoiceExpression({ ...base, voicedSamples: 150, sampleHz: 30 })?.confidence).toBe('medium');
    expect(computeVoiceExpression({ ...base, voicedSamples: 300, sampleHz: 30 })?.confidence).toBe('high');
  });

  it('典型男声 / 女声落在各自参考区', () => {
    const male = computeVoiceExpression({ ...base, medianF0: 120, f2f1GapHz: 800 });
    const female = computeVoiceExpression({ ...base, medianF0: 210, f2f1GapHz: 1100 });
    expect(male?.zone).toBe('masculine');
    expect(female?.zone).toBe('feminine');
  });
});
