/**
 * 恢复预览弹窗
 * 导入 JSON / ZIP 备份合并前，先解析并展示将发生什么：
 * 新增多少条（按模式分桶）、跳过多少条本机已存在的同 id 记录、
 * 时间范围。importRecords 是只新增不覆盖的合并语义，预览如实告知，
 * 防止用户误以为旧备份会「还原并覆盖」当前数据。
 */

import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import type { RestorePreview } from './restorePreview';
import { cn } from '@/lib/utils';

const MODE_KEY = {
  reading: 'mode.reading',
  sustained: 'mode.sustained',
  glide: 'mode.glide',
} as const;

export function RestorePreviewDialog({
  preview,
  open,
  onConfirm,
  onCancel,
  drill = false,
}: {
  preview: RestorePreview;
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** 恢复演练：只预览内容，不提供导入按钮 */
  drill?: boolean;
}) {
  useI18n();
  const [showAll, setShowAll] = useState(false);
  const modeCounts = useMemo(() => {
    const counts = new Map<TestModeKey, number>();
    for (const r of preview.incoming) {
      const m = (r.mode ?? 'reading') as TestModeKey;
      counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [preview.incoming]);

  const fmtDate = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onCancel() : undefined)}>
      <DialogContent className="rounded-3xl border-0 bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-ink">{t(drill ? 'restore.drillTitle' : 'restore.title')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-xs leading-relaxed text-ink-2">
          <p>
            {t('restore.summary', { total: preview.incoming.length, added: preview.added, dup: preview.duplicates })}
          </p>
          {preview.range && (
            <p className="tabular-nums">
              {t('restore.range', { a: fmtDate(preview.range[0]), b: fmtDate(preview.range[1]) })}
            </p>
          )}
          {/* 模式分桶：超过 3 种折叠，点开看全部 */}
          <div className="flex flex-wrap gap-1.5">
            {modeCounts.slice(0, showAll ? undefined : 3).map(([m, n]) => (
              <span key={m} className="rounded-full bg-surface-hi px-2 py-0.5 text-[10px] tabular-nums text-ink-2">
                {t(MODE_KEY[m])} · {n}
              </span>
            ))}
            {modeCounts.length > 3 && (
              <button
                onClick={() => setShowAll((v) => !v)}
                className={cn('text-[10px] font-medium text-accent transition-opacity hover:opacity-70')}
              >
                {showAll ? t('restore.showLess') : t('restore.showMore', { n: modeCounts.length - 3 })}
              </button>
            )}
          </div>
          <p className="text-[10px] text-ink-2/80">
            {t(drill ? 'restore.drillNote' : 'restore.mergeNote')}
          </p>
        </div>
        <div className="mt-2 flex gap-2">
          {drill ? (
            <button
              onClick={onCancel}
              className="flex-1 rounded-full bg-accent py-2.5 text-sm font-medium text-on-accent transition-opacity hover:opacity-90"
            >
              {t('common.close')}
            </button>
          ) : (
            <>
              <button
                onClick={onCancel}
                className="flex-1 rounded-full bg-surface-hi py-2.5 text-sm font-medium text-ink transition-opacity hover:opacity-80"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={onConfirm}
                disabled={preview.added === 0}
                className="flex-1 rounded-full bg-accent py-2.5 text-sm font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {preview.added === 0 ? t('restore.nothingNew') : t('restore.confirm', { n: preview.added })}
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type TestModeKey = keyof typeof MODE_KEY;
