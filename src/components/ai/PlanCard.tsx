/**
 * 练习计划卡：聊天里的完整卡 + 助手首页顶部的进度条。
 * 数据来自 practicePlan store；「去练习」只切到测试页并设置模式，不自动占用麦克风。
 */
import { CalendarRange, ChevronRight, Play, Target } from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import {
  logPractice,
  planProgress,
  setPendingPracticeRecord,
  usePracticePlan,
  type PlanFocus,
  type PracticePlan,
} from '@/lib/practicePlan';
import { useStore } from '@/store/useStore';
import { cn } from '@/lib/utils';

const FOCUS_KEY: Record<PlanFocus, 'assistant.planFocusPitch' | 'assistant.planFocusResonance' | 'assistant.planFocusStability' | 'assistant.planFocusRange' | 'assistant.planFocusHabit'> = {
  pitch: 'assistant.planFocusPitch',
  resonance: 'assistant.planFocusResonance',
  stability: 'assistant.planFocusStability',
  range: 'assistant.planFocusRange',
  habit: 'assistant.planFocusHabit',
};

function startPractice(plan: PracticePlan, logs: Parameters<typeof planProgress>[1]) {
  const p = planProgress(plan, logs);
  if (!p.nextStep) return;
  useStore.getState().updateSettings({ testMode: p.nextStep.mode });
  useStore.getState().setTab('test');
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hi">
      <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function PlanCard({ planId }: { planId?: string }) {
  useI18n();
  const state = usePracticePlan();
  const plan = state.plan && (!planId || state.plan.id === planId) ? state.plan : null;
  if (!plan) return null;
  const p = planProgress(plan, state.logs);
  return (
    <div className="mt-1.5 rounded-2xl bg-card p-3 shadow-[0_2px_14px_rgba(28,25,45,0.05)]">
      <div className="flex items-center gap-1.5">
        <CalendarRange size={13} className="text-accent" />
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink">{plan.title}</span>
        <span className="rounded-full bg-accent-soft/50 px-1.5 py-0.5 text-[9px] text-on-accent-soft">
          {t(FOCUS_KEY[plan.focus])}
        </span>
      </div>
      <p className="mt-1 text-[10px] text-ink-2">
        {t('assistant.planMeta', {
          weeks: plan.weeks,
          days: plan.daysPerWeek,
          minutes: plan.minutesPerSession,
        })}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <ProgressBar pct={p.pct} />
        <span className="shrink-0 tabular-nums text-[10px] text-ink-2">
          {t('assistant.planProgress', { done: p.done, target: p.target })}
        </span>
      </div>
      {p.nextStep && (
        <div className="mt-2 flex items-center gap-2 rounded-xl bg-surface-hi/50 px-2 py-1.5">
          <Target size={12} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate text-[11px] text-ink">
            {t('assistant.planNext')}：{p.nextStep.title}
          </span>
          <button
            type="button"
            onClick={() => startPractice(plan, state.logs)}
            className="flex shrink-0 items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-[10px] font-medium text-on-accent"
          >
            <Play size={10} />
            {t('assistant.planStart')}
          </button>
        </div>
      )}
    </div>
  );
}

export function PlanStrip() {
  useI18n();
  const state = usePracticePlan();
  const plan = state.plan;
  if (!plan) return null;
  const p = planProgress(plan, state.logs);

  if (state.pendingRecordId) {
    return (
      <div className="mx-3 mb-1 rounded-2xl bg-card px-3 py-2 shadow-[0_2px_14px_rgba(28,25,45,0.05)]">
        <p className="text-[11px] font-medium text-ink">{t('assistant.planPendingRecord')}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {plan.steps.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                logPractice({ stepId: s.id, recordId: state.pendingRecordId });
                setPendingPracticeRecord(undefined);
                toast.success(t('assistant.planLogged'));
              }}
              className="rounded-full bg-surface-hi px-2.5 py-1 text-[10px] text-ink-2 transition-colors hover:text-accent"
            >
              {s.title}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPendingPracticeRecord(undefined)}
            className="px-1.5 py-1 text-[10px] text-ink-2/70"
          >
            {t('assistant.planSkip')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => useStore.getState().setTab('test')}
      className="mx-3 mb-1 flex items-center gap-2 rounded-2xl bg-card px-3 py-2 text-left shadow-[0_2px_14px_rgba(28,25,45,0.05)] transition-transform active:scale-[0.99]"
    >
      <CalendarRange size={13} className="shrink-0 text-accent" />
      <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink">{plan.title}</span>
      <span className="shrink-0 tabular-nums text-[10px] text-ink-2">
        {t('assistant.planProgress', { done: p.done, target: p.target })}
      </span>
      <span className={cn('h-1.5 w-12 overflow-hidden rounded-full bg-surface-hi')}>
        <span className="block h-full rounded-full bg-accent" style={{ width: `${p.pct}%` }} />
      </span>
      <ChevronRight size={12} className="shrink-0 text-ink-2/60" />
    </button>
  );
}
