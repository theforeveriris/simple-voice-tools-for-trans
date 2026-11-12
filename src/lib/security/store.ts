/**
 * 锁配置与失败计数的本地存储。
 *
 * 使用 IndexedDB kv 仓库，与记录/音频同一个库；锁配置不进入 AppSettings，
 * 因此设置导出、云备份、局域网同步都不会带上 PIN 哈希。
 */

import { idbGetKV, idbPutKV } from '@/lib/storage/idb';
import { emptyAttempts } from './attempts';
import type {
  AttemptState, BiometricConfig, DiscreetPreset, SecretHash, SecurityConfig,
} from './types';

const CONFIG_KEY = 'security:config';
const ATTEMPTS_KEY = 'security:attempts';
const DISCREET_HINT_KEY = 'svt:security:discreet';

const DISCREET_PRESETS: DiscreetPreset[] = ['normal', 'voiceNotes', 'vocalLog', 'audioJournal'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPreset(value: unknown): value is DiscreetPreset {
  return typeof value === 'string' && DISCREET_PRESETS.includes(value as DiscreetPreset);
}

function normalizeBiometric(value: unknown): BiometricConfig {
  if (!isRecord(value)) return { android: 'none', web: false, windows: false };
  const android = value.android === 'strong' || value.android === 'weak' ? value.android : 'none';
  return {
    android,
    web: value.web === true,
    windows: value.windows === true,
    ...(typeof value.webauthnCredentialId === 'string' && value.webauthnCredentialId
      ? { webauthnCredentialId: value.webauthnCredentialId }
      : {}),
  };
}

function normalizeConfig(value: unknown): SecurityConfig | null {
  if (!isRecord(value) || value.version !== 1) return null;
  const pin = isRecord(value.pin) ? (value.pin as unknown as SecurityConfig['pin']) : null;
  const recovery = isRecord(value.recovery) ? (value.recovery as unknown as SecurityConfig['recovery']) : null;
  const privacy: Record<string, unknown> = isRecord(value.privacy) ? value.privacy : {};
  const discreet: Record<string, unknown> = isRecord(value.discreet) ? value.discreet : {};
  // 第二 PIN 与真实 PIN 同结构；缺字段时按未设置处理，避免坏配置把锁死
  const duressRaw = isRecord(value.duress) ? value.duress : null;
  const duressPin = duressRaw && isRecord(duressRaw.pin)
    ? (duressRaw.pin as unknown as SecretHash)
    : null;
  return {
    version: 1,
    enabled: value.enabled === true,
    pin,
    recovery,
    biometric: normalizeBiometric(value.biometric),
    privacy: {
      backgroundMask: privacy.backgroundMask !== false,
      secureScreen: privacy.secureScreen === true,
    },
    discreet: {
      preset: isPreset(discreet.preset) ? discreet.preset : 'normal',
    },
    duress: duressPin ? { pin: duressPin, wipe: duressRaw?.wipe === true } : null,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
  };
}

export async function loadSecurityConfig(): Promise<SecurityConfig | null> {
  try {
    const raw = await idbGetKV<unknown>(CONFIG_KEY);
    return normalizeConfig(raw);
  } catch (err) {
    console.warn('读取应用锁配置失败:', err);
    return null;
  }
}

export async function saveSecurityConfig(config: SecurityConfig): Promise<void> {
  await idbPutKV(CONFIG_KEY, config);
}

export async function loadAttempts(): Promise<AttemptState> {
  try {
    const raw = await idbGetKV<unknown>(ATTEMPTS_KEY);
    if (!isRecord(raw)) return emptyAttempts();
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    return {
      pinFailed: num(raw.pinFailed),
      pinLockedUntil: num(raw.pinLockedUntil),
      recoveryFailed: num(raw.recoveryFailed),
      recoveryLockedUntil: num(raw.recoveryLockedUntil),
      biometricFailed: num(raw.biometricFailed),
    };
  } catch {
    return emptyAttempts();
  }
}

export async function saveAttempts(attempts: AttemptState): Promise<void> {
  try {
    await idbPutKV(ATTEMPTS_KEY, attempts);
  } catch (err) {
    console.warn('保存应用锁失败计数失败:', err);
  }
}

/** splash / 原生 alias 的同步提示：只存预设名，不含敏感信息 */
export function setDiscreetHint(preset: DiscreetPreset): void {
  try {
    if (preset === 'normal') localStorage.removeItem(DISCREET_HINT_KEY);
    else localStorage.setItem(DISCREET_HINT_KEY, preset);
  } catch {
    /* ignore */
  }
}

export function readDiscreetHint(): DiscreetPreset {
  try {
    const value = localStorage.getItem(DISCREET_HINT_KEY);
    return isPreset(value) ? value : 'normal';
  } catch {
    return 'normal';
  }
}
