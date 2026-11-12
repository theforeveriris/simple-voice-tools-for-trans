/**
 * 设置 → 数据：桌面本地只读 API。
 * 仅 Tauri 桌面版显示；默认关闭，启动时由前端把 IndexedDB 快照推给 Rust。
 */

import { useEffect, useState } from 'react';
import { Copy, Terminal } from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { isTauri } from '@/lib/platform';
import {
  getLocalApiStatus, startLocalApi, stopLocalApi,
  type LocalApiStatus,
} from '@/lib/desktop/localApi';
import { SettingsSection, SettingRow } from './rows';

const CODE_CLASS =
  'break-all rounded-xl bg-surface-hi px-3 py-2 font-mono text-[11px] leading-relaxed text-ink';

export function LocalApiSection() {
  useI18n();
  const [status, setStatus] = useState<LocalApiStatus>({ running: false });
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri) return;
    void getLocalApiStatus().then(setStatus);
  }, []);

  const toggle = () => {
    if (busy) return;
    setBusy(true);
    void (async () => {
      try {
        if (status.running) {
          await stopLocalApi();
          setStatus({ running: false });
        } else {
          setStatus(await startLocalApi());
        }
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : t('settings.localApiStartFail'));
      } finally {
        setBusy(false);
      }
    })();
  };

  const copy = (value: string, key: string) => {
    const write = navigator.clipboard?.writeText(value);
    if (!write) return;
    void write.then(() => {
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1500);
    }).catch(() => undefined);
  };

  const copyButton = (value: string, key: string) => (
    <button
      onClick={() => copy(value, key)}
      aria-label={t('settings.localApiCopy')}
      className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-hi text-ink-2 transition-colors hover:text-ink"
    >
      <Copy size={13} />
    </button>
  );

  if (!isTauri) return null;

  return (
    <SettingsSection icon={Terminal} title={t('settings.localApi')}>
      <SettingRow
        label={t('settings.localApi')}
        desc={status.running ? t('settings.localApiOn') : t('settings.localApiOff')}
      >
        <button
          onClick={toggle}
          disabled={busy}
          className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {status.running ? t('settings.localApiStop') : t('settings.localApiStart')}
        </button>
      </SettingRow>

      {status.running && status.url && status.token && (
        <>
          <SettingRow label={t('settings.localApiUrl')} stacked>
            <div className="flex w-full items-center gap-2">
              <span className={CODE_CLASS}>{status.url}</span>
              {copyButton(status.url, 'url')}
            </div>
          </SettingRow>
          <SettingRow label={t('settings.localApiToken')} stacked>
            <div className="flex w-full items-center gap-2">
              <span className={CODE_CLASS}>{status.token}</span>
              {copyButton(status.token, 'token')}
            </div>
          </SettingRow>
          <SettingRow label={t('settings.localApiEndpoints')} stacked desc={t('settings.localApiEndpointsDesc')}>
            <div className={CODE_CLASS}>
              <p>GET /records</p>
              <p>GET /trends?since=2026-01-01</p>
              <p>GET /export?format=csv&amp;since=2026-01-01</p>
            </div>
          </SettingRow>
          <p className="px-1 font-mono text-[10px] leading-relaxed text-ink-2">
            svt export --url {status.url} --token {status.token} --since 2026-01-01
          </p>
        </>
      )}

      <p className="px-1 text-[10px] leading-relaxed text-ink-2">{t('settings.localApiDesc')}</p>
      <p className="px-1 text-[10px] leading-relaxed text-ink-2/80">{t('settings.localApiReadonly')}</p>
      {copied && <p className="px-1 text-[10px] text-accent">{t('settings.localApiCopied')}</p>}
    </SettingsSection>
  );
}
