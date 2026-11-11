/**
 * 应用锁 / 隐私保护的共享类型。
 *
 * 这里刻意不把锁配置放进 AppSettings：
 * - 锁配置属于设备本地凭据，不参与设置导出、云备份、局域网同步；
 * - PIN / 恢复码只存哈希，明文永不落盘。
 */

export type DiscreetPreset = 'normal' | 'voiceNotes' | 'vocalLog' | 'audioJournal';

export type AndroidBiometric = 'none' | 'weak' | 'strong';

/** PBKDF2 凭据（PIN 或恢复码） */
export interface SecretHash {
  version: 1;
  algorithm: 'PBKDF2-SHA256';
  iterations: number;
  /** base64，16 字节随机盐 */
  salt: string;
  /** base64，32 字节派生结果 */
  hash: string;
}

export interface BiometricConfig {
  /** Android 原生 BiometricPrompt：strong 可重置 PIN，weak 只能解锁 */
  android: AndroidBiometric;
  /** Web/PWA WebAuthn：只能解锁 */
  web: boolean;
  /** Windows Hello：只能解锁 */
  windows: boolean;
  /** WebAuthn 凭据 id（base64url） */
  webauthnCredentialId?: string;
}

export interface SecurityPrivacy {
  /** 切后台时盖住内容（默认开） */
  backgroundMask: boolean;
  /** Android FLAG_SECURE：禁止截屏与最近任务预览（默认关） */
  secureScreen: boolean;
}

export interface SecurityConfig {
  version: 1;
  enabled: boolean;
  pin: SecretHash | null;
  recovery: SecretHash | null;
  biometric: BiometricConfig;
  privacy: SecurityPrivacy;
  discreet: { preset: DiscreetPreset };
  updatedAt: number;
}

export interface AttemptState {
  pinFailed: number;
  pinLockedUntil: number;
  recoveryFailed: number;
  recoveryLockedUntil: number;
  /** 生物识别失败不参与延迟，只用于隐藏自动弹窗 */
  biometricFailed: number;
}

export type UnlockFailure = 'delay' | 'invalid' | 'unavailable' | 'error';

export interface UnlockResult {
  ok: boolean;
  failure?: UnlockFailure;
  retryAfterMs?: number;
}

export interface ChangeResult {
  ok: boolean;
  failure?: UnlockFailure;
  retryAfterMs?: number;
}

export interface SecuritySnapshot {
  ready: boolean;
  enabled: boolean;
  locked: boolean;
  /** 切后台时的全屏遮罩（锁屏本身已经盖住时无需遮罩） */
  masked: boolean;
  biometric: BiometricConfig;
  hasRecovery: boolean;
  /** 只有 Android 强生物识别可以重置 PIN */
  canResetWithBiometric: boolean;
  privacy: SecurityPrivacy;
  discreet: DiscreetPreset;
  attempts: AttemptState;
  /** 自动弹生物识别：至少一种可用，且未连续失败 3 次 */
  biometricAutoPrompt: boolean;
}
