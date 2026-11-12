/**
 * 数据去向面板（设置 → 数据 首个区块，只读为主）
 * - 标题旁的 ⓘ 收纳四条数据边界说明（本机存储 / 云备份 / 本地备份 / AI 上传内容）
 * - 云备份现状：GitHub 连接、WebDAV 配置、加密开关
 * AI 请求日志已拆成独立子页（LlmRequestLogPage，入口在数据页）。
 */

import { useEffect, useState } from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { getStoredLogin } from '@/lib/backup/github';
import { getWebdavConfig } from '@/lib/backup/webdav';
import { getBackupCryptoConfig, isBackupEncryptionUnlocked, lockBackupEncryption } from '@/lib/backup/crypto';
import { BACKUP_CHANGED_EVENT } from '@/lib/backup/bus';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { SettingsSection, SettingRow } from './rows';
import { InfoTip } from './InfoTip';

/** 五条数据边界说明（合成一段放进 ⓘ 浮窗） */
const BOUNDARY_KEYS = ['privacy.lineLocal', 'privacy.lineCloud', 'privacy.lineLocalBackup', 'privacy.lineLlm', 'privacy.lineWebSearch'] as const;

export function PrivacyPanel() {
  useI18n();
  const [ghLogin, setGhLogin] = useState<string | null>(null);
  const [webdavOn, setWebdavOn] = useState(false);
  const [encOn, setEncOn] = useState(false);

  useEffect(() => {
    // 云备份三项状态跟着写入侧走：加密开关/连接配置变更（含同页其他区块）发事件，这里重读
    const reload = () => void (async () => {
      try {
        setGhLogin(await getStoredLogin());
        setWebdavOn((await getWebdavConfig()) != null);
        setEncOn((await getBackupCryptoConfig())?.enabled === true);
      } catch {
        /* IndexedDB 不可用时保持未知态 */
      }
    })();
    reload();
    window.addEventListener(BACKUP_CHANGED_EVENT, reload);
    return () => window.removeEventListener(BACKUP_CHANGED_EVENT, reload);
  }, []);

  return (
    <SettingsSection
      icon={ShieldCheck}
      title={(
        <InfoTip
          label={t('privacy.title')}
          text={BOUNDARY_KEYS.map((k) => t(k)).join('\n\n')}
          wide
        />
      )}
    >
      {/* 云备份现状 */}
      <SettingRow label={t('privacy.ghRow')} desc={ghLogin ? t('privacy.ghConnected', { login: ghLogin }) : t('privacy.ghNot')} />
      <SettingRow label={t('privacy.webdavRow')} desc={webdavOn ? t('privacy.webdavOn') : t('privacy.webdavOff')} />
      <SettingRow label={t('privacy.encRow')} desc={!encOn ? t('privacy.encOff') : isBackupEncryptionUnlocked() ? t('privacy.encOn') : t('privacy.encLocked')}>
        {/* 已解锁时提供「立即锁定」：清掉内存口令，之后云备份操作需重新输入 */}
        {encOn && isBackupEncryptionUnlocked() && (
          <button
            onClick={() => {
              lockBackupEncryption();
              toast.success(t('privacy.encLockedNow'));
            }}
            className="flex items-center gap-1 px-1 py-1 text-[11px] font-medium text-ink-2 transition-opacity hover:opacity-70"
          >
            <Lock size={11} />
            {t('privacy.encLockNow')}
          </button>
        )}
      </SettingRow>
    </SettingsSection>
  );
}
