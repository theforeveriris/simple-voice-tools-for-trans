/**
 * 锁屏「忘记 PIN」流程。
 * 生物识别重置（仅 Android 强生物识别）/ 恢复码重置 / 清除所有数据。
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, Fingerprint, KeyRound, Loader2, Trash2 } from 'lucide-react';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { generateRecoveryCode } from '@/lib/security/crypto';
import { useSecurity } from '@/lib/security/hook';
import {
  clearAllSecurityData,
  resetPinWithRecovery,
  resetPinWithStrongBiometric,
  verifyRecoveryCodeForReset,
} from '@/lib/security/state';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui';
import { PinInput } from './PinInput';
import { RecoveryCodeCard } from './RecoveryCodeCard';

type Step = 'choose' | 'recovery' | 'pin' | 'saved' | 'clear1' | 'clear2';
type Method = 'biometric' | 'recovery' | 'clear';

export function ForgotPinDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useI18n();
  const security = useSecurity();
  const [step, setStep] = useState<Step>('choose');
  const [method, setMethod] = useState<Method | null>(null);
  const [recoveryInput, setRecoveryInput] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [newCode, setNewCode] = useState('');
  const [saved, setSaved] = useState(false);
  const [deleteWord, setDeleteWord] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep('choose');
    setMethod(null);
    setRecoveryInput('');
    setPin('');
    setPin2('');
    setNewCode('');
    setSaved(false);
    setDeleteWord('');
    setError('');
    setBusy(false);
  }, [open]);

  const goNewPin = (nextMethod: Method) => {
    setMethod(nextMethod);
    setError('');
    setStep('pin');
  };

  const verifyRecovery = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await verifyRecoveryCodeForReset(recoveryInput);
      if (!res.ok) {
        setError(res.failure === 'delay'
          ? t('security.wrongRecoveryDelay', { n: Math.ceil((res.retryAfterMs ?? 0) / 1000) })
          : t('security.recoveryCodeInvalid'));
        return;
      }
      goNewPin('recovery');
    } finally {
      setBusy(false);
    }
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
    if (!newCode || !saved) {
      setError(t('security.recoveryMustSave'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = method === 'biometric'
        ? await resetPinWithStrongBiometric(pin, newCode)
        : await resetPinWithRecovery(recoveryInput, pin, newCode);
      if (!res.ok) {
        if (res.failure === 'delay') {
          setError(t('security.wrongRecoveryDelay', { n: Math.ceil((res.retryAfterMs ?? 0) / 1000) }));
        } else if (res.failure === 'invalid') {
          setError(t('security.recoveryCodeInvalid'));
          setStep(method === 'recovery' ? 'recovery' : 'choose');
        } else {
          setError(t('security.unlockFailed'));
        }
        return;
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    if (deleteWord.trim().toUpperCase() !== 'DELETE') {
      setError(t('security.clearTypeDelete'));
      return;
    }
    setBusy(true);
    await clearAllSecurityData();
  };

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="z-[320] max-h-[85vh] overflow-y-auto bg-card text-ink">
        <DialogHeader>
          <DialogTitle>{t('security.forgotPinTitle')}</DialogTitle>
          <DialogDescription>{t('security.forgotPinDesc')}</DialogDescription>
        </DialogHeader>

        {step === 'choose' && (
          <div className="flex flex-col gap-2">
            {security.canResetWithBiometric && (
              <button
                type="button"
                onClick={() => goNewPin('biometric')}
                className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3 text-left transition-colors hover:bg-surface-hi"
              >
                <Fingerprint size={18} className="text-accent" />
                <span className="flex flex-col">
                  <span className="text-sm font-semibold text-ink">{t('security.resetWithBiometric')}</span>
                  <span className="text-[11px] text-ink-2">{t('security.resetWithBiometricDesc')}</span>
                </span>
              </button>
            )}

            {security.hasRecovery && (
              <button
                type="button"
                onClick={() => { setMethod('recovery'); setStep('recovery'); setError(''); }}
                className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3 text-left transition-colors hover:bg-surface-hi"
              >
                <KeyRound size={18} className="text-accent" />
                <span className="flex flex-col">
                  <span className="text-sm font-semibold text-ink">{t('security.resetWithRecovery')}</span>
                  <span className="text-[11px] text-ink-2">{t('security.resetWithRecoveryDesc')}</span>
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => { setMethod('clear'); setStep('clear1'); setError(''); }}
              className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3 text-left transition-colors hover:bg-surface-hi"
            >
              <Trash2 size={18} className="text-red-500" />
              <span className="flex flex-col">
                <span className="text-sm font-semibold text-ink">{t('security.clearData')}</span>
                <span className="text-[11px] text-ink-2">{t('security.clearDataDesc')}</span>
              </span>
            </button>
          </div>
        )}

        {step === 'recovery' && (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink-2">{t('security.recoveryInput')}</span>
              <input
                value={recoveryInput}
                onChange={(event) => setRecoveryInput(event.target.value.toUpperCase())}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
                className="w-full rounded-2xl border border-line bg-card px-4 py-3 font-mono text-sm tracking-wider text-ink outline-none focus:border-accent"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep('choose')}
                className="flex-1 rounded-full border border-line px-4 py-2 text-xs font-medium text-ink-2"
              >
                {t('common.back')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void verifyRecovery()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {busy && <Loader2 size={13} className="animate-spin" />}
                {t('security.verify')}
              </button>
            </div>
          </div>
        )}

        {step === 'pin' && (
          <div className="flex flex-col gap-3">
            <PinInput value={pin} onChange={setPin} label={t('security.newPin')} autoFocus />
            <PinInput value={pin2} onChange={setPin2} label={t('security.confirmPin')} onEnter={nextFromPin} />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep(method === 'recovery' ? 'recovery' : 'choose')}
                className="flex-1 rounded-full border border-line px-4 py-2 text-xs font-medium text-ink-2"
              >
                {t('common.back')}
              </button>
              <button
                type="button"
                onClick={nextFromPin}
                className="flex-1 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white"
              >
                {t('common.ok')}
              </button>
            </div>
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
              {t('security.resetAndUnlock')}
            </button>
          </div>
        )}

        {step === 'clear1' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2 rounded-2xl bg-red-500/10 px-4 py-3 text-xs leading-relaxed text-red-600">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{t('security.clearDataWarning')}</span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep('choose')}
                className="flex-1 rounded-full border border-line px-4 py-2 text-xs font-medium text-ink-2"
              >
                {t('common.back')}
              </button>
              <button
                type="button"
                onClick={() => { setStep('clear2'); setError(''); }}
                className="flex-1 rounded-full bg-red-500 px-4 py-2 text-xs font-semibold text-white"
              >
                {t('common.delete')}
              </button>
            </div>
          </div>
        )}

        {step === 'clear2' && (
          <div className="flex flex-col gap-3">
            <p className="text-xs leading-relaxed text-ink-2">{t('security.clearDataTypeHint')}</p>
            <input
              value={deleteWord}
              onChange={(event) => setDeleteWord(event.target.value)}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="DELETE"
              className="w-full rounded-2xl border border-line bg-card px-4 py-3 text-center font-mono text-sm tracking-widest text-ink outline-none focus:border-accent"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep('clear1')}
                className="flex-1 rounded-full border border-line px-4 py-2 text-xs font-medium text-ink-2"
              >
                {t('common.back')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void clearAll()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-red-500 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {busy && <Loader2 size={13} className="animate-spin" />}
                {t('security.clearDataConfirm')}
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
