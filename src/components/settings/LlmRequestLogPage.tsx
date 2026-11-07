/**
 * AI 请求日志（数据管理的子页面）
 * 每次 LLM 调用实际发出的请求体（不含 API Key），可展开、复制、清空。
 * 与「数据去向」同级的入口卡片放在数据页，内容收进这个二级页。
 */

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Copy, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { clearLlmRequestLog, readLlmRequestLog, type LlmRequestLogEntry } from '@/lib/llmRequestLog';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { localeTag } from '@/i18n';
import { cn } from '@/lib/utils';

export function LlmRequestLogPage({ onBack }: { onBack: () => void }) {
  useI18n();
  const [log, setLog] = useState<LlmRequestLogEntry[] | null>(null);
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      setLog(await readLlmRequestLog().catch(() => null));
    })();
  }, []);

  const copyBody = (entry: LlmRequestLogEntry) => {
    void navigator.clipboard?.writeText(entry.body).then(() => toast.success(t('toast.copied')));
  };

  const clearLog = useCallback(() => {
    void clearLlmRequestLog().then(() => {
      setLog([]);
      setOpenIdx(null);
      toast.success(t('toast.llmLogCleared'));
    });
  }, []);

  const iconBtn =
    'grid size-9 place-items-center rounded-full bg-card text-ink shadow-[0_2px_14px_rgba(28,25,45,0.05),0_1px_3px_rgba(28,25,45,0.04)] transition-transform active:scale-90';

  return (
    <div className="flex flex-col gap-3.5 pb-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
        className="flex flex-col gap-3.5"
      >
        {/* 子页面头：返回 + 标题 + 条数 / 清空 */}
        <div className="flex items-center gap-3">
          <button onClick={onBack} aria-label={t('common.back')} className={iconBtn}>
            <ArrowLeft size={18} />
          </button>
          <p className="text-base font-semibold text-ink">{t('privacy.llmLogTitle')}</p>
          <div className="ml-auto flex items-center gap-2.5">
            {log && log.length > 0 && (
              <button
                onClick={clearLog}
                className="px-1 py-1 text-[11px] font-medium text-ink-2 transition-opacity hover:opacity-70"
              >
                {t('privacy.llmClear')}
              </button>
            )}
            <span className="text-[11px] tabular-nums text-ink-2">
              {t('privacy.llmLogCount', { n: log?.length ?? 0 })}
            </span>
          </div>
        </div>

        <div className="card-surface px-4 py-3">
          {log == null ? null : log.length === 0 ? (
            <p className="text-[11px] leading-relaxed text-ink-2">{t('privacy.llmEmpty')}</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {log.map((e, i) => (
                <div key={`${e.ts}-${i}`} className="rounded-xl bg-surface-hi/70 px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={() => setOpenIdx(openIdx === i ? null : i)}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[11px] text-ink-2"
                    >
                      {openIdx === i ? <EyeOff size={11} className="shrink-0" /> : <Eye size={11} className="shrink-0" />}
                      <span className="shrink-0 font-medium text-ink">{t(`llmFeature.${e.feature}`)}</span>
                      <span className="shrink-0">{e.model}</span>
                      <span className="truncate">{e.host}</span>
                      <span className="ml-auto shrink-0 tabular-nums">
                        {new Date(e.ts).toLocaleString(localeTag(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </button>
                    <button
                      onClick={() => copyBody(e)}
                      aria-label={t('privacy.copyBody')}
                      className="shrink-0 p-1 text-ink-2 transition-opacity hover:opacity-70"
                    >
                      <Copy size={12} />
                    </button>
                  </div>
                  <pre
                    className={cn(
                      'overflow-auto whitespace-pre-wrap break-all rounded-lg bg-card p-2 font-mono text-[10px] leading-relaxed text-ink-2',
                      openIdx === i ? 'mt-1.5 max-h-72' : 'mt-1.5 max-h-16',
                    )}
                  >
                    {e.body}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
