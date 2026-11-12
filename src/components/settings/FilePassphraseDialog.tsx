/**
 * 导入加密备份时的口令输入。
 * 与云备份解锁不同：这里直接用用户输入的口令解密文件头，因此即使本机
 * 已关闭备份加密，也能恢复旧 `.svtz` / 加密 ZIP。
 */

import { useState } from 'react';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui';

export function FilePassphraseDialog({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (passphrase: string) => void;
}) {
  useI18n();
  const [pass, setPass] = useState('');
  // 打开时清空上次输入：渲染期对比派生重置，避免 effect 内同步 setState
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) setPass('');
  }

  const submit = () => {
    if (!pass.trim()) return;
    onSubmit(pass);
  };

  return (
    <Dialog open={open} onOpenChange={(value) => (!value ? onClose() : undefined)}>
      <DialogContent className="rounded-3xl border-0 bg-card sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-ink">{t('backup.passTitle')}</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed text-ink-2">
            {t('backup.passDesc')}
          </DialogDescription>
        </DialogHeader>
        <input
          type="password"
          value={pass}
          autoFocus
          autoComplete="current-password"
          onChange={(event) => setPass(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
          }}
          placeholder={t('backup.passPlaceholder')}
          className="w-full rounded-2xl border border-black/10 bg-surface-hi px-4 py-3 text-sm text-ink outline-none placeholder:text-ink-2/50 focus:border-accent"
        />
        <DialogFooter className="mt-1 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-full bg-surface-hi py-2.5 text-sm font-medium text-ink transition-opacity hover:opacity-80"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={submit}
            disabled={!pass.trim()}
            className="flex-1 rounded-full bg-accent py-2.5 text-sm font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {t('settings.encActionUnlock')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
