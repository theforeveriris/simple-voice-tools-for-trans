/**
 * 应用锁设置相关弹窗：
 * - LockSetupDialog：首次开启（PIN → 生物识别 → 恢复码）
 * - ChangePinDialog：验证当前 PIN/强生物识别 → 新 PIN → 新恢复码
 * - DisableLockDialog：关闭应用锁
 * - RecoveryCodeDialog：重新生成恢复码（旧码立即失效）
 */

import { useEffect, useState } from 'react';
import { Fingerprint, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import {
  authenticateBiometric,
  detectBiometric,
  registerWebAuthnCredential,
  type BiometricAvailability,
  type BiometricCopy,
} from '@/lib/security/biometric';
import { generateRecoveryCode } from '@/lib/security/crypto';
import { useSecurity } from '@/lib/security/hook';
import {
  changePin,
  disableLock,
  enableLock,
  saveNewRecoveryCode,
  verifyCurrentPin,
  verifyStrongBiometricForReset,
} from '@/lib/security/state';
import type { BiometricConfig } from '@/lib/security/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Switch,
} from '@/components/ui';
import { PinInput } from './PinInput';
import { RecoveryCodeCard } from './RecoveryCodeCard';

function bioCopy(): BiometricCopy {
  return {
    title: t('security.biometricTitle'),
    subtitle: t('security.biometricSubtitle'),
    cancel: t('security.usePin'),
  };
}

function biometricFromAvailability(
  enabled: boolean,
  availability: BiometricAvailability | null,
  webCredentialId?: string,
): BiometricConfig {
  if (!enabled || !availability) return { android: 'none', web: false, windows: false };
  return {
    android: availability.android,
    web: availability.web && !!webCredentialId,
    windows: availability.windows,
    ...(webCredentialId ? { webauthnCredentialId: webCredentialId } : {}),
  };
}

function delayText(ms: number | undefined): string {
  return t('security.wrongPin', { n: Math.ceil((ms ?? 0) / 1000) });
}

/* ============================== 首次开启 ============================== */

type SetupStep = 'pin' | 'biometric' | 'recovery';

export function LockSetupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useI18n();
  const [step, setStep] = useState<SetupStep>('pin');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [availability, setAvailability] = useState<BiometricAvailability | null>(null);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [webCredentialId, setWebCredentialId] = useState<string | undefined>();
  const [recoveryEnabled, setRecoveryEnabled] = useState(true);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep('pin');
    setPin('');
    setPin2('');
    setBioEnabled(false);
    setWebCredentialId(undefined);
    setRecoveryEnabled(true);
    setRecoveryCode('');
    setSaved(false);
    setError('');
    setBusy(false);
    void detectBiometric().then(setAvailability).catch(() => setAvailability(null));
  }, [open]);

  const canReset = bioEnabled && availability?.android === 'strong';
  const recoveryRequired = !canReset;
  const effectiveRecovery = recoveryEnabled || recoveryRequired;

  useEffect(() => {
    if (step !== 'recovery' || !effectiveRecovery || recoveryCode) return;
    setRecoveryCode(generateRecoveryCode());
    setSaved(false);
  }, [step, effectiveRecovery, recoveryCode]);

  const nextFromPin = () => {
    if (!/^\d{6}$/.test(pin)) {
      setError(t('security.pinInvalid'));
      return;
    }
    if (pin !== pin2) {
      setError(t('security.pinMismatch'));
      return;
    }
    setError('');
    setStep('biometric');
  };

  const nextFromBiometric = async () => {
    setError('');
    if (bioEnabled && availability) {
      setBusy(true);
      try {
        if (availability.android !== 'none') {
          const ok = await authenticateBiometric(
            { android: availability.android, web: false, windows: false },
            bioCopy(),
          );
          if (!ok) {
            setError(t('security.biometricFailed'));
            return;
          }
        } else if (availability.windows) {
          const ok = await authenticateBiometric(
            { android: 'none', web: false, windows: true },
            bioCopy(),
          );
          if (!ok) {
            setError(t('security.biometricFailed'));
            return;
          }
        } else if (availability.web) {
          const credential = await registerWebAuthnCredential();
          if (!credential) {
            setError(t('security.biometricFailed'));
            return;
          }
          setWebCredentialId(credential);
        }
      } finally {
        setBusy(false);
      }
    }

    const required = !(bioEnabled && availability?.android === 'strong');
    if (required || recoveryEnabled) {
      setRecoveryCode(generateRecoveryCode());
      setSaved(false);
    }
    setStep('recovery');
  };

  const toggleRecovery = (value: boolean) => {
    if (!value && recoveryRequired) return;
    setRecoveryEnabled(value);
    if (value) {
      setRecoveryCode(generateRecoveryCode());
      setSaved(false);
    } else {
      setRecoveryCode('');
      setSaved(false);
    }
  };

  const finish = async () => {
    if (effectiveRecovery && !saved) {
      setError(t('security.recoveryMustSave'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await enableLock({
        pin,
        recoveryCode: effectiveRecovery ? recoveryCode : null,
        biometric: biometricFromAvailability(bioEnabled, availability, webCredentialId),
      });
      toast.success(t('security.toastEnabled'));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('security.enableFailed'));
    } finally {
      setBusy(false);
    }
  };

  const bioAvailable = !!availability
    && (availability.android !== 'none' || availability.web || availability.windows);

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto bg-card text-ink">
        <DialogHeader>
          <DialogTitle>{t('security.setupTitle')}</DialogTitle>
          <DialogDescription>{t('security.setupDesc')}</DialogDescription>
        </DialogHeader>

        {step === 'pin' && (
          <div className="flex flex-col gap-3">
            <PinInput value={pin} onChange={setPin} label={t('security.setPin')} autoFocus />
            <PinInput value={pin2} onChange={setPin2} label={t('security.confirmPin')} onEnter={nextFromPin} />
            <p className="text-[11px] leading-relaxed text-ink-2">{t('security.pinHint')}</p>
            <button
              type="button"
              onClick={nextFromPin}
              className="rounded-full bg-accent px-4 py-2.5 text-xs font-semibold text-white"
            >
              {t('common.next')}
            </button>
          </div>
        )}

        {step === 'biometric' && (
          <div className="flex flex-col gap-3">
            {bioAvailable ? (
              <>
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{t('security.biometric')}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-ink-2">
                      {availability?.android === 'strong'
                        ? t('security.biometricStrong')
                        : availability?.android === 'weak'
                          ? t('security.biometricWeak')
                          : t('security.biometricUnlockOnly')}
                    </p>
                  </div>
                  <Switch
                    aria-label={t('security.biometric')}
                    checked={bioEnabled}
                    onCheckedChange={setBioEnabled}
                  />
                </div>
                {bioEnabled && canReset && !recoveryEnabled && (
                  <p className="text-[11px] leading-relaxed text-amber-600">
                    {t('security.biometricOnlyWarning')}
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs leading-relaxed text-ink-2">{t('security.biometricUnavailable')}</p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep('pin')}
                className="flex-1 rounded-full border border-line px-4 py-2 text-xs font-medium text-ink-2"
              >
                {t('common.back')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void nextFromBiometric()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {busy && <Loader2 size={13} className="animate-spin" />}
                {t('common.next')}
              </button>
            </div>
          </div>
        )}

        {step === 'recovery' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{t('security.recoveryCode')}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-ink-2">
                  {recoveryRequired ? t('security.recoveryRequiredDesc') : t('security.recoveryOptionalDesc')}
                </p>
              </div>
              <Switch
                aria-label={t('security.recoveryCode')}
                checked={effectiveRecovery}
                disabled={recoveryRequired}
                onCheckedChange={toggleRecovery}
              />
            </div>

            {effectiveRecovery && recoveryCode && (
              <RecoveryCodeCard code={recoveryCode} saved={saved} onSavedChange={setSaved} />
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep('biometric')}
                className="flex-1 rounded-full border border-line px-4 py-2 text-xs font-medium text-ink-2"
              >
                {t('common.back')}
              </button>
              <button
                type="button"
                disabled={busy || (effectiveRecovery && !saved)}
                onClick={() => void finish()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {busy && <Loader2 size={13} className="animate-spin" />}
                {t('security.enable')}
              </button>
            </div>
          </div>
        )}

        {error && <p className="text-xs leading-relaxed text-red-500" role="alert">{error}</p>}

        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-line px-4 py-2 text-xs font-medium text-ink-2"
          >
            {t('common.cancel')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================== 改 PIN ============================== */

type ChangeStep = 'verify' | 'newPin' | 'saved';

export function ChangePinDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useI18n();
  const security = useSecurity();
  const [step, setStep] = useState<ChangeStep>('verify');
  const [currentPin, setCurrentPin] = useState('');
  const [viaBiometric, setViaBiometric] = useState(false);
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [newCode, setNewCode] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep('verify');
    setCurrentPin('');
    setViaBiometric(false);
    setPin('');
    setPin2('');
    setNewCode('');
    setSaved(false);
    setError('');
    setBusy(false);
  }, [open]);

  const verifyPin = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await verifyCurrentPin(currentPin);
      if (!res.ok) {
        setError(res.failure === 'delay'
          ? delayText(res.retryAfterMs)
          : t('security.pinInvalid'));
        return;
      }
      setViaBiometric(false);
      setStep('newPin');
    } finally {
      setBusy(false);
    }
  };

  const chooseBiometric = () => {
    if (!security.canResetWithBiometric) return;
    setViaBiometric(true);
    setCurrentPin('');
    setError('');
    setStep('newPin');
  };

  const nextFromPin = () => {
    if (!/^\d{6}$/.test(pin)) {
      setError(t('security.pinInvalid'));
      return;
    }
    if (pin !== pin2) {
      setError(t('security.pinMismatch'));
      return;
    }
    setError('');
    setNewCode(generateRecoveryCode());
    setSaved(false);
    setStep('saved');
  };

  const finish = async () => {
    if (!saved) {
      setError(t('security.recoveryMustSave'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await changePin(viaBiometric ? null : currentPin, pin, newCode, viaBiometric);
      if (!res.ok) {
        if (res.failure === 'delay') setError(delayText(res.retryAfterMs));
        else if (res.failure === 'invalid') {
          setError(t(viaBiometric ? 'security.biometricFailed' : 'security.pinInvalid'));
          setStep('verify');
        } else setError(t('security.changeFailed'));
        return;
      }
      toast.success(t('security.toastPinChanged'));
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto bg-card text-ink">
        <DialogHeader>
          <DialogTitle>{t('security.changePin')}</DialogTitle>
          <DialogDescription>{t('security.changePinDesc')}</DialogDescription>
        </DialogHeader>

        {step === 'verify' && (
          <div className="flex flex-col gap-3">
            <PinInput value={currentPin} onChange={setCurrentPin} label={t('security.currentPin')} autoFocus />
            {security.canResetWithBiometric && (
              <button
                type="button"
                onClick={chooseBiometric}
                className="flex items-center justify-center gap-1.5 rounded-full border border-line px-4 py-2 text-xs font-medium text-accent"
              >
                <Fingerprint size={14} />
                {t('security.useBiometric')}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void verifyPin()}
              className="flex items-center justify-center gap-1.5 rounded-full bg-accent px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy && <Loader2 size={13} className="animate-spin" />}
              {t('security.verify')}
            </button>
          </div>
        )}

        {step === 'newPin' && (
          <div className="flex flex-col gap-3">
            <PinInput value={pin} onChange={setPin} label={t('security.newPin')} autoFocus />
            <PinInput value={pin2} onChange={setPin2} label={t('security.confirmPin')} onEnter={nextFromPin} />
            <button
              type="button"
              onClick={nextFromPin}
              className="rounded-full bg-accent px-4 py-2.5 text-xs font-semibold text-white"
            >
              {t('common.next')}
            </button>
          </div>
        )}

        {step === 'saved' && (
          <div className="flex flex-col gap-3">
            <RecoveryCodeCard code={newCode} saved={saved} onSavedChange={setSaved} />
            <button
              type="button"
              disabled={busy || !saved}
              onClick={() => void finish()}
              className="flex items-center justify-center gap-1.5 rounded-full bg-accent px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy && <Loader2 size={13} className="animate-spin" />}
              {t('security.saveNewPin')}
            </button>
          </div>
        )}

        {error && <p className="text-xs leading-relaxed text-red-500" role="alert">{error}</p>}

        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-line px-4 py-2 text-xs font-medium text-ink-2"
          >
            {t('common.cancel')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================== 关闭应用锁 ============================== */

export function DisableLockDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useI18n();
  const security = useSecurity();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPin('');
    setError('');
    setBusy(false);
  }, [open]);

  const run = async (viaBiometric: boolean) => {
    setBusy(true);
    setError('');
    try {
      const res = await disableLock(viaBiometric ? null : pin, viaBiometric);
      if (!res.ok) {
        if (res.failure === 'delay') setError(delayText(res.retryAfterMs));
        else setError(t(viaBiometric ? 'security.biometricFailed' : 'security.pinInvalid'));
        return;
      }
      toast.success(t('security.toastDisabled'));
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="bg-card text-ink">
        <DialogHeader>
          <DialogTitle>{t('security.disableLockTitle')}</DialogTitle>
          <DialogDescription>{t('security.disableLockDesc')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <PinInput value={pin} onChange={setPin} label={t('security.currentPin')} autoFocus onEnter={() => void run(false)} />
          {security.canResetWithBiometric && (
            <button
              type="button"
              onClick={() => void run(true)}
              className="flex items-center justify-center gap-1.5 rounded-full border border-line px-4 py-2 text-xs font-medium text-accent"
            >
              <Fingerprint size={14} />
              {t('security.useBiometric')}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(false)}
            className="flex items-center justify-center gap-1.5 rounded-full bg-red-500 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {busy && <Loader2 size={13} className="animate-spin" />}
            {t('security.disable')}
          </button>
        </div>
        {error && <p className="text-xs leading-relaxed text-red-500" role="alert">{error}</p>}
        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-line px-4 py-2 text-xs font-medium text-ink-2"
          >
            {t('common.cancel')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================== 重新生成恢复码 ============================== */

type RecoveryStep = 'verify' | 'show';

export function RecoveryCodeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useI18n();
  const security = useSecurity();
  const [step, setStep] = useState<RecoveryStep>('verify');
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep('verify');
    setPin('');
    setCode('');
    setSaved(false);
    setError('');
    setBusy(false);
  }, [open]);

  const showNewCode = () => {
    setCode(generateRecoveryCode());
    setSaved(false);
    setStep('show');
  };

  const verifyPin = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await verifyCurrentPin(pin);
      if (!res.ok) {
        setError(res.failure === 'delay' ? delayText(res.retryAfterMs) : t('security.pinInvalid'));
        return;
      }
      showNewCode();
    } finally {
      setBusy(false);
    }
  };

  const regenerateViaBiometric = async () => {
    setBusy(true);
    setError('');
    try {
      const ok = await verifyStrongBiometricForReset();
      if (!ok) {
        setError(t('security.biometricFailed'));
        return;
      }
      showNewCode();
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!saved) {
      setError(t('security.recoveryMustSave'));
      return;
    }
    setBusy(true);
    try {
      await saveNewRecoveryCode(code);
      toast.success(t('security.toastRecoveryGenerated'));
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto bg-card text-ink">
        <DialogHeader>
          <DialogTitle>{t('security.recoveryCode')}</DialogTitle>
          <DialogDescription>{t('security.recoveryCodeRegenerateDesc')}</DialogDescription>
        </DialogHeader>

        {step === 'verify' && (
          <div className="flex flex-col gap-3">
            <PinInput value={pin} onChange={setPin} label={t('security.currentPin')} autoFocus onEnter={() => void verifyPin()} />
            {security.canResetWithBiometric && (
              <button
                type="button"
                onClick={() => void regenerateViaBiometric()}
                className="flex items-center justify-center gap-1.5 rounded-full border border-line px-4 py-2 text-xs font-medium text-accent"
              >
                <Fingerprint size={14} />
                {t('security.useBiometric')}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void verifyPin()}
              className="flex items-center justify-center gap-1.5 rounded-full bg-accent px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy && <Loader2 size={13} className="animate-spin" />}
              {t('security.verify')}
            </button>
          </div>
        )}

        {step === 'show' && (
          <div className="flex flex-col gap-3">
            <RecoveryCodeCard code={code} saved={saved} onSavedChange={setSaved} />
            <button
              type="button"
              disabled={busy || !saved}
              onClick={() => void save()}
              className="flex items-center justify-center gap-1.5 rounded-full bg-accent px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy && <Loader2 size={13} className="animate-spin" />}
              {t('security.saveRecoveryCode')}
            </button>
          </div>
        )}

        {error && <p className="text-xs leading-relaxed text-red-500" role="alert">{error}</p>}
        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-line px-4 py-2 text-xs font-medium text-ink-2"
          >
            {t('common.cancel')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
