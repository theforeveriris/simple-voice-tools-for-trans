/**
 * 应用锁的单一状态机。
 *
 * 设计原则：
 * - 锁定/解锁状态只在内存 + sessionStorage；刷新可恢复，冷启动必须重锁；
 * - PIN / 恢复码只存 PBKDF2 哈希；明文不落盘；
 * - 任何失败都走统一延迟；生物识别失败不参与延迟；
 * - 所有重置/改 PIN 都必须同时生成新的恢复码（旧码立即作废）；
 * - 只有 Android 强生物识别可以重置 PIN；Web / Windows 生物识别只解锁。
 */

import { t } from '@/i18n';
import { idbClearAll } from '@/lib/storage/idb';
import {
  authenticateBiometric,
  authenticateStrongForReset,
  detectBiometric,
  applyDiscreetPreset,
  applySecureFlag,
  hasAnyBiometric,
  listenAppState,
} from './biometric';
import {
  clearAttempts,
  clearBiometricFailures,
  emptyAttempts,
  registerBiometricFailure,
  registerFailure,
  remainingLockMs,
  type AttemptKind,
} from './attempts';
import { hashSecret, isSixDigitPin, normalizeRecoveryCode, verifySecret } from './crypto';
import {
  canResumeSession,
  clearHidden,
  clearUnlocked,
  hiddenSince,
  markHidden,
  markUnlocked,
} from './session';
import {
  loadAttempts,
  loadSecurityConfig,
  readDiscreetHint,
  saveAttempts,
  saveSecurityConfig,
  setDiscreetHint,
} from './store';
import { AUTO_LOCK_MS } from './attempts';
import type {
  AttemptState,
  BiometricConfig,
  ChangeResult,
  DiscreetPreset,
  SecurityConfig,
  SecuritySnapshot,
  UnlockResult,
} from './types';

const CHANNEL_NAME = 'svt:security';

let config: SecurityConfig | null = null;
let attempts: AttemptState = emptyAttempts();
let locked = false;
let masked = false;
let ready = false;
let initPromise: Promise<void> | null = null;
let channel: BroadcastChannel | null = null;

const listeners = new Set<() => void>();

function defaultBiometric(): BiometricConfig {
  return { android: 'none', web: false, windows: false };
}

function buildSnapshot(): SecuritySnapshot {
  const biometric = config?.biometric ?? defaultBiometric();
  return {
    ready,
    enabled: config?.enabled === true,
    locked: config?.enabled === true && locked,
    masked: config?.enabled === true && masked,
    biometric,
    hasRecovery: config?.recovery != null,
    canResetWithBiometric: biometric.android === 'strong',
    privacy: config?.privacy ?? { backgroundMask: true, secureScreen: false },
    discreet: config?.discreet.preset ?? readDiscreetHint(),
    attempts,
    biometricAutoPrompt: hasAnyBiometric(biometric)
      && attempts.biometricFailed < 3
      && config?.enabled === true,
  };
}

let snapshot: SecuritySnapshot = buildSnapshot();

function emit(): void {
  snapshot = buildSnapshot();
  for (const fn of listeners) fn();
}

export function subscribeSecurity(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getSecuritySnapshot(): SecuritySnapshot {
  return snapshot;
}

function installChannel(): void {
  if (typeof BroadcastChannel === 'undefined' || channel) return;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent) => {
    if (event.data?.type !== 'lock') return;
    if (!config?.enabled) return;
    locked = true;
    masked = false;
    clearUnlocked();
    emit();
  };
}

function broadcastLock(): void {
  try {
    channel?.postMessage({ type: 'lock' });
  } catch {
    /* ignore */
  }
}

async function persistAttempts(): Promise<void> {
  await saveAttempts(attempts);
}

async function persistConfig(): Promise<void> {
  if (config) await saveSecurityConfig(config);
}

function biometricCopy(): { title: string; subtitle: string; cancel: string } {
  return {
    title: t('security.biometricTitle'),
    subtitle: t('security.biometricSubtitle'),
    cancel: t('security.usePin'),
  };
}

export function initSecurity(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const [loadedConfig, loadedAttempts] = await Promise.all([loadSecurityConfig(), loadAttempts()]);
    config = loadedConfig;
    attempts = loadedAttempts;
    if (config?.enabled) {
      locked = !canResumeSession();
      if (locked) clearUnlocked();
      installChannel();
      await applySecureFlag(config.privacy.secureScreen);
      // 让原生 alias / splash 提示与配置保持一致；已经正确时插件不会重启
      if (config.discreet.preset !== 'normal') {
        setDiscreetHint(config.discreet.preset);
        await applyDiscreetPreset(config.discreet.preset);
      } else {
        setDiscreetHint('normal');
        await applyDiscreetPreset('normal');
      }
    } else {
      locked = false;
    }
    ready = true;
    emit();
  })().catch((err) => {
    console.warn('应用锁初始化失败，按未启用处理:', err);
    config = null;
    locked = false;
    ready = true;
    emit();
  });
  return initPromise;
}

/* ------------------------------ 生命周期 ------------------------------ */

export function lockNow(): void {
  if (!config?.enabled) return;
  locked = true;
  masked = false;
  clearUnlocked();
  clearHidden();
  emit();
  broadcastLock();
}

export function setMasked(value: boolean): void {
  if (masked === value) return;
  masked = value;
  emit();
}

/** 后台记录时间；回到前台超过 5 分钟则锁 */
export function handleHidden(): void {
  if (!config?.enabled) return;
  markHidden();
  if (config.privacy.backgroundMask) setMasked(true);
}

export function handleVisible(): void {
  if (!config?.enabled) return;
  const since = hiddenSince();
  if (since && Date.now() - since >= AUTO_LOCK_MS) {
    lockNow();
    return;
  }
  setMasked(false);
}

/** 安装 Android 原生 appPaused/appResumed 监听（Web/Tauri 由 hook 处理） */
export async function installNativeLifecycle(): Promise<() => void> {
  // 每次挂载都注册一组新监听；缓存会导致 StrictMode 二次挂载拿到已移除的 cleanup
  return listenAppState(handleHidden, handleVisible);
}

/* ------------------------------ 解锁 ------------------------------ */

function unlockSuccess(): void {
  locked = false;
  masked = false;
  clearHidden();
  markUnlocked();
  emit();
}

export async function unlockWithPin(pin: string): Promise<UnlockResult> {
  if (!config?.enabled || !config.pin) return { ok: false, failure: 'unavailable' };
  const retry = remainingLockMs(attempts, 'pin');
  if (retry > 0) return { ok: false, failure: 'delay', retryAfterMs: retry };
  if (!(await verifySecret(pin, config.pin))) {
    attempts = registerFailure(attempts, 'pin');
    await persistAttempts();
    emit();
    return {
      ok: false,
      failure: 'invalid',
      retryAfterMs: remainingLockMs(attempts, 'pin'),
    };
  }
  attempts = clearAttempts(attempts, 'pin');
  await persistAttempts();
  unlockSuccess();
  return { ok: true };
}

export async function unlockWithBiometric(): Promise<UnlockResult> {
  if (!config?.enabled || !hasAnyBiometric(config.biometric)) {
    return { ok: false, failure: 'unavailable' };
  }
  const ok = await authenticateBiometric(config.biometric, biometricCopy());
  if (!ok) {
    attempts = registerBiometricFailure(attempts);
    await persistAttempts();
    emit();
    return { ok: false, failure: 'invalid' };
  }
  attempts = clearBiometricFailures(attempts);
  await persistAttempts();
  unlockSuccess();
  return { ok: true };
}

export async function verifyStrongBiometricForReset(): Promise<boolean> {
  if (!config?.enabled) return false;
  const ok = await authenticateStrongForReset(config.biometric, biometricCopy());
  if (ok) {
    attempts = clearBiometricFailures(attempts);
    await persistAttempts();
    emit();
  }
  return ok;
}

/* ------------------------------ 启用 / 关闭 ------------------------------ */

export interface EnableLockInput {
  pin: string;
  /** 可选；没有强生物识别时必须提供 */
  recoveryCode: string | null;
  biometric: BiometricConfig;
}

export async function enableLock(input: EnableLockInput): Promise<void> {
  if (!isSixDigitPin(input.pin)) throw new Error(t('security.pinInvalid'));
  const normalizedRecovery = input.recoveryCode ? normalizeRecoveryCode(input.recoveryCode) : '';
  if (input.recoveryCode && !normalizedRecovery) throw new Error(t('security.recoveryCodeInvalid'));
  const canReset = input.biometric.android === 'strong';
  if (!normalizedRecovery && !canReset) throw new Error(t('security.recoveryRequired'));

  const [pin, recovery] = await Promise.all([
    hashSecret(input.pin),
    normalizedRecovery ? hashSecret(normalizedRecovery) : Promise.resolve(null),
  ]);
  config = {
    version: 1,
    enabled: true,
    pin,
    recovery,
    biometric: input.biometric,
    privacy: config?.privacy ?? { backgroundMask: true, secureScreen: false },
    discreet: config?.discreet ?? { preset: readDiscreetHint() },
    updatedAt: Date.now(),
  };
  attempts = emptyAttempts();
  await Promise.all([persistConfig(), persistAttempts()]);
  installChannel();
  locked = false;
  masked = false;
  clearHidden();
  markUnlocked();
  await applySecureFlag(config.privacy.secureScreen);
  emit();
}

export async function disableLock(
  currentPin: string | null,
  viaStrongBiometric: boolean,
): Promise<ChangeResult> {
  if (!config?.enabled) return { ok: false, failure: 'unavailable' };
  if (viaStrongBiometric) {
    const ok = await verifyStrongBiometricForReset();
    if (!ok) return { ok: false, failure: 'invalid' };
  } else {
    if (!currentPin || !config.pin || !(await verifySecret(currentPin, config.pin))) {
      if (currentPin && config.pin) {
        attempts = registerFailure(attempts, 'pin');
        await persistAttempts();
        emit();
      }
      return { ok: false, failure: 'invalid', retryAfterMs: remainingLockMs(attempts, 'pin') };
    }
  }
  const hadDiscreet = config.discreet.preset !== 'normal';
  config = {
    ...config,
    enabled: false,
    pin: null,
    recovery: null,
    biometric: defaultBiometric(),
    discreet: { preset: 'normal' },
    updatedAt: Date.now(),
  };
  if (hadDiscreet) {
    setDiscreetHint('normal');
    await applyDiscreetPreset('normal');
  }
  attempts = emptyAttempts();
  await Promise.all([persistConfig(), persistAttempts()]);
  locked = false;
  masked = false;
  clearUnlocked();
  emit();
  return { ok: true };
}

/* ------------------------------ 改 PIN / 重置 ------------------------------ */

function validateNewRecovery(code: string): string {
  const normalized = normalizeRecoveryCode(code);
  if (!normalized) throw new Error(t('security.recoveryCodeInvalid'));
  return normalized;
}

export async function changePin(
  currentPin: string | null,
  newPin: string,
  newRecoveryCode: string,
  viaStrongBiometric: boolean,
): Promise<ChangeResult> {
  if (!config?.enabled || !config.pin) return { ok: false, failure: 'unavailable' };
  if (!isSixDigitPin(newPin)) return { ok: false, failure: 'error' };
  const normalizedRecovery = validateNewRecovery(newRecoveryCode);

  if (viaStrongBiometric) {
    const ok = await verifyStrongBiometricForReset();
    if (!ok) return { ok: false, failure: 'invalid' };
  } else {
    const retry = remainingLockMs(attempts, 'pin');
    if (retry > 0) return { ok: false, failure: 'delay', retryAfterMs: retry };
    if (!currentPin || !(await verifySecret(currentPin, config.pin))) {
      attempts = registerFailure(attempts, 'pin');
      await persistAttempts();
      emit();
      return {
        ok: false,
        failure: 'invalid',
        retryAfterMs: remainingLockMs(attempts, 'pin'),
      };
    }
  }

  const [pin, recovery] = await Promise.all([
    hashSecret(newPin),
    hashSecret(normalizedRecovery),
  ]);
  config = { ...config, pin, recovery, updatedAt: Date.now() };
  attempts = clearAttempts(attempts, 'pin');
  await Promise.all([persistConfig(), persistAttempts()]);
  emit();
  return { ok: true };
}

/** 锁屏恢复码重置：验证旧码 → 设置新 PIN → 强制保存新恢复码 → 解锁 */
export async function resetPinWithRecovery(
  recoveryCode: string,
  newPin: string,
  newRecoveryCode: string,
): Promise<ChangeResult> {
  if (!config?.enabled || !config.recovery) return { ok: false, failure: 'unavailable' };
  if (!isSixDigitPin(newPin)) return { ok: false, failure: 'error' };
  const normalizedOld = normalizeRecoveryCode(recoveryCode);
  if (!normalizedOld) return { ok: false, failure: 'invalid' };
  const retry = remainingLockMs(attempts, 'recovery');
  if (retry > 0) return { ok: false, failure: 'delay', retryAfterMs: retry };
  if (!(await verifySecret(normalizedOld, config.recovery))) {
    attempts = registerFailure(attempts, 'recovery');
    await persistAttempts();
    emit();
    return {
      ok: false,
      failure: 'invalid',
      retryAfterMs: remainingLockMs(attempts, 'recovery'),
    };
  }
  const normalizedNew = validateNewRecovery(newRecoveryCode);
  const [pin, recovery] = await Promise.all([
    hashSecret(newPin),
    hashSecret(normalizedNew),
  ]);
  config = { ...config, pin, recovery, updatedAt: Date.now() };
  attempts = emptyAttempts();
  await Promise.all([persistConfig(), persistAttempts()]);
  unlockSuccess();
  return { ok: true };
}

/** 锁屏恢复流程的“先验证旧恢复码”步骤；不重置，只校验并计入失败延迟 */
export async function verifyRecoveryCodeForReset(code: string): Promise<ChangeResult> {
  if (!config?.enabled || !config.recovery) return { ok: false, failure: 'unavailable' };
  const normalized = normalizeRecoveryCode(code);
  if (!normalized) return { ok: false, failure: 'invalid' };
  const retry = remainingLockMs(attempts, 'recovery');
  if (retry > 0) return { ok: false, failure: 'delay', retryAfterMs: retry };
  if (!(await verifySecret(normalized, config.recovery))) {
    attempts = registerFailure(attempts, 'recovery');
    await persistAttempts();
    emit();
    return {
      ok: false,
      failure: 'invalid',
      retryAfterMs: remainingLockMs(attempts, 'recovery'),
    };
  }
  attempts = clearAttempts(attempts, 'recovery');
  await persistAttempts();
  emit();
  return { ok: true };
}

/** Android 强生物识别重置；Web/Windows 永远不可用 */
export async function resetPinWithStrongBiometric(
  newPin: string,
  newRecoveryCode: string,
): Promise<ChangeResult> {
  if (!config?.enabled) return { ok: false, failure: 'unavailable' };
  if (!isSixDigitPin(newPin)) return { ok: false, failure: 'error' };
  const normalizedNew = validateNewRecovery(newRecoveryCode);
  const ok = await verifyStrongBiometricForReset();
  if (!ok) return { ok: false, failure: 'invalid' };
  const [pin, recovery] = await Promise.all([
    hashSecret(newPin),
    hashSecret(normalizedNew),
  ]);
  config = { ...config, pin, recovery, updatedAt: Date.now() };
  attempts = emptyAttempts();
  await Promise.all([persistConfig(), persistAttempts()]);
  unlockSuccess();
  return { ok: true };
}

/**
 * 设置页重新生成恢复码。调用方先完成当前 PIN / 强生物识别验证，
 * 再把新码传进来；成功后旧码立即失效。
 */
export async function saveNewRecoveryCode(code: string): Promise<void> {
  if (!config?.enabled) throw new Error(t('security.recoveryCodeInvalid'));
  const normalized = validateNewRecovery(code);
  const recovery = await hashSecret(normalized);
  config = { ...config, recovery, updatedAt: Date.now() };
  await persistConfig();
  emit();
}

export async function verifyCurrentPin(pin: string): Promise<ChangeResult> {
  if (!config?.enabled || !config.pin) return { ok: false, failure: 'unavailable' };
  const retry = remainingLockMs(attempts, 'pin');
  if (retry > 0) return { ok: false, failure: 'delay', retryAfterMs: retry };
  if (!(await verifySecret(pin, config.pin))) {
    attempts = registerFailure(attempts, 'pin');
    await persistAttempts();
    emit();
    return {
      ok: false,
      failure: 'invalid',
      retryAfterMs: remainingLockMs(attempts, 'pin'),
    };
  }
  attempts = clearAttempts(attempts, 'pin');
  await persistAttempts();
  emit();
  return { ok: true };
}

/* ------------------------------ 设置项 ------------------------------ */

export async function setBiometric(configNext: BiometricConfig): Promise<void> {
  if (!config?.enabled) return;
  if (!configNext.webauthnCredentialId) {
    configNext = {
      android: configNext.android,
      web: configNext.web,
      windows: configNext.windows,
    };
  }
  const canReset = configNext.android === 'strong';
  if (!config.recovery && !canReset && !hasAnyBiometric(configNext)) {
    // 没有恢复码、也没有可用生物识别：保留至少一种恢复方式
    throw new Error(t('security.recoveryRequired'));
  }
  config = { ...config, biometric: configNext, updatedAt: Date.now() };
  await persistConfig();
  emit();
}

export async function detectBiometricOptions(): Promise<{
  availability: Awaited<ReturnType<typeof detectBiometric>>;
}> {
  return { availability: await detectBiometric() };
}

export async function setBackgroundMask(enabled: boolean): Promise<void> {
  if (!config?.enabled) return;
  config = {
    ...config,
    privacy: { ...config.privacy, backgroundMask: enabled },
    updatedAt: Date.now(),
  };
  await persistConfig();
  if (!enabled) setMasked(false);
  emit();
}

export async function setSecureScreen(enabled: boolean): Promise<void> {
  if (!config?.enabled) return;
  config = {
    ...config,
    privacy: { ...config.privacy, secureScreen: enabled },
    updatedAt: Date.now(),
  };
  await persistConfig();
  await applySecureFlag(enabled);
  emit();
}

export async function setDiscreetPreset(preset: DiscreetPreset): Promise<void> {
  if (!config?.enabled) return;
  config = { ...config, discreet: { preset }, updatedAt: Date.now() };
  await persistConfig();
  setDiscreetHint(preset);
  await applyDiscreetPreset(preset);
  emit();
}

/* ------------------------------ 清除所有数据 ------------------------------ */

export async function clearAllSecurityData(): Promise<void> {
  // 先撤掉原生层的截屏保护与低调 alias，避免清完数据后仍停留在低调启动器
  await applySecureFlag(false);
  await applyDiscreetPreset('normal');
  setDiscreetHint('normal');
  try {
    await idbClearAll();
  } catch (err) {
    console.warn('清空 IndexedDB 失败:', err);
  }
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  } catch {
    /* ignore */
  }
  try {
    const regs = await navigator.serviceWorker?.getRegistrations();
    await Promise.all((regs ?? []).map((reg) => reg.unregister()));
  } catch {
    /* ignore */
  }
  location.reload();
}

/* 供 UI 判断某类延迟 */
export function attemptDelay(kind: AttemptKind): number {
  return remainingLockMs(attempts, kind);
}
