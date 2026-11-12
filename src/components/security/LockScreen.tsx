/**
 * 全屏锁屏：不渲染任何应用内容，也不显示应用名称。
 * 6 位 PIN 自动提交；生物识别在 Android/Windows 自动弹，Web 用按钮。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Delete, Fingerprint, Loader2, LockKeyhole } from 'lucide-react';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { isNative, isTauri } from '@/lib/platform';
import { useStore } from '@/store/useStore';
import { useSecurity } from '@/lib/security/hook';
import { unlockWithBiometric, unlockWithPin } from '@/lib/security/state';
import { cn } from '@/lib/utils';
import { ForgotPinDialog } from './ForgotPinDialog';

export function LockScreen() {
  useI18n();
  const security = useSecurity();
  const haptics = useStore((s) => s.settings.haptics);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [, setTick] = useState(0);
  const autoPrompted = useRef(false);
  const submitting = useRef(false);

  // 用 Date.now() 直接算，避免 now 状态过期造成“无延迟也显示倒计时”
  const remaining = Math.max(0, security.attempts.pinLockedUntil - Date.now());
  const lockedFor = Math.ceil(remaining / 1000);

  useEffect(() => {
    const until = security.attempts.pinLockedUntil;
    if (until <= Date.now()) return;
    const timer = window.setInterval(() => {
      setTick((value) => value + 1);
      if (Date.now() >= until) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [security.attempts.pinLockedUntil]);

  useEffect(() => {
    // 只清空输入；错误/播报由 submit 自己设置，避免 effect 把刚设置的消息清掉
    setPin('');
  }, [security.attempts.pinLockedUntil]);

  const tryBiometric = useCallback(async () => {
    if (busy || submitting.current) return;
    setBusy(true);
    setError('');
    try {
      const res = await unlockWithBiometric();
      if (!res.ok) {
        if (haptics) navigator.vibrate?.([12, 40, 12]);
        setError(t('security.biometricFailed'));
        setAnnouncement(t('security.biometricFailed'));
      }
    } finally {
      setBusy(false);
    }
  }, [busy, haptics]);

  useEffect(() => {
    // WebAuthn 需要用户手势：Android/Windows 自动弹，Web 只显示按钮
    if (!isNative && !isTauri) return;
    if (autoPrompted.current || !security.biometricAutoPrompt) return;
    autoPrompted.current = true;
    const timer = window.setTimeout(() => void tryBiometric(), 280);
    return () => window.clearTimeout(timer);
  }, [security.biometricAutoPrompt, tryBiometric]);

  const submit = useCallback(async (candidate: string) => {
    if (submitting.current || candidate.length !== 6) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const res = await unlockWithPin(candidate);
      if (res.ok) return;
      setPin('');
      if (haptics) navigator.vibrate?.([14, 48, 14]);
      if (res.failure === 'delay') {
        setTick((value) => value + 1);
        setError('');
        setAnnouncement(t('security.wrongPin', { n: Math.ceil((res.retryAfterMs ?? 0) / 1000) }));
      } else {
        setError(t('security.wrongPinShort'));
        setAnnouncement(t('security.wrongPinShort'));
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }, [haptics]);

  useEffect(() => {
    if (forgotOpen) return;
    if (pin.length === 6 && !busy && remaining <= 0) void submit(pin);
  }, [forgotOpen, pin, busy, remaining, submit]);

  const append = useCallback((digit: string) => {
    if (busy || remaining > 0) return;
    if (haptics) navigator.vibrate?.(8);
    setError('');
    setAnnouncement('');
    setPin((current) => (current.length >= 6 ? current : current + digit));
  }, [busy, haptics, remaining]);

  const backspace = useCallback(() => {
    if (busy || remaining > 0) return;
    if (haptics) navigator.vibrate?.(8);
    setError('');
    setAnnouncement('');
    setPin((current) => current.slice(0, -1));
  }, [busy, haptics, remaining]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (forgotOpen) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        append(event.key);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        backspace();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        void submit(pin);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [append, backspace, forgotOpen, pin, submit]);

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const blocked = busy || remaining > 0;

  return (
    <div
      className="fixed inset-0 z-[300] flex flex-col items-center justify-center bg-surface px-6 text-ink"
      role="main"
      aria-label={t('security.locked')}
      data-theme-part="lock-screen"
    >
      <div className="flex w-full max-w-xs flex-col items-center gap-6">
        <div className="grid size-14 place-items-center rounded-full bg-card text-ink shadow-[0_8px_28px_rgba(28,25,45,0.10)]">
          <LockKeyhole size={24} />
        </div>

        <div className="flex items-center gap-2.5" aria-label={t('security.pinProgress', { n: pin.length })}>
          {Array.from({ length: 6 }, (_, index) => (
            <span
              key={index}
              className={cn(
                'size-2.5 rounded-full transition-colors',
                index < pin.length ? 'bg-accent' : 'bg-line',
              )}
            />
          ))}
        </div>

        <p
          className={cn(
            'min-h-5 text-center text-xs leading-relaxed',
            lockedFor > 0 ? 'text-amber-600' : 'text-red-500',
          )}
        >
          {lockedFor > 0
            ? t('security.wrongPin', { n: lockedFor })
            : error}
        </p>
        <span className="sr-only" aria-live="polite">{announcement}</span>

        <div className="grid w-full grid-cols-3 gap-3">
          {digits.map((digit) => (
            <button
              key={digit}
              type="button"
              disabled={blocked}
              onClick={() => append(digit)}
              className="h-14 rounded-2xl bg-card text-xl font-semibold text-ink shadow-[0_2px_12px_rgba(28,25,45,0.05)] transition-transform active:scale-95 disabled:opacity-40"
              aria-label={digit}
            >
              {digit}
            </button>
          ))}
          <span aria-hidden />
          <button
            type="button"
            disabled={blocked}
            onClick={() => append('0')}
            className="h-14 rounded-2xl bg-card text-xl font-semibold text-ink shadow-[0_2px_12px_rgba(28,25,45,0.05)] transition-transform active:scale-95 disabled:opacity-40"
            aria-label="0"
          >
            0
          </button>
          <button
            type="button"
            disabled={blocked}
            onClick={backspace}
            className="grid h-14 place-items-center rounded-2xl text-ink-2 transition-transform active:scale-95 disabled:opacity-40"
            aria-label={t('security.backspace')}
          >
            <Delete size={22} />
          </button>
        </div>

        <div className="flex flex-col items-center gap-3">
          {security.biometricAutoPrompt || (security.biometric.android !== 'none' || security.biometric.web || security.biometric.windows) ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void tryBiometric()}
              className="flex items-center gap-1.5 text-xs font-medium text-accent transition-opacity active:opacity-70 disabled:opacity-40"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Fingerprint size={15} />}
              {t('security.useBiometric')}
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => {
              setPin('');
              setError('');
              setForgotOpen(true);
            }}
            className="text-xs font-medium text-ink-2 transition-opacity active:opacity-60"
          >
            {t('security.forgotPin')}
          </button>
        </div>
      </div>

      <ForgotPinDialog open={forgotOpen} onClose={() => setForgotOpen(false)} />
    </div>
  );
}
