import { describe, expect, it } from 'vitest';
import {
  extractNumberClaims,
  findUnverifiedClaims,
  formatAllowedNumbers,
  hasNumberClaims,
} from './assistantNumerals';

describe('assistantNumerals', () => {
  it('extracts claims with units and normalizes them', () => {
    const claims = extractNumberClaims('中位 F0 是 168.5 Hz，命中率 72％，HNR 提高 2.1 dB，变化 1.5 半音，延迟 30 ms。');
    expect(claims.map((claim) => [claim.value, claim.unit])).toEqual([
      [168.5, 'Hz'],
      [72, '%'],
      [2.1, 'dB'],
      [1.5, '半音'],
      [30, 'ms'],
    ]);
  });

  it('treats numbers present in tool/context sources as allowed', () => {
    const sources = ['F0 中位：160 → 175 Hz（+15）', '靶标命中率：60 → 80 %（+20）'];
    expect(findUnverifiedClaims('这次中位 175 Hz，命中率 80%，比上次高 15 Hz。', sources)).toEqual([]);
  });

  it('finds unsupported numbers', () => {
    const sources = ['F0 中位：160 → 175 Hz'];
    const bad = findUnverifiedClaims('这次中位 182 Hz，提升 12%。', sources);
    expect(bad.map((claim) => claim.raw)).toEqual(['182 Hz', '12%']);
  });

  it('allows rounding of a known value', () => {
    expect(findUnverifiedClaims('大约 175.0 Hz', ['175 Hz'])).toEqual([]);
    expect(findUnverifiedClaims('大约 175.05 Hz', ['175 Hz'])).toEqual([]);
  });

  it('formats a de-duplicated allowed list', () => {
    const text = formatAllowedNumbers(['160 175 Hz', '175 Hz', '80 %']);
    expect(text).toBe('80、160、175');
  });

  it('ignores unitless numbers in the claim check', () => {
    expect(hasNumberClaims('每天练 10 分钟，做 3 组')).toBe(false);
    expect(hasNumberClaims('保持 170 Hz')).toBe(true);
  });
});
