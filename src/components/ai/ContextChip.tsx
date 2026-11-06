/**
 * 「本轮上下文」chip：显示这条回答实际注入了哪些记录与内置文档。
 * 拆成按钮与面板两部分：按钮和「思考过程」同排（右侧），面板展开占满整行。
 * 数据来自生成时写入消息的 ChatContextMeta，不重新计算提示词。
 */

import { useMemo } from 'react';
import type { MouseEvent } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import type { ChatContextMeta } from '@/lib/llmChats';
import type { AnalysisRecord } from '@/types';
import { useHistoryStore } from '@/store/useHistoryStore';
import { useStore } from '@/store/useStore';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { cn } from '@/lib/utils';

/** 面板里最多逐条列出多少条记录（其余只给计数） */
const MAX_ROWS = 8;

function recordLabel(r: AnalysisRecord): string {
  const d = new Date(r.createdAt);
  const mode = t(`mode.${r.mode ?? 'reading'}`);
  return `${d.getMonth() + 1}/${d.getDate()} · ${mode}`;
}

/** 合并固定记录与明细记录，去重 */
function contextIds(meta: ChatContextMeta): string[] {
  const pinned = Array.isArray(meta.pinnedIds) ? meta.pinnedIds : [];
  const detail = Array.isArray(meta.recordIds) ? meta.recordIds : [];
  return [...new Set([...pinned, ...detail])];
}

export function ContextChipButton({
  meta,
  open,
  onToggle,
}: {
  meta: ChatContextMeta;
  open: boolean;
  onToggle: () => void;
}) {
  useI18n();
  const ids = useMemo(() => contextIds(meta), [meta]);
  const docs = Array.isArray(meta.docs) ? meta.docs : [];
  if (ids.length === 0 && docs.length === 0) return null;

  const summary = [
    ids.length ? t('assistant.ctx.records', { n: ids.length }) : null,
    docs.length ? t('assistant.ctx.docs', { n: docs.length }) : null,
  ].filter(Boolean).join(' · ') || t('assistant.ctx.aggregate');

  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
    onToggle();
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-label={t('assistant.ctx.title')}
      className="inline-flex min-w-0 max-w-full shrink items-center gap-1 rounded-full border border-line/60 bg-surface-hi/40 px-2 py-0.5 text-[10px] text-ink-2 transition-colors hover:text-ink"
    >
      <Info size={10} className="shrink-0" />
      <span className="shrink-0">{t('assistant.ctx.title')}</span>
      <span className="shrink-0 text-ink-2/50">·</span>
      <span className="truncate">{summary}</span>
      <ChevronDown size={10} className={cn('shrink-0 transition-transform', open && 'rotate-180')} />
    </button>
  );
}

export function ContextPanel({ meta }: { meta: ChatContextMeta }) {
  useI18n();
  const records = useHistoryStore((s) => s.records);
  const setCurrentAnalysis = useStore((s) => s.setCurrentAnalysis);
  const setTab = useStore((s) => s.setTab);

  const ids = useMemo(() => contextIds(meta), [meta]);
  const docs = Array.isArray(meta.docs) ? meta.docs : [];
  const byId = useMemo(() => new Map(records.map((r) => [r.id, r])), [records]);
  const hidden = Math.max(0, (meta.totalRecords ?? 0) - ids.length);

  if (ids.length === 0 && docs.length === 0) return null;

  return (
    <div
      className="mt-1.5 rounded-2xl bg-card p-2.5 text-left shadow-[0_2px_10px_rgba(28,25,45,0.05)]"
      onClick={(e) => e.stopPropagation()}
    >
      <p className="mb-1 text-[9px] font-medium uppercase tracking-wide text-ink-2/70">
        {t('assistant.ctx.injected')}
      </p>

      {ids.slice(0, MAX_ROWS).map((id) => {
        const r = byId.get(id);
        if (!r) {
          return (
            <p key={id} className="py-1 text-[11px] text-ink-2/60">
              {t('assistant.ctx.deleted')}
            </p>
          );
        }
        return (
          <button
            key={id}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setCurrentAnalysis(r);
              setTab('analysis');
            }}
            aria-label={t('assistant.ctx.openRecord')}
            className="flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-left text-[11px] transition-colors hover:bg-surface-hi/60"
          >
            <span className="shrink-0 rounded bg-accent-soft/60 px-1 py-0.5 text-[9px] text-on-accent-soft">
              {t('assistant.ctx.recordTag')}
            </span>
            <span className="min-w-0 flex-1 truncate text-ink">{recordLabel(r)}</span>
            <span className="shrink-0 tabular-nums text-ink-2">
              {Math.round(r.stats.avgF0)} Hz · {Math.round(r.durationSec)}s
            </span>
          </button>
        );
      })}

      {docs.map((d, i) => (
        <p key={`${d.title}-${i}`} className="flex items-center gap-1.5 px-1 py-1 text-[11px]">
          <span className="shrink-0 rounded bg-surface-hi px-1 py-0.5 text-[9px] text-ink-2">
            {t('assistant.ctx.docTag')}
          </span>
          <span className="min-w-0 flex-1 truncate text-ink">{d.title}</span>
          <span className="shrink-0 tabular-nums text-ink-2">{t('assistant.ctx.chars', { n: d.chars })}</span>
        </p>
      ))}

      {ids.length > MAX_ROWS && (
        <p className="px-1 pt-1 text-[10px] text-ink-2/70">
          {t('assistant.ctx.more', { n: ids.length - MAX_ROWS })}
        </p>
      )}
      {hidden > 0 && (
        <p className="px-1 pt-1 text-[10px] text-ink-2/70">
          {t('assistant.ctx.aggregateOnly', { n: hidden })}
        </p>
      )}
      <p className="mt-1.5 border-t border-line/60 px-1 pt-1.5 text-[9px] leading-relaxed text-ink-2/60">
        {t('assistant.ctx.note')}
      </p>
    </div>
  );
}
