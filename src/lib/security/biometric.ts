/**
 * 生物识别适配层。
 *
 * - Android 原生壳：Capacitor 插件 PrivacyLock → BiometricPrompt；
 *   强生物识别可重置 PIN，弱生物识别只解锁；
 * - Windows/Tauri：Rust command → Windows Hello；只解锁；
 * - Web/PWA：WebAuthn platform authenticator；只解锁；
 * - 任何能力不可用时都回退 PIN，绝不把用户锁死在没有退路的流程里。
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import { isNative, isTauri } from '@/lib/platform';
import type { BiometricConfig, DiscreetPreset } from './types';

export interface BiometricAvailability {
  android: 'none' | 'weak' | 'strong';
  web: boolean;
  windows: boolean;
}

export interface BiometricCopy {
  title: string;
  subtitle: string;
  cancel: string;
}

interface PrivacyLockPlugin {
  getBiometricAvailability(): Promise<{ strong: boolean; weak: boolean }>;
  authenticate(options: BiometricCopy & { strong: boolean }): Promise<{ success: boolean; error?: string }>;
  cancelAuthentication(): Promise<void>;
  setSecureFlag(options: { enabled: boolean }): Promise<void>;
  setDiscreetPreset(options: { preset: DiscreetPreset }): Promise<void>;
  restartApp(): Promise<void>;
  addListener(
    eventName: 'appPaused' | 'appResumed',
    listener: () => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

export const PrivacyLock = registerPlugin<PrivacyLockPlugin>('PrivacyLock');

interface TauriInternals {
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const internals = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  if (!internals?.invoke) return Promise.reject(new Error('Tauri invoke unavailable'));
  return internals.invoke<T>(cmd, args);
}

export async function detectBiometric(): Promise<BiometricAvailability> {
  if (isNative && Capacitor.getPlatform() === 'android') {
    try {
      const res = await PrivacyLock.getBiometricAvailability();
      return { android: res.strong ? 'strong' : res.weak ? 'weak' : 'none', web: false, windows: false };
    } catch {
      return { android: 'none', web: false, windows: false };
    }
  }
  if (isTauri) {
    try {
      const windows = await tauriInvoke<boolean>('windows_hello_available');
      return { android: 'none', web: false, windows };
    } catch {
      return { android: 'none', web: false, windows: false };
    }
  }
  return { android: 'none', web: await webAuthnAvailable(), windows: false };
}

/* ------------------------------ WebAuthn ------------------------------ */

function webAuthnAvailable(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential || !navigator.credentials) {
    return Promise.resolve(false);
  }
  try {
    return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return Promise.resolve(false);
  }
}

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bufferSource(bytes);
}

/** 注册一个本机 platform credential，返回 credential id（base64url） */
export async function registerWebAuthnCredential(): Promise<string | null> {
  if (!(await webAuthnAvailable())) return null;
  try {
    const challenge = bufferSource(crypto.getRandomValues(new Uint8Array(32)));
    const userId = bufferSource(crypto.getRandomValues(new Uint8Array(16)));
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'Simple Voice Tool', id: location.hostname },
        user: { id: userId, name: 'local-user', displayName: 'Local user' },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60_000,
      },
    }) as PublicKeyCredential | null;
    return credential ? toBase64Url(credential.rawId) : null;
  } catch {
    return null;
  }
}

export async function authenticateWebAuthn(credentialId: string): Promise<boolean> {
  if (!(await webAuthnAvailable())) return false;
  try {
    const challenge = bufferSource(crypto.getRandomValues(new Uint8Array(32)));
    const credential = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ id: fromBase64Url(credentialId), type: 'public-key', transports: ['internal'] }],
        userVerification: 'required',
        timeout: 60_000,
      },
    });
    return credential != null;
  } catch {
    return false;
  }
}

/* ------------------------------ 平台认证 ------------------------------ */

async function authenticateAndroid(strong: boolean, copy: BiometricCopy): Promise<boolean> {
  try {
    const res = await PrivacyLock.authenticate({ ...copy, strong });
    return res.success === true;
  } catch {
    return false;
  }
}

async function authenticateWindows(copy: BiometricCopy): Promise<boolean> {
  try {
    return await tauriInvoke<boolean>('verify_windows_hello', { message: copy.subtitle || copy.title });
  } catch {
    return false;
  }
}

export async function authenticateBiometric(
  config: BiometricConfig,
  copy: BiometricCopy,
): Promise<boolean> {
  if (isNative && config.android !== 'none') {
    return authenticateAndroid(config.android === 'strong', copy);
  }
  if (isTauri && config.windows) {
    return authenticateWindows(copy);
  }
  if (config.web && config.webauthnCredentialId) {
    return authenticateWebAuthn(config.webauthnCredentialId);
  }
  return false;
}

/** 只有 Android 强生物识别可以重置 PIN；Web/Windows 只解锁 */
export async function authenticateStrongForReset(
  config: BiometricConfig,
  copy: BiometricCopy,
): Promise<boolean> {
  if (isNative && config.android === 'strong') {
    return authenticateAndroid(true, copy);
  }
  return false;
}

export function hasAnyBiometric(config: BiometricConfig): boolean {
  return config.android !== 'none' || config.web || config.windows;
}

/* ------------------------------ 原生隐私 ------------------------------ */

export async function applySecureFlag(enabled: boolean): Promise<void> {
  if (!isNative) return;
  try {
    await PrivacyLock.setSecureFlag({ enabled });
  } catch {
    /* older shell / plugin unavailable */
  }
}

export async function applyDiscreetPreset(preset: DiscreetPreset): Promise<void> {
  if (!isNative) return;
  try {
    await PrivacyLock.setDiscreetPreset({ preset });
  } catch {
    /* older shell / plugin unavailable */
  }
}

export async function restartNativeApp(): Promise<void> {
  if (!isNative) {
    location.reload();
    return;
  }
  try {
    await PrivacyLock.restartApp();
  } catch {
    location.reload();
  }
}

export async function listenAppState(
  onPause: () => void,
  onResume: () => void,
): Promise<() => void> {
  if (!isNative) return () => {};
  try {
    const pause = await PrivacyLock.addListener('appPaused', onPause);
    const resume = await PrivacyLock.addListener('appResumed', onResume);
    return () => {
      void pause.remove();
      void resume.remove();
    };
  } catch {
    return () => {};
  }
}
