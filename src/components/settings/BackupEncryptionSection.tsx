/**
 * 云备份加密区块（设置 → 数据 → 备份与恢复下方）
 * 状态展示 + 开启 / 更换口令 / 会话解锁 / 关闭。
 * 口令只存内存（会话级）；加密覆盖 GitHub / WebDAV 云端上传，
 * 并可选地复用于手动 ZIP 导出与本地自动备份（同一口令）。
 */

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, LockOpen } from 'lucide-react';
import { toast } from 'sonner';
import {
  getBackupCryptoConfig, disableBackupEncryption, isBackupEncryptionUnlocked,
  setLocalBackupEncryptionEnabled, type BackupCryptoConfig,
} from '@/lib/backup/crypto';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
  Switch,
} from '@/components/ui';
import { SettingsSection, SettingRow } from './rows';
import { InfoTip } from './InfoTip';
import { BackupPassphraseDialog } from './BackupPassphraseDialog';

export function BackupEncryptionSection({ onChanged }: { onChanged?: () => void } = {}) {
  useI18n();
  const [cfg, setCfg] = useState<BackupCryptoConfig | null>(null);
  const [dialog, setDialog] = useState<'enable' | 'change' | 'unlock' | null>(null);

  const refresh = useCallback(() => {
    void getBackupCryptoConfig().then(setCfg);
  }, []);
  useEffect(refresh, [refresh]);

  const enabled = cfg?.enabled === true;
  // 会话锁定态在渲染时读内存即可（不入 React 状态：解锁可能发生在本组件之外，
  // 对话框成功后经 onDone → refresh 重新取配置触发重渲染）
  const unlocked = isBackupEncryptionUnlocked();
  const statusText = !enabled
    ? t('settings.encStatusOff')
    : unlocked ? t('settings.encStatusOn') : t('settings.encStatusLocked');

  return (
    <>
      <SettingsSection icon={KeyRound} title={t('settings.encTitle')}>
        <SettingRow
          label={<InfoTip label={t('settings.encStatus')} text={t('settings.encDesc')} />}
          desc={statusText}
        >
          <button
            onClick={() => setDialog(enabled ? 'change' : 'enable')}
            className="flex items-center gap-1.5 px-1 py-2 text-xs font-medium text-accent transition-opacity hover:opacity-70"
          >
            {enabled ? t('settings.encActionChange') : t('settings.encActionEnable')}
          </button>
        </SettingRow>
        {enabled && (
          <SettingRow label={<InfoTip label={t('settings.encLocal')} text={t('settings.encLocalDesc')} />}>
            <Switch
              checked={cfg?.localEnabled === true}
              onCheckedChange={(v) => {
                void setLocalBackupEncryptionEnabled(v).then(() => {
                  refresh();
                  onChanged?.();
                });
              }}
            />
          </SettingRow>
        )}
        {enabled && !unlocked && (
          <SettingRow label={t('settings.encUnlockRow')} desc={t('settings.encUnlockRowDesc')}>
            <button
              onClick={() => setDialog('unlock')}
              className="flex items-center gap-1.5 px-1 py-2 text-xs font-medium text-accent transition-opacity hover:opacity-70"
            >
              <LockOpen size={14} />
              {t('settings.encActionUnlock')}
            </button>
          </SettingRow>
        )}
        {enabled && (
          <SettingRow label={t('settings.encDisableRow')}>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button className="flex items-center gap-1.5 px-1 py-2 text-xs font-medium text-red-500 transition-opacity hover:opacity-70">
                  {t('settings.encActionDisable')}
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent className="rounded-3xl border-0 bg-card">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-ink">{t('settings.encDisableTitle')}</AlertDialogTitle>
                  <AlertDialogDescription className="text-ink-2">
                    {t('settings.encDisableDesc')}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="rounded-none border-0 bg-transparent text-sm font-medium text-ink-2 shadow-none">
                    {t('common.cancel')}
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      void disableBackupEncryption().then(() => {
                        refresh();
                        onChanged?.();
                        toast.success(t('toast.encDisabled'));
                      });
                    }}
                    className="rounded-none bg-red-500 text-sm text-white hover:bg-red-500/90"
                  >
                    {t('settings.encDisableConfirm')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </SettingRow>
        )}
      </SettingsSection>

      <BackupPassphraseDialog
        mode={dialog ?? 'enable'}
        open={dialog != null}
        onOpenChange={(v) => {
          if (!v) setDialog(null);
        }}
        onDone={() => {
          refresh();
          onChanged?.();
        }}
      />
    </>
  );
}
