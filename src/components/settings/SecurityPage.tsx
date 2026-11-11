/**
 * 设置 → 隐私与安全。
 * 应用锁、生物识别、恢复码、后台遮罩、Android 禁止截屏与低调模式。
 */

import { useEffect, useState } from 'react';
import {
  EyeOff,
  Fingerprint,
  KeyRound,
  LockKeyhole,
  Shield,
  Smartphone,
} from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { isNative } from '@/lib/platform';
import {
  authenticateBiometric,
  detectBiometric,
  registerWebAuthnCredential,
  restartNativeApp,
  type BiometricAvailability,
  type BiometricCopy,
} from '@/lib/security/biometric';
import { useSecurity } from '@/lib/security/hook';
import { lockNowSafely } from '@/lib/security/manualLock';
import {
  setBackgroundMask,
  setBiometric,
  setDiscreetPreset,
  setSecureScreen,
} from '@/lib/security/state';
import type { DiscreetPreset } from '@/lib/security/types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@/components/ui';
import { cn } from '@/lib/utils';
import { SELECT_TRIGGER_CLASS, SettingsSection, SettingRow, SettingsSubPage } from './rows';
import { ChangePinDialog, DisableLockDialog, LockSetupDialog, RecoveryCodeDialog } from '@/components/security/SecurityDialogs';

function bioCopy(): BiometricCopy {
  return {
    title: t('security.biometricTitle'),
    subtitle: t('security.biometricSubtitle'),
    cancel: t('security.usePin'),
  };
}

function biometricLabel(availability: BiometricAvailability): string {
  if (availability.android === 'strong') return t('security.biometricStrong');
  if (availability.android === 'weak') return t('security.biometricWeak');
  return t('security.biometricUnlockOnly');
}

const PRESET_LABEL: Record<DiscreetPreset, 'security.discreetNormal' | 'security.discreetVoiceNotes' | 'security.discreetVocalLog' | 'security.discreetAudioJournal'> = {
  normal: 'security.discreetNormal',
  voiceNotes: 'security.discreetVoiceNotes',
  vocalLog: 'security.discreetVocalLog',
  audioJournal: 'security.discreetAudioJournal',
};

export function SecurityPage({ onBack }: { onBack: () => void }) {
  useI18n();
  const security = useSecurity();
  const [setupOpen, setSetupOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [changePinOpen, setChangePinOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [availability, setAvailability] = useState<BiometricAvailability | null>(null);
  const [pendingPreset, setPendingPreset] = useState<DiscreetPreset | null>(null);
  const [busy, setBusy] = useState(false);

  const android = isNative;
  const biometricOn = security.biometric.android !== 'none' || security.biometric.web || security.biometric.windows;

  useEffect(() => {
    void detectBiometric().then(setAvailability).catch(() => setAvailability(null));
  }, []);

  const toggleLock = (enabled: boolean) => {
    if (enabled) setSetupOpen(true);
    else setDisableOpen(true);
  };

  const enableBiometric = async () => {
    setBusy(true);
    try {
      const avail = availability ?? await detectBiometric();
      setAvailability(avail);
      if (!avail || (avail.android === 'none' && !avail.web && !avail.windows)) {
        toast.error(t('security.biometricUnavailable'));
        return;
      }
      if (!security.hasRecovery && avail.android !== 'strong') {
        toast.error(t('security.recoveryRequired'));
        return;
      }
      if (avail.android !== 'none') {
        const ok = await authenticateBiometric(
          { android: avail.android, web: false, windows: false },
          bioCopy(),
        );
        if (!ok) {
          toast.error(t('security.biometricFailed'));
          return;
        }
        await setBiometric({ android: avail.android, web: false, windows: false });
      } else if (avail.windows) {
        const ok = await authenticateBiometric(
          { android: 'none', web: false, windows: true },
          bioCopy(),
        );
        if (!ok) {
          toast.error(t('security.biometricFailed'));
          return;
        }
        await setBiometric({ android: 'none', web: false, windows: true });
      } else if (avail.web) {
        const credential = await registerWebAuthnCredential();
        if (!credential) {
          toast.error(t('security.biometricFailed'));
          return;
        }
        await setBiometric({
          android: 'none',
          web: true,
          windows: false,
          webauthnCredentialId: credential,
        });
      }
      toast.success(t('security.toastBiometricOn'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('security.biometricFailed'));
    } finally {
      setBusy(false);
    }
  };

  const disableBiometric = async () => {
    setBusy(true);
    try {
      await setBiometric({ android: 'none', web: false, windows: false });
      toast.success(t('security.toastBiometricOff'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('security.recoveryRequired'));
    } finally {
      setBusy(false);
    }
  };

  const applyPreset = async () => {
    if (!pendingPreset) return;
    setBusy(true);
    try {
      await setDiscreetPreset(pendingPreset);
      setPendingPreset(null);
      await restartNativeApp();
    } catch {
      toast.error(t('security.discreetSwitchFailed'));
      setBusy(false);
    }
  };

  return (
    <SettingsSubPage title={t('security.title')} onBack={onBack}>
      <SettingsSection icon={LockKeyhole} title={t('security.appLock')}>
        <SettingRow label={t('security.appLock')} desc={t('security.appLockDesc')}>
          <Switch aria-label={t('security.appLock')} checked={security.enabled} onCheckedChange={toggleLock} />
        </SettingRow>
        {security.enabled && (
          <>
            <SettingRow label={t('security.changePin')} desc={t('security.changePinDesc')}>
              <button
                type="button"
                onClick={() => setChangePinOpen(true)}
                className="rounded-full bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent"
              >
                {t('security.changePin')}
              </button>
            </SettingRow>
            <SettingRow label={t('security.lockNow')} desc={t('security.lockNowDesc')}>
              <button
                type="button"
                onClick={() => void lockNowSafely()}
                className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white"
              >
                {t('security.lockNow')}
              </button>
            </SettingRow>
          </>
        )}
      </SettingsSection>

      {security.enabled && (
        <SettingsSection icon={Fingerprint} title={t('security.unlockSection')}>
          <SettingRow
            label={t('security.biometric')}
            desc={availability ? biometricLabel(availability) : t('security.biometricUnavailable')}
          >
            <Switch
              aria-label={t('security.biometric')}
              checked={biometricOn}
              disabled={busy || !availability || (availability.android === 'none' && !availability.web && !availability.windows)}
              onCheckedChange={(value) => {
                if (value) void enableBiometric();
                else void disableBiometric();
              }}
            />
          </SettingRow>

          <SettingRow
            label={t('security.recoveryCode')}
            desc={security.hasRecovery ? t('security.recoverySet') : t('security.recoveryNotSet')}
          >
            <button
              type="button"
              onClick={() => setRecoveryOpen(true)}
              className="flex items-center gap-1 rounded-full bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent"
            >
              <KeyRound size={12} />
              {security.hasRecovery ? t('security.recoveryRegenerate') : t('security.recoveryGenerate')}
            </button>
          </SettingRow>

          <SettingRow label={t('security.autoLock')} desc={t('security.autoLockDesc')}>
            <span className="text-xs font-medium text-ink-2">{t('security.fiveMinutes')}</span>
          </SettingRow>
        </SettingsSection>
      )}

      {security.enabled && (
        <SettingsSection icon={EyeOff} title={t('security.privacyScreen')}>
          <SettingRow label={t('security.backgroundMask')} desc={t('security.backgroundMaskDesc')}>
            <Switch
              aria-label={t('security.backgroundMask')}
              checked={security.privacy.backgroundMask}
              onCheckedChange={(value) => void setBackgroundMask(value)}
            />
          </SettingRow>
          {android && (
            <SettingRow label={t('security.secureScreen')} desc={t('security.secureScreenDesc')}>
              <Switch
                aria-label={t('security.secureScreen')}
                checked={security.privacy.secureScreen}
                onCheckedChange={(value) => void setSecureScreen(value)}
              />
            </SettingRow>
          )}
        </SettingsSection>
      )}

      {security.enabled && android && (
        <SettingsSection icon={Smartphone} title={t('security.discreetMode')}>
          <SettingRow label={t('security.discreetMode')} desc={t('security.discreetModeDesc')} stacked>
            <Select
              value={security.discreet}
              onValueChange={(value) => setPendingPreset(value as DiscreetPreset)}
            >
              <SelectTrigger
                aria-label={t('security.discreetMode')}
                className={cn(SELECT_TRIGGER_CLASS, 'w-full justify-between')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['normal', 'voiceNotes', 'vocalLog', 'audioJournal'] as DiscreetPreset[]).map((preset) => (
                  <SelectItem key={preset} value={preset}>
                    {t(PRESET_LABEL[preset])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-2">{t('security.discreetNotificationOff')}</p>
          </SettingRow>
        </SettingsSection>
      )}

      <div className="flex items-center gap-2 px-1 text-[11px] leading-relaxed text-ink-2">
        <Shield size={13} className="shrink-0" />
        <span>{t('security.localOnly')}</span>
      </div>

      <LockSetupDialog open={setupOpen} onClose={() => setSetupOpen(false)} />
      <DisableLockDialog open={disableOpen} onClose={() => setDisableOpen(false)} />
      <ChangePinDialog open={changePinOpen} onClose={() => setChangePinOpen(false)} />
      <RecoveryCodeDialog open={recoveryOpen} onClose={() => setRecoveryOpen(false)} />

      <AlertDialog open={pendingPreset != null} onOpenChange={(value) => { if (!value) setPendingPreset(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('security.discreetSwitchTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('security.discreetSwitchDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void applyPreset()}>
              {t('security.discreetSwitchAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSubPage>
  );
}
