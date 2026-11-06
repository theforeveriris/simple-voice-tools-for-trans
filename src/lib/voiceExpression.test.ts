import { describe, it, expect } from 'vitest';
import {
  VOICE_EXPRESSION_ANCHORS,
  VOWEL_REFS_H95,
  computeVoiceExpression,
  normalizeVowels,
  pitchReferenceScore,
  voiceExpressionZone,
  type VoiceExpressionFrame,
} from './voiceExpression';

describe('pitchReferenceScore', () => {
  it('锚点与卡片参考表一致：130 Hz → 33 分、180 Hz → 67 分（恰在三档边界）', () => {
    expect(pitchReferenceScore(130)).toBeCloseTo(33, 0);
    expect(pitchReferenceScore(180)).toBeCloseTo(67, 0);
  });

  it('中性带 145–175 Hz 落在 33–67 之间（不再自相矛盾）', () => {
    expect(pitchReferenceScore(145)).toBeGreaterThan(33);
    expect(pitchReferenceScore(145)).toBeLessThan(67);
    expect(pitchReferenceScore(175)).toBeGreaterThan(33);
    expect(pitchReferenceScore(175)).toBeLessThan(67);
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
    expect(pitchReferenceScore(-100)).toBeLessThan(1);
    expect(pitchReferenceScore(10_000)).toBeGreaterThan(99.99);
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

/** 造一段落点：某个参考元音的男性参考值 */
function maleFrames(code: string, n = 30, durationSec = 1 / 30): VoiceExpressionFrame[] {
  const ref = VOWEL_REFS_H95.find((v) => v.code === code);
  if (!ref) throw new Error(`no ref ${code}`);
  return Array.from({ length: n }, () => ({ f1: ref.male.f1, f2: ref.male.f2, durationSec }));
}

function femaleFrames(code: string, n = 30, durationSec = 1 / 30): VoiceExpressionFrame[] {
  const ref = VOWEL_REFS_H95.find((v) => v.code === code);
  if (!ref) throw new Error(`no ref ${code}`);
  return Array.from({ length: n }, () => ({ f1: ref.female.f1, f2: ref.female.f2, durationSec }));
}

// 说明：「声道整体缩放」会同时改变 F1/F2，落点就会离开某个具体元音的
// 参考点，语义上不再是「同一个元音、只是声道更长」。
// 因此这里不把缩放当作尺度不变性的证据——尺度无关性由
// 「说的是哪个元音不影响结果」这一组用例覆盖（见上）。

describe('元音归一（normalizeVowels）', () => {
  it('把落点归到正确的参考元音', () => {
    const { breakdown } = normalizeVowels([
      ...maleFrames('IY'),
      ...maleFrames('UW'),
      ...maleFrames('AA'),
    ]);
    const codes = breakdown.map((b) => b.code).sort();
    expect(codes).toEqual(['AA', 'IY', 'UW']);
  });

  it('落在男性参考 → 位置接近 −1；落在女性参考 → 接近 +1', () => {
    for (const code of ['IY', 'AA', 'UW']) {
      const m = normalizeVowels(maleFrames(code)).breakdown[0];
      const w = normalizeVowels(femaleFrames(code)).breakdown[0];
      expect(m.position).toBeLessThan(-0.9);
      expect(w.position).toBeGreaterThan(0.9);
    }
  });

  it('剔除非法帧（F1/F2 非正、次序反了）', () => {
    const { breakdown, totalFrames } = normalizeVowels([
      { f1: 0, f2: 2000 },
      { f1: 400, f2: 0 },
      { f1: 2000, f2: 400 },
      { f1: NaN, f2: 2000 },
      { f1: 400, f2: 2000 },
    ]);
    expect(totalFrames).toBe(1);
    expect(breakdown).toHaveLength(1);
  });

  it('全部 12 个男性参考点都落在 −1 附近（与说的是哪个元音无关）', () => {
    for (const ref of VOWEL_REFS_H95) {
      const b = normalizeVowels(maleFrames(ref.code)).breakdown[0];
      expect(b.position).toBeLessThan(-0.9);
    }
  });

  it('全部 12 个女性参考点都落在 +1 附近', () => {
    for (const ref of VOWEL_REFS_H95) {
      const b = normalizeVowels(femaleFrames(ref.code)).breakdown[0];
      expect(b.position).toBeGreaterThan(0.9);
    }
  });

  it('说的是不同元音时，落在同一性别参考上得到同样的位置', () => {
    const onlyI = normalizeVowels(maleFrames('IY')).breakdown[0].position;
    const onlyU = normalizeVowels(maleFrames('UW')).breakdown[0].position;
    expect(Math.abs(onlyI - onlyU)).toBeLessThan(0.05);
  });
});

describe('computeVoiceExpression（元音归一版）', () => {
  const base = { medianF0: 165, voicedSamples: 900, sampleHz: 30 };

  it('按 55% 音高 + 45% 共鸣合成', () => {
    const r = computeVoiceExpression({ ...base, frames: maleFrames('AA') });
    expect(r).not.toBeNull();
    if (!r) return;
    const expected = Math.round(
      pitchReferenceScore(165) * VOICE_EXPRESSION_ANCHORS.pitchWeight
      + (r.resonanceScore ?? 0) * VOICE_EXPRESSION_ANCHORS.resonanceWeight,
    );
    expect(r.score).toBe(expected);
    expect(r.voicedSeconds).toBeCloseTo(30, 6);
    expect(r.confidence).toBe('high');
  });

  it('男性参考落点 → 共鸣分偏低；女性参考落点 → 偏高', () => {
    const m = computeVoiceExpression({ ...base, frames: maleFrames('AA') });
    const w = computeVoiceExpression({ ...base, frames: femaleFrames('AA') });
    expect(m?.resonanceScore).toBeLessThan(30);
    expect(w?.resonanceScore).toBeGreaterThan(70);
  });

  it('元音归一后，同样的性别参考落点给同样的分（与说的是哪个元音无关）', () => {
    const i = computeVoiceExpression({ ...base, frames: maleFrames('IY') });
    const u = computeVoiceExpression({ ...base, frames: maleFrames('UW') });
    expect(i?.resonanceScore).toBe(u?.resonanceScore);
    expect(i?.score).toBe(u?.score);
  });

  it('没有逐帧共振峰时只按音高，不伪造共鸣分', () => {
    const r = computeVoiceExpression({ ...base, frames: null });
    expect(r?.resonanceScore).toBeNull();
    expect(r?.score).toBe(Math.round(pitchReferenceScore(165)));
    expect(r?.normalizedFrames).toBe(0);
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
    const male = computeVoiceExpression({ ...base, medianF0: 120, frames: maleFrames('AA') });
    const female = computeVoiceExpression({ ...base, medianF0: 210, frames: femaleFrames('AA') });
    expect(male?.zone).toBe('masculine');
    expect(female?.zone).toBe('feminine');
  });

  it('明细按时长倒序，元音贡献可追溯', () => {
    const r = computeVoiceExpression({
      ...base,
      frames: [...maleFrames('AA', 10), ...maleFrames('IY', 40)],
    });
    expect(r?.breakdown.length).toBe(2);
    expect(r?.breakdown[0].code).toBe('IY');
    expect(r?.breakdown[0].seconds).toBeGreaterThan(r!.breakdown[1].seconds);
  });

  it('混合元音时按时长加权，而不是按帧数', () => {
    // IY 帧多但时长权重按秒计；构造一个「帧数多、时长短」的对比
    const r = computeVoiceExpression({
      ...base,
      frames: [
        ...maleFrames('AA', 100, 0.01), // 100 帧 × 0.01s = 1s
        ...maleFrames('IY', 10, 0.1), // 10 帧 × 0.1s = 1s
      ],
    });
    expect(r?.normalizedFrames).toBe(110);
    const iy = r?.breakdown.find((b) => b.code === 'IY');
    const aa = r?.breakdown.find((b) => b.code === 'AA');
    expect(iy?.seconds).toBeCloseTo(aa!.seconds, 6);
  });
});
