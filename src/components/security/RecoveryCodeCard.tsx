/**
 * 一次性恢复码展示卡：只展示一次、只复制不下载。
 * 用户必须勾选「我已保存」才能继续（由调用方决定是否强制）。
 */

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { formatRecoveryCode } from '@/lib/security/crypto';
import { cn } from '@/lib/utils';

export function RecoveryCodeCard({
  code,
  saved,
  onSavedChange,
}: {
  code: string;
  saved: boolean;
  onSavedChange: (value: boolean) => void;
}) {
  useI18n();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatRecoveryCode(code));
      setCopyFailed(false);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-2xl border border-line bg-surface-hi px-4 py-4 text-center">
        <p className="font-mono text-base font-semibold tracking-[0.12em] text-ink">
          {formatRecoveryCode(code)}
        </p>
      </div>

      <button
        type="button"
        onClick={() => void copy()}
        className="flex items-center justify-center gap-1.5 rounded-full bg-accent-soft px-4 py-2 text-xs font-semibold text-accent transition-opacity active:opacity-70"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
        {copied ? t('security.codeCopied') : t('security.copyCode')}
      </button>

      {copyFailed && (
        <p className="text-xs text-red-500">{t('security.copyFailed')}</p>
      )}

      <p className="text-[11px] leading-relaxed text-ink-2">
        {t('security.recoveryOnce')}
      </p>

      <label className="flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-ink">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => onSavedChange(event.target.checked)}
          aria-label={t('security.recoverySaved')}
          className="mt-0.5 size-4 accent-[var(--accent)]"
        />
        <span>{t('security.recoverySaved')}</span>
      </label>

      <p className={cn('text-[11px] leading-relaxed', saved ? 'text-ink-2' : 'text-amber-600')}>
        {t('security.recoveryWarning')}
      </p>
    </div>
  );
}
