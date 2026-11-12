/**
 * 第二 PIN（duress / decoy）设置与移除。
 * 必须验证当前真实 PIN；第二 PIN 打开空演示资料库，不展示真实数据。
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { removeDuressPin, setDuressPin } from '@/lib/security/state';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui';
import { PinInput } from './PinInput';

function delayText(ms?: number): string {
  return t('security.wrongPin', { n: Math.ceil((ms ?? 0) / 1000) });
}

export function DuressPinDialog({
  open,
  mode,
  onClose,
}: {
  open: boolean;
  mode: 'set' | 'remove';
  onClose: () => void;
}) {
  useI18n();
  const [currentPin, setCurrentPin] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // 打开或切换模式时清空上一次输入；渲染期对比派生重置，避免 effect 内同步 setState
  const [prev, setPrev] = useState({ open, mode });
  if (prev.open !== open || prev.mode !== mode) {
    setPrev({ open, mode });
    if (open) {
      setCurrentPin('');
      setPin('');
      setPin2('');
      setError('');
      setBusy(false);
    }
  }

  const submit = () => {
    if (busy) return;
    if (mode === 'set') {
      if (!/^\d{6}$/.test(pin)) {
        setError(t('security.pinInvalid'));
        return;
      }
      if (pin !== pin2) {
        setError(t('security.pinMismatch'));
        return;
      }
    }
    setBusy(true);
    setError('');
    void (async () => {
      try {
        const res = mode === 'set'
          ? await setDuressPin(currentPin, pin)
          : await removeDuressPin(currentPin);
        if (!res.ok) {
          if (res.failure === 'delay') setError(delayText(res.retryAfterMs));
          else if (res.failure === 'invalid') setError(t('security.pinInvalid'));
          else if (res.failure === 'unavailable') setError(t('security.enableFailed'));
          else setError(t('security.duressSamePin'));
          return;
        }
        toast.success(t(mode === 'set' ? 'security.toastDuressSet' : 'security.toastDuressRemoved'));
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : t('security.changeFailed'));
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <Dialog open={open} onOpenChange={(value) => (!value && !busy ? onClose() : undefined)}>
      <DialogContent className="rounded-3xl border-0 bg-card sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-ink">
            {t(mode === 'set' ? 'security.duressTitleSet' : 'security.duressTitleRemove')}
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed text-ink-2">
            {t(mode === 'set' ? 'security.duressDesc' : 'security.duressRemoveDesc')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <PinInput
            value={currentPin}
            onChange={setCurrentPin}
            label={t('security.duressCurrent')}
            autoFocus
            disabled={busy}
          />
          {mode === 'set' && (
            <>
              <PinInput value={pin} onChange={setPin} label={t('security.duressNew')} disabled={busy} />
              <PinInput
                value={pin2}
                onChange={setPin2}
                label={t('security.confirmPin')}
                disabled={busy}
                onEnter={submit}
              />
            </>
          )}
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="mt-1 flex gap-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="flex-1 rounded-full bg-surface-hi py-2.5 text-sm font-medium text-ink transition-opacity hover:opacity-80 disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={submit}
              disabled={busy}
              className="flex-1 rounded-full bg-accent py-2.5 text-sm font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {t(mode === 'set' ? 'common.save' : 'common.delete')}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
