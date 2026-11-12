import { describe, expect, it } from 'vitest';
import {
  constantTimeEqual,
  formatRecoveryCode,
  generateRecoveryCode,
  hashSecret,
  isSixDigitPin,
  normalizeRecoveryCode,
  verifySecret,
} from './crypto';

describe('security crypto', () => {
  it('hashes and verifies a PIN with PBKDF2', async () => {
    const stored = await hashSecret('123456', 2_000);
    expect(stored.algorithm).toBe('PBKDF2-SHA256');
    expect(stored.iterations).toBe(2_000);
    expect(stored.salt.length).toBeGreaterThan(0);
    expect(await verifySecret('123456', stored)).toBe(true);
    expect(await verifySecret('123457', stored)).toBe(false);
  });

  it('uses a fresh salt for the same PIN', async () => {
    const [a, b] = await Promise.all([
      hashSecret('123456', 1_000),
      hashSecret('123456', 1_000),
    ]);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('compares bytes in constant time semantics', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it('generates and normalizes 20-character recovery codes', () => {
    const code = generateRecoveryCode();
    expect(code).toHaveLength(20);
    expect(normalizeRecoveryCode(code)).toBe(code);
    expect(normalizeRecoveryCode(formatRecoveryCode(code))).toBe(code);
    expect(normalizeRecoveryCode(code.toLowerCase())).toBe(code);
    expect(normalizeRecoveryCode(`${code.slice(0, 5)}-${code.slice(5)}`)).toBe(code);
  });

  it('rejects malformed recovery codes', () => {
    expect(normalizeRecoveryCode('')).toBe('');
    expect(normalizeRecoveryCode('12345')).toBe('');
    expect(normalizeRecoveryCode('OOOOOOOOOOOOOOOOOOOO')).toBe('00000000000000000000');
  });

  it('validates six-digit PINs only', () => {
    expect(isSixDigitPin('123456')).toBe(true);
    expect(isSixDigitPin('12345')).toBe(false);
    expect(isSixDigitPin('1234567')).toBe(false);
    expect(isSixDigitPin('12345a')).toBe(false);
  });
});
