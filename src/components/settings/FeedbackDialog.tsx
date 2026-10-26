/**
 * 问题反馈弹窗（设置 → 关于）
 * 自动收集非敏感诊断（版本 / 平台 / UA 摘要 / 语言 / 记录数——不含任何记录内容），
 * 生成一段 issue 预填文本。用户确认后自行「复制」并「打开 GitHub Issues」粘贴；
 * 全程内容先展示、用户手动操作才离开设备。
 */

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui';
import { isNative, isTauri } from '@/lib/platform';
import { useHistoryStore } from '@/store/useHistoryStore';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { getLocale } from '@/i18n';

declare const __APP_VERSION__: string;

const ISSUES_URL = 'https://github.com/theforeveriris/simple-voice-tools-for-trans/issues/new';

/** 组装诊断摘要 + 反馈模板（纯函数，输出即预览所见） */
function buildFeedbackBody(userText: string, recordCount: number, locale: string): string {
  const platform = isNative ? 'Android (Capacitor)' : isTauri ? 'Windows (Tauri)' : 'Web / PWA';
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  // UA 精简到品牌与版本段：去掉冗长的 token，降低可辨识度
  const uaBrief = ua.split(') ').slice(0, 2).join('); ');
  const lines = [
    '**Environment**',
    `- App: Simple Voice Tool for Trans v${__APP_VERSION__}`,
    `- Platform: ${platform}`,
    `- Locale: ${locale}`,
    `- Records: ${recordCount} (count only, no content attached)`,
    `- UA: ${uaBrief}`,
    '',
    '**Steps to reproduce**',
    '1. ',
    '2. ',
    '',
    '**What happened**',
    userText.trim() || '(describe the problem here)',
    '',
    '**Expected**',
    '',
  ];
  return lines.join('\n');
}

export function FeedbackDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useI18n();
  const recordCount = useHistoryStore((s) => s.totalCount);
  const [userText, setUserText] = useState('');
  const body = useMemo(() => buildFeedbackBody(userText, recordCount, getLocale()), [userText, recordCount]);

  const copy = () => {
    void navigator.clipboard?.writeText(body).then(() => toast.success(t('toast.copied')));
  };
  const openIssues = () => {
    // 预填 body 仅在 URL 长度可行时带上（浏览器地址栏 ~32KB，留裕量 8KB）；
    // 超长时退化为只打开空白 issue，文本已在剪贴板
    if (body.length < 8000) {
      const url = `${ISSUES_URL}?body=${encodeURIComponent(body)}`;
      window.open(url, '_blank', 'noopener');
    } else {
      window.open(ISSUES_URL, '_blank', 'noopener');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="rounded-3xl border-0 bg-card sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-ink">{t('feedback.title')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-xs leading-relaxed text-ink-2">{t('feedback.privacyNote')}</p>
          <textarea
            value={userText}
            onChange={(e) => setUserText(e.target.value)}
            placeholder={t('feedback.placeholder')}
            rows={3}
            className="w-full resize-none rounded-2xl border border-black/10 bg-surface-hi px-3 py-2 text-xs text-ink outline-none placeholder:text-ink-2/50 focus:border-accent"
          />
          {/* 诊断预览：所见即所得，用户可编辑后再复制 */}
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-2xl bg-surface-hi/70 p-2.5 font-mono text-[10px] leading-relaxed text-ink-2">
            {body}
          </pre>
          <div className="flex gap-2">
            <button
              onClick={copy}
              className="flex-1 rounded-full bg-surface-hi py-2.5 text-sm font-medium text-ink transition-opacity hover:opacity-80"
            >
              {t('feedback.copy')}
            </button>
            <button
              onClick={openIssues}
              className="flex-1 rounded-full bg-accent py-2.5 text-sm font-medium text-on-accent transition-opacity hover:opacity-90"
            >
              {t('feedback.openIssues')}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
