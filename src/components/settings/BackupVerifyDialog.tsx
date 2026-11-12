/**
 * 备份完整性检查结果
 * 展示结构校验结果与问题列表；「恢复演练」只打开恢复预览，不写入任何数据。
 */

import { ShieldCheck, ShieldX } from 'lucide-react';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui';
import type { BackupInspection } from '@/lib/backup/integrity';
import { fmtBytes } from './rows';

export function BackupVerifyDialog({
  inspection,
  open,
  onClose,
  onDrill,
}: {
  inspection: BackupInspection | null;
  open: boolean;
  onClose: () => void;
  onDrill: () => void;
}) {
  useI18n();
  if (!inspection) return null;
  const r = inspection.result;
  const rows: [string, string][] = [
    [t('backup.verifyRecords'), String(r.records)],
    [t('backup.verifyAudio'), `${r.audio} · ${fmtBytes(r.audioBytes)}`],
    [t('backup.verifyVersion'), r.version == null ? '—' : String(r.version)],
    [t('backup.verifyEncrypted'), r.encrypted ? t('backup.verifyEncryptedYes') : t('backup.verifyEncryptedNo')],
  ];

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="rounded-3xl border-0 bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-ink">
            {r.ok ? <ShieldCheck size={17} className="text-accent" /> : <ShieldX size={17} className="text-red-500" />}
            {t('backup.verifyTitle')}
          </DialogTitle>
        </DialogHeader>
        <p className={r.ok ? 'text-xs font-medium text-accent' : 'text-xs font-medium text-red-500'}>
          {r.ok ? t('backup.verifyOk') : t('backup.verifyFail', { n: r.issues.length })}
        </p>
        <div className="divide-y divide-black/5 text-xs">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 py-1.5">
              <span className="text-ink-2">{label}</span>
              <span className="tabular-nums text-ink">{value}</span>
            </div>
          ))}
        </div>
        {r.issues.length > 0 && (
          <div className="flex flex-col gap-1 rounded-2xl bg-surface-hi/60 p-3 text-[11px] leading-relaxed text-ink-2">
            {r.issues.map((issue, index) => (
              <p key={`${issue}-${index}`}>· {issue}</p>
            ))}
          </div>
        )}
        <p className="text-[10px] text-ink-2/80">{t('backup.verifyNoWrite')}</p>
        <div className="mt-1 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-full bg-surface-hi py-2.5 text-sm font-medium text-ink transition-opacity hover:opacity-80"
          >
            {t('common.close')}
          </button>
          <button
            onClick={onDrill}
            disabled={inspection.records.length === 0}
            className="flex-1 rounded-full bg-accent py-2.5 text-sm font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {t('backup.verifyDrill')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
