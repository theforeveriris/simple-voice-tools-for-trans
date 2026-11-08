/**
 * 待确认的 AI 写操作卡
 * 展示操作类型与前后对比；只有用户点「确认」才真正调用 store。
 * 执行后把 pendingAction 从消息上下文移除，写入 appliedAction，对话里保留记录。
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowRight, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { patchMessageContext } from '@/lib/llmChats';
import { applyAssistantAction, type AssistantAction } from '@/lib/assistantActions';
import { useHistoryStore } from '@/store/useHistoryStore';
import { cn } from '@/lib/utils';

function recordLabel(ts: number | undefined): string {
  if (!ts) return t('assistant.actionNotSet');
  const d = new Date(ts);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function ActionCard({
  chatId,
  messageIndex,
  action,
  applied,
}: {
  chatId?: string;
  messageIndex: number;
  action?: AssistantAction;
  applied?: { summary: string; at: number };
}) {
  useI18n();
  const records = useHistoryStore((s) => s.records);
  const [busy, setBusy] = useState(false);

  if (applied) {
    return (
      <div className="mt-1.5 flex items-center gap-1.5 rounded-full bg-surface-hi/60 px-2.5 py-1 text-[10px] text-ink-2">
        <CheckCircle2 size={11} className="text-accent" />
        <span className="font-medium text-ink">{t('assistant.actionApplied')}</span>
        <span className="min-w-0 truncate">{applied.summary}</span>
      </div>
    );
  }
  if (!action) return null;

  const patch = (next: {
    pendingAction?: AssistantAction;
    appliedAction?: { summary: string; at: number };
    planId?: string;
  }) => {
    if (chatId) patchMessageContext(chatId, messageIndex, next);
  };

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    const res = await applyAssistantAction(action);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error ?? t('assistant.actionFailed'));
      return;
    }
    patch({
      pendingAction: undefined,
      appliedAction: { summary: action.summary, at: Date.now() },
      ...(res.planId ? { planId: res.planId } : {}),
    });
    toast.success(t('assistant.actionApplied'), res.undo
      ? { action: { label: t('common.undo'), onClick: res.undo } }
      : undefined);
  };

  const before = action.before as Record<string, unknown>;
  const args = action.args;
  let preview: ReactNode = action.summary;
  if (action.kind === 'setTarget') {
    preview = (
      <span className="flex flex-wrap items-center gap-1.5 tabular-nums">
        <span>{String(before.min ?? '—')}–{String(before.max ?? '—')} Hz</span>
        <ArrowRight size={12} className="text-ink-2/60" />
        <span className="font-semibold text-ink">{String(args.min)}–{String(args.max)} Hz</span>
      </span>
    );
  } else if (action.kind === 'setBaseline') {
    const old = records.find((r) => r.id === before.recordId);
    const next = records.find((r) => r.id === args.recordId);
    preview = (
      <span className="flex flex-wrap items-center gap-1.5">
        <span>{old ? recordLabel(old.createdAt) : t('assistant.actionNotSet')}</span>
        <ArrowRight size={12} className="text-ink-2/60" />
        <span className="font-semibold text-ink">{next ? recordLabel(next.createdAt) : '—'}</span>
      </span>
    );
  } else if (action.kind === 'export') {
    preview = (
      <span>
        {t('assistant.actionExport', {
          scope: args.scope === 'all' ? t('assistant.actionScopeAll') : t('assistant.actionScopeWeek'),
        })}
      </span>
    );
  } else if (action.kind === 'createPlan') {
    preview = (
      <span className="flex flex-col gap-0.5">
        <span className="font-medium text-ink">{String(args.title ?? '')}</span>
        <span>
          {t('assistant.actionPlanSummary', {
            weeks: String(args.weeks ?? ''),
            days: String(args.daysPerWeek ?? ''),
            minutes: String(args.minutesPerSession ?? ''),
          })}
        </span>
      </span>
    );
  } else if (action.kind === 'updatePlan') {
    preview = <span>{action.summary}</span>;
  }

  const title = action.kind === 'createPlan'
    ? t('assistant.actionPlanCreateTitle')
    : action.kind === 'updatePlan'
      ? t('assistant.actionPlanUpdateTitle')
      : t('assistant.actionTitle');

  return (
    <div className="mt-1.5 rounded-2xl border border-accent/20 bg-card px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink">
        <ShieldAlert size={13} className="text-accent" />
        {title}
      </div>
      <div className={cn('mt-1 text-[11px] leading-relaxed text-ink-2', action.kind === 'setTarget' && 'text-ink')}>
        {preview}
      </div>
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => patch({ pendingAction: undefined })}
          className="px-1.5 py-1 text-[11px] font-medium text-ink-2 transition-opacity hover:opacity-70 disabled:opacity-40"
        >
          {t('assistant.actionCancel')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={confirm}
          className="flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-[11px] font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy && <Loader2 size={11} className="animate-spin" />}
          {t('assistant.actionConfirm')}
        </button>
      </div>
    </div>
  );
}
