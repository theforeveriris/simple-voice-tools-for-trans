/**
 * 失败延迟：5 次后 30 秒，之后每 5 次翻倍，上限 1 小时。
 * 状态持久化在 IndexedDB，重启不会清零；成功解锁后清零。
 */

import type { AttemptState } from './types';

export const AUTO_LOCK_MS = 5 * 60 * 1000;
const DELAY_STEP = 30_000;
const MAX_DELAY = 60 * 60 * 1000;

export const EMPTY_ATTEMPTS: AttemptState = {
  pinFailed: 0,
  pinLockedUntil: 0,
  recoveryFailed: 0,
  recoveryLockedUntil: 0,
  biometricFailed: 0,
};

export function emptyAttempts(): AttemptState {
  return { ...EMPTY_ATTEMPTS };
}

export function delayForFailures(failed: number): number {
  if (failed < 5) return 0;
  const step = Math.floor((failed - 5) / 5);
  return Math.min(MAX_DELAY, DELAY_STEP * 2 ** step);
}

export type AttemptKind = 'pin' | 'recovery';

export function remainingLockMs(state: AttemptState, kind: AttemptKind, now = Date.now()): number {
  const until = kind === 'pin' ? state.pinLockedUntil : state.recoveryLockedUntil;
  return Math.max(0, until - now);
}

export function registerFailure(state: AttemptState, kind: AttemptKind, now = Date.now()): AttemptState {
  if (kind === 'pin') {
    const failed = state.pinFailed + 1;
    return { ...state, pinFailed: failed, pinLockedUntil: now + delayForFailures(failed) };
  }
  const failed = state.recoveryFailed + 1;
  return { ...state, recoveryFailed: failed, recoveryLockedUntil: now + delayForFailures(failed) };
}

export function clearAttempts(state: AttemptState, kind: AttemptKind): AttemptState {
  if (kind === 'pin') return { ...state, pinFailed: 0, pinLockedUntil: 0, biometricFailed: 0 };
  return { ...state, recoveryFailed: 0, recoveryLockedUntil: 0 };
}

export function registerBiometricFailure(state: AttemptState): AttemptState {
  return { ...state, biometricFailed: state.biometricFailed + 1 };
}

export function clearBiometricFailures(state: AttemptState): AttemptState {
  return { ...state, biometricFailed: 0 };
}
