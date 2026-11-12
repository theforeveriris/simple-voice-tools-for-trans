/**
 * 应用锁的密码学原语。
 *
 * - PIN：6 位数字，PBKDF2-SHA256 310k 次 + 16 字节随机盐；
 * - 恢复码：20 位 Crockford Base32（100 位随机量），同样只存 PBKDF2 哈希；
 * - 比较走常量时间，避免明显的时序侧信道；
 * - 明文 PIN / 恢复码只在当前函数调用栈里存在，不写任何存储。
 */

import type { SecretHash } from './types';

/** OWASP 2023 对 PBKDF2-SHA256 的推荐量级 */
export const PIN_ITERATIONS = 310_000;
export const RECOVERY_ITERATIONS = 310_000;

/** Crockford Base32：去掉 I / L / O / U，避免抄写歧义 */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  return base64ToBytes(padded);
}

function deriveBits(secret: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const data = new TextEncoder().encode(secret);
  return crypto.subtle
    .importKey('raw', data, 'PBKDF2', false, ['deriveBits'])
    .then((key) => crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
      key,
      256,
    ));
}

export async function hashSecret(secret: string, iterations: number = PIN_ITERATIONS): Promise<SecretHash> {
  const salt = randomBytes(16);
  const bits = new Uint8Array(await deriveBits(secret, salt, iterations));
  return {
    version: 1,
    algorithm: 'PBKDF2-SHA256',
    iterations,
    salt: bytesToBase64(salt),
    hash: bytesToBase64(bits),
  };
}

/** 常量时间比较；长度不同也走完整循环，避免提前返回 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

export async function verifySecret(secret: string, stored: SecretHash): Promise<boolean> {
  if (stored.algorithm !== 'PBKDF2-SHA256' || stored.version !== 1) return false;
  try {
    const bits = new Uint8Array(await deriveBits(secret, base64ToBytes(stored.salt), stored.iterations));
    return constantTimeEqual(bits, base64ToBytes(stored.hash));
  } catch {
    // 配置损坏 / 非法 base64：按验证失败处理，避免锁屏崩溃
    return false;
  }
}

/* ------------------------------ 恢复码 ------------------------------ */

export function generateRecoveryCode(): string {
  const bytes = randomBytes(20);
  let raw = '';
  for (let i = 0; i < bytes.length; i++) raw += CROCKFORD[bytes[i] & 31];
  return raw;
}

/** 输入容错：大小写、空格、连字符；O→0、I/L→1；非法字符直接判空 */
export function normalizeRecoveryCode(value: string): string {
  const mapped = value
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (mapped.length !== 20) return '';
  for (const ch of mapped) {
    if (!CROCKFORD.includes(ch)) return '';
  }
  return mapped;
}

/** 展示用：XXXXX-XXXXX-XXXXX-XXXXX */
export function formatRecoveryCode(value: string): string {
  const normalized = normalizeRecoveryCode(value) || value.replace(/[^0-9A-Z]/g, '').toUpperCase();
  const groups = normalized.match(/.{1,5}/g) ?? [];
  return groups.join('-');
}

export function isSixDigitPin(value: string): boolean {
  return /^\d{6}$/.test(value);
}
