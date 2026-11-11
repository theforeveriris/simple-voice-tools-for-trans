import { describe, expect, it } from 'vitest';
import {
  clearAttempts,
  clearBiometricFailures,
  delayForFailures,
  emptyAttempts,
  registerBiometricFailure,
  registerFailure,
  remainingLockMs,
} from './attempts';

describe('security attempts', () => {
  it('follows 30s then doubles every five failures, capped at one hour', () => {
    expect(delayForFailures(0)).toBe(0);
    expect(delayForFailures(4)).toBe(0);
    expect(delayForFailures(5)).toBe(30_000);
    expect(delayForFailures(9)).toBe(30_000);
    expect(delayForFailures(10)).toBe(60_000);
    expect(delayForFailures(15)).toBe(120_000);
    expect(delayForFailures(100)).toBe(3_600_000);
  });

  it('registers and clears PIN failures', () => {
    let state = emptyAttempts();
    for (let i = 0; i < 5; i++) state = registerFailure(state, 'pin', 1_000);
    expect(state.pinFailed).toBe(5);
    expect(remainingLockMs(state, 'pin', 1_000)).toBe(30_000);
    expect(remainingLockMs(state, 'pin', 31_000)).toBe(0);

    state = clearAttempts(state, 'pin');
    expect(state.pinFailed).toBe(0);
    expect(state.pinLockedUntil).toBe(0);
  });

  it('tracks recovery attempts separately', () => {
    let state = emptyAttempts();
    state = registerFailure(state, 'recovery', 0);
    expect(state.recoveryFailed).toBe(1);
    expect(state.pinFailed).toBe(0);
    state = clearAttempts(state, 'recovery');
    expect(state.recoveryFailed).toBe(0);
  });

  it('tracks biometric failures without delay', () => {
    let state = emptyAttempts();
    state = registerBiometricFailure(state);
    state = registerBiometricFailure(state);
    expect(state.biometricFailed).toBe(2);
    state = clearBiometricFailures(state);
    expect(state.biometricFailed).toBe(0);
  });
});
