import { describe, expect, it } from 'vitest';
import {
  buildMeowTargets, foldOctave, inMeowBand, meowDistance, meowTolerance,
} from './meow';

describe('buildMeowTargets', () => {
  it('把目标区间六等分（MtF 默认 165–255）', () => {
    expect(buildMeowTargets(165, 255)).toEqual([165, 183, 201, 219, 237, 255]);
  });

  it('FtM 低音区间同样生成上行六音', () => {
    expect(buildMeowTargets(85, 165)).toEqual([85, 101, 117, 133, 149, 165]);
  });

  it('反序输入按大小排序，非法输入退回默认区间', () => {
    expect(buildMeowTargets(255, 165)[0]).toBe(165);
    expect(buildMeowTargets(Number.NaN, 0)[0]).toBe(165);
    expect(buildMeowTargets(Number.NaN, 0).at(-1)).toBe(255);
  });

  it('区间过窄时保底 30 Hz 跨度', () => {
    const t = buildMeowTargets(200, 200);
    expect(t[0]).toBe(200);
    expect(t.at(-1)).toBe(230);
  });
});

describe('meowTolerance', () => {
  it('约 ±10%，至少 ±12 Hz', () => {
    expect(meowTolerance(220)).toBe(22);
    expect(meowTolerance(85)).toBe(12);
  });
});

describe('foldOctave / meowDistance', () => {
  it('高八度 / 低八度都折回目标附近', () => {
    expect(foldOctave(330, 165)).toBe(165);
    expect(foldOctave(82.5, 165)).toBe(165);
    expect(meowDistance(330, 165)).toBe(0);
  });

  it('不在八度关系上的音不硬折', () => {
    expect(foldOctave(220, 165)).toBe(220);
    expect(meowDistance(220, 165)).toBe(55);
  });
});

describe('inMeowBand', () => {
  it('容差内为真，容差外为假', () => {
    expect(inMeowBand(232, 220)).toBe(true);
    expect(inMeowBand(198, 220)).toBe(true);
    expect(inMeowBand(180, 220)).toBe(false);
    expect(inMeowBand(2 * 220, 220)).toBe(true);
    expect(inMeowBand(0, 220)).toBe(false);
  });
});
