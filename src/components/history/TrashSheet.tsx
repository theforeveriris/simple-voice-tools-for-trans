/**
 * 记录回收站
 * 删除后保留 30 天（音频一并保留），可单条/批量恢复或永久删除；
 * 过期条目在下次启动加载历史时自动清理。
 */

import { useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { TRASH_TTL_MS, useHistoryStore } from '@/store/useHistoryStore';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui';
const MODE_KEY = {
  reading: 'mode.reading',
  sustained: 'mode.sustained',
  glide: 'mode.glide',
} as const;

function daysLeft(deletedAt: number): number {
  return Math.max(0, Math.ceil((deletedAt + TRASH_TTL_MS - Date.now()) / 86_400_000));
}

export function TrashSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  useI18n();
  const trash = useHistoryStore((s) => s.trash);
  const restoreTrash = useHistoryStore((s) => s.restoreTrash);
  const deleteTrashForever = useHistoryStore((s) => s.deleteTrashForever);
  const clearTrash = useHistoryStore((s) => s.clearTrash);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const restoreAll = () => {
    const ids = trash.map((item) => item.id);
    if (ids.length === 0) return;
    restoreTrash(ids);
    toast.success(t('trash.restored', { n: ids.length }));
    onClose();
  };

  const restoreOne = (id: string) => {
    restoreTrash([id]);
    toast.success(t('trash.restored', { n: 1 }));
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(value) => (!value ? onClose() : undefined)}>
        <DialogContent className="flex max-h-[82vh] flex-col rounded-3xl border-0 bg-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-ink">{t('trash.title')}</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed text-ink-2">
              {t('trash.desc')}
            </DialogDescription>
          </DialogHeader>

          {trash.length > 0 && (
            <div className="flex gap-2">
              <button
                onClick={restoreAll}
                className="flex-1 rounded-full bg-accent-soft py-2 text-xs font-semibold text-accent transition-opacity hover:opacity-80"
              >
                {t('trash.restoreAll')}
              </button>
              <button
                onClick={() => setConfirmClear(true)}
                className="rounded-full bg-surface-hi px-3 py-2 text-xs font-medium text-red-500 transition-opacity hover:opacity-80"
              >
                {t('trash.clearAll')}
              </button>
            </div>
          )}

          <div className="-mx-1 flex-1 overflow-y-auto px-1">
            {trash.length === 0 ? (
              <p className="py-10 text-center text-sm text-ink-2">{t('trash.empty')}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {trash.map((item) => {
                  const record = item.record;
                  return (
                    <div key={item.id} className="rounded-2xl bg-surface-hi/60 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-ink">
                            {new Date(record.createdAt).toLocaleString(undefined, {
                              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                            })}
                            {' · '}
                            {t(MODE_KEY[record.mode ?? 'reading'])}
                          </p>
                          <p className="mt-0.5 text-[10px] text-ink-2">
                            {record.stats.avgF0 != null ? `${Math.round(record.stats.avgF0)} Hz · ` : ''}
                            {record.durationSec.toFixed(1)} s
                          </p>
                          <p className="mt-0.5 text-[10px] text-ink-2/80">
                            {t('trash.deletedAt', {
                              time: new Date(item.deletedAt).toLocaleString(undefined, {
                                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                              }),
                            })}
                            {' · '}
                            {t('trash.expiresIn', { n: daysLeft(item.deletedAt) })}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            onClick={() => restoreOne(item.id)}
                            aria-label={t('trash.restore')}
                            className="grid size-8 place-items-center rounded-full bg-card text-accent transition-transform active:scale-90"
                          >
                            <RotateCcw size={14} />
                          </button>
                          <button
                            onClick={() => setPendingDelete(item.id)}
                            aria-label={t('trash.deleteForever')}
                            className="grid size-8 place-items-center rounded-full bg-card text-red-500 transition-transform active:scale-90"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <p className="text-[10px] text-ink-2/70">{t('trash.noWrite')}</p>
        </DialogContent>
      </Dialog>

      <AlertDialog open={pendingDelete != null} onOpenChange={(value) => (!value ? setPendingDelete(null) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('trash.confirmDeleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('trash.confirmDeleteDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 text-white hover:bg-red-500/90"
              onClick={() => {
                if (pendingDelete) {
                  deleteTrashForever([pendingDelete]);
                  toast.success(t('trash.deleted'));
                }
                setPendingDelete(null);
              }}
            >
              {t('trash.deleteForever')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('trash.confirmClearTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('trash.confirmClearDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 text-white hover:bg-red-500/90"
              onClick={() => {
                clearTrash();
                setConfirmClear(false);
                toast.success(t('trash.cleared'));
              }}
            >
              {t('trash.clearAll')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
