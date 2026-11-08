/**
 * 练习计划 UI
 * - PlanStrip：助手页顶部唯一的常驻入口（一行进度 + 点击去练习）
 * - PlanMetaChip：消息底部的小 chip，点击浮出计划摘要
 * - PlanCard：完整计划卡，只在明确展开时使用
 */
import { useEffect, useRef, useState } from 'react';
import { CalendarRange, ChevronDown, ChevronRight, Play, Target, X } from 'lucide-react';
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

function PlanDots({ done, target }: { done: number; target: number }) {
  const total = Math.max(1, Math.min(7, target));
  return (
    <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <i
          key={i}
          className={cn('size-1.5 rounded-full', i < Math.min(done, total) ? 'bg-accent' : 'bg-line')}
        />
      ))}
    </span>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hi">
      <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** 完整计划卡：只在用户明确查看计划时使用 */
export function PlanCard({ planId }: { planId?: string }) {
  useI18n();
  const state = usePracticePlan();
  const plan = state.plan && (!planId || state.plan.id === planId) ? state.plan : null;
  if (!plan) return null;
  const p = planProgress(plan, state.logs);
  return (
    <div className="mt-1.5 rounded-2xl border border-line/70 bg-card p-3">
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

/** 消息底部的计划 chip：默认一行，点开浮层 */
export function PlanMetaChip({ planId }: { planId?: string }) {
  useI18n();
  const state = usePracticePlan();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const plan = state.plan && (!planId || state.plan.id === planId) ? state.plan : null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!plan) return null;
  const p = planProgress(plan, state.logs);
  return (
    <div ref={wrapRef} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'inline-flex h-6 max-w-52 items-center gap-1 rounded-full px-2 text-[10px] font-medium transition-colors',
          open ? 'bg-surface-hi text-ink' : 'text-ink-2 hover:bg-surface-hi/70',
        )}
      >
        <CalendarRange size={11} className="shrink-0 text-accent" />
        <span className="truncate">{plan.title}</span>
        <span className="shrink-0 tabular-nums text-ink-2/80">
          {p.done}/{p.target}
        </span>
        <ChevronDown size={10} className={cn('shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-72 max-w-[calc(100vw-3rem)] rounded-2xl border border-line bg-card p-3 shadow-[0_10px_30px_-12px_rgba(28,25,45,0.28),0_2px_14px_rgba(28,25,45,0.06)]">
          <div className="flex items-center gap-1.5">
            <CalendarRange size={13} className="text-accent" />
            <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-ink">{plan.title}</span>
            <span className="rounded-full bg-accent-soft/50 px-1.5 py-0.5 text-[9px] text-on-accent-soft">
              {t(FOCUS_KEY[plan.focus])}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('common.close')}
              className="grid size-5 place-items-center rounded-full text-ink-2 hover:bg-surface-hi"
            >
              <X size={11} />
            </button>
          </div>
          <p className="mt-1 text-[9px] text-ink-2">
            {t('assistant.planMeta', { weeks: plan.weeks, days: plan.daysPerWeek, minutes: plan.minutesPerSession })}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <ProgressBar pct={p.pct} />
            <span className="shrink-0 tabular-nums text-[9px] text-ink-2">
              {t('assistant.planProgress', { done: p.done, target: p.target })}
            </span>
          </div>
          {p.nextStep && (
            <div className="mt-2 flex items-center gap-1.5 rounded-xl bg-surface-hi/50 px-2 py-1.5">
              <Target size={11} className="shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate text-[10px] text-ink">
                {p.nextStep.title}
              </span>
              <button
                type="button"
                onClick={() => startPractice(plan, state.logs)}
                className="flex shrink-0 items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[9px] font-medium text-on-accent"
              >
                <Play size={9} />
                {t('assistant.planStart')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 顶部常驻计划条：一行进度，点击去练习；待确认录音用浮层询问 */
export function PlanStrip() {
  useI18n();
  const state = usePracticePlan();
  const [pendingOpen, setPendingOpen] = useState(false);
  const plan = state.plan;
  const stationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pendingOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!stationRef.current?.contains(e.target as Node)) setPendingOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPendingOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [pendingOpen]);

  if (!plan) return null;
  const p = planProgress(plan, state.logs);

  return (
    <div ref={stationRef} className="relative mx-3 mb-1">
      <button
        type="button"
        onClick={() => {
          if (state.pendingRecordId) setPendingOpen((v) => !v);
          else startPractice(plan, state.logs);
        }}
        className="flex h-9 w-full items-center gap-2 rounded-xl border border-line/60 bg-card/85 px-2.5 text-left transition-colors hover:bg-card"
      >
        <CalendarRange size={13} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink">{plan.title}</span>
        {state.pendingRecordId && (
          <span className="shrink-0 rounded-full bg-accent/10 px-1.5 py-0.5 text-[9px] text-accent">
            {t('assistant.planPendingShort')}
          </span>
        )}
        <PlanDots done={p.done} target={p.target} />
        <span className="shrink-0 tabular-nums text-[9px] text-ink-2">{p.done}/{p.target}</span>
        <ChevronRight size={12} className="shrink-0 text-ink-2/60" />
      </button>

      {pendingOpen && state.pendingRecordId && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-2xl border border-line bg-card p-2.5 shadow-[0_10px_30px_-12px_rgba(28,25,45,0.28),0_2px_14px_rgba(28,25,45,0.06)]">
          <div className="flex items-center gap-1.5">
            <p className="min-w-0 flex-1 text-[11px] font-medium text-ink">{t('assistant.planPendingRecord')}</p>
            <button
              type="button"
              onClick={() => setPendingOpen(false)}
              aria-label={t('common.close')}
              className="grid size-5 place-items-center rounded-full text-ink-2 hover:bg-surface-hi"
            >
              <X size={11} />
            </button>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {plan.steps.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  logPractice({ stepId: s.id, recordId: state.pendingRecordId });
                  setPendingPracticeRecord(undefined);
                  setPendingOpen(false);
                  toast.success(t('assistant.planLogged'));
                }}
                className="rounded-full bg-surface-hi px-2.5 py-1 text-[10px] text-ink-2 transition-colors hover:text-accent"
              >
                {s.title}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setPendingPracticeRecord(undefined);
                setPendingOpen(false);
              }}
              className="px-1.5 py-1 text-[10px] text-ink-2/70"
            >
              {t('assistant.planSkip')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
