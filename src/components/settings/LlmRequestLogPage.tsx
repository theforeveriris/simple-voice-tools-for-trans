/**
 * AI 请求日志（数据管理的子页面）
 * 列表只做定位：日期分组 + 时间 / 功能 / 模型 / 域名 / 体积 / 一句话摘要；
 * 点一条进入详情：完整用户消息 + 格式化请求体，可复制。
 */

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ChevronRight, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { clearLlmRequestLog, readLlmRequestLog, type LlmRequestLogEntry } from '@/lib/llmRequestLog';
import { buildRequestView, formatBodySize } from '@/lib/llmRequestLogView';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { localeTag } from '@/i18n';

const iconBtn =
  'grid size-9 place-items-center rounded-full bg-card text-ink shadow-[0_2px_14px_rgba(28,25,45,0.05),0_1px_3px_rgba(28,25,45,0.04)] transition-transform active:scale-90';

/** 到日界的分组键（本地时区） */
function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** 今天 / 昨天 / 11/6 */
function dayLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOfToday - startOfDay) / 86_400_000);
  if (diff === 0) return t('privacy.today');
  if (diff === 1) return t('privacy.yesterday');
  return d.toLocaleDateString(localeTag(), { month: 'numeric', day: 'numeric' });
}

/** 列表里的时间（24 小时制） */
function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString(localeTag(), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** 详情里的完整时间 */
function dateTimeLabel(ts: number): string {
  return new Date(ts).toLocaleString(localeTag(), {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** 连续同一天的条目分组（日志本身按时间倒序） */
function groupByDay(log: LlmRequestLogEntry[]): { key: string; items: LlmRequestLogEntry[] }[] {
  const groups: { key: string; items: LlmRequestLogEntry[] }[] = [];
  for (const e of log) {
    const key = dayKey(e.ts);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(e);
    else groups.push({ key, items: [e] });
  }
  return groups;
}

export function LlmRequestLogPage({ onBack }: { onBack: () => void }) {
  useI18n();
  const [log, setLog] = useState<LlmRequestLogEntry[] | null>(null);
  const [selected, setSelected] = useState<LlmRequestLogEntry | null>(null);

  useEffect(() => {
    void (async () => {
      setLog(await readLlmRequestLog().catch(() => null));
    })();
  }, []);

  const copyBody = useCallback((entry: LlmRequestLogEntry) => {
    void navigator.clipboard?.writeText(entry.body).then(() => toast.success(t('toast.copied')));
  }, []);

  const clearLog = useCallback(() => {
    void clearLlmRequestLog().then(() => {
      setLog([]);
      toast.success(t('toast.llmLogCleared'));
    });
  }, []);

  /* ------------------------------- 详情 ------------------------------- */
  if (selected) {
    const view = buildRequestView(selected.body);
    return (
      <div className="flex flex-col gap-3.5 pb-4">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
          className="flex flex-col gap-3.5"
        >
          <div className="flex items-center gap-3">
            <button onClick={() => setSelected(null)} aria-label={t('common.back')} className={iconBtn}>
              <ArrowLeft size={18} />
            </button>
            <p className="text-base font-semibold text-ink">{t('privacy.requestDetail')}</p>
            <button
              onClick={() => copyBody(selected)}
              className="ml-auto flex items-center gap-1 px-1 py-1 text-[11px] font-medium text-ink-2 transition-opacity hover:opacity-70"
            >
              <Copy size={12} />
              {t('privacy.copyBody')}
            </button>
          </div>

          <div className="card-surface px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-accent-soft/60 px-2 py-0.5 text-[10px] text-on-accent-soft">
                {t(`llmFeature.${selected.feature}`)}
              </span>
              <span className="font-mono text-[11px] text-ink">{selected.model}</span>
            </div>
            <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-ink-2">
              {selected.host} · {dateTimeLabel(selected.ts)} · {formatBodySize(view.bytes)}
            </p>
          </div>

          {view.userText && (
            <div className="card-surface px-4 py-3.5">
              <p className="text-[11px] font-semibold text-ink">{t('privacy.userMessage')}</p>
              <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-ink">
                {view.userText}
              </p>
            </div>
          )}

          <div className="card-surface px-4 py-3.5">
            <p className="text-[11px] font-semibold text-ink">{t('privacy.requestBody')}</p>
            <pre className="mt-2 max-h-[52vh] overflow-auto whitespace-pre-wrap break-all rounded-xl bg-surface-hi/70 p-3 font-mono text-[10px] leading-relaxed text-ink-2">
              {view.pretty}
            </pre>
          </div>
        </motion.div>
      </div>
    );
  }

  /* ------------------------------- 列表 ------------------------------- */
  return (
    <div className="flex flex-col gap-3.5 pb-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
        className="flex flex-col gap-3.5"
      >
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

        {log == null ? null : log.length === 0 ? (
          <div className="card-surface px-4 py-3">
            <p className="text-[11px] leading-relaxed text-ink-2">{t('privacy.llmEmpty')}</p>
          </div>
        ) : (
          groupByDay(log).map((group) => (
            <div key={group.key} className="flex flex-col gap-1.5">
              <p className="px-0.5 text-[10px] tracking-wide text-ink-2/70">
                {dayLabel(group.items[0].ts)}
              </p>
              {group.items.map((e, i) => {
                const view = buildRequestView(e.body);
                return (
                  <button
                    key={`${e.ts}-${i}`}
                    onClick={() => setSelected(e)}
                    className="card-surface flex flex-col gap-1 px-3.5 py-2.5 text-left transition-transform active:scale-[0.99]"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink-2">
                        {timeLabel(e.ts)}
                      </span>
                      <span className="shrink-0 rounded-full bg-accent-soft/60 px-1.5 py-0.5 text-[9px] text-on-accent-soft">
                        {t(`llmFeature.${e.feature}`)}
                      </span>
                      <span className="min-w-0 truncate font-mono text-[10px] text-ink">{e.model}</span>
                      <span className="min-w-0 flex-1 truncate text-[10px] text-ink-2">{e.host}</span>
                      <span className="shrink-0 font-mono text-[9px] text-ink-2/70">
                        {formatBodySize(view.bytes)}
                      </span>
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-xs text-ink">
                        {view.summary ?? '—'}
                      </span>
                      <ChevronRight size={14} className="shrink-0 text-ink-2/60" />
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </motion.div>
    </div>
  );
}
