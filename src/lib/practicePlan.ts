/**
 * 结构化练习计划（与「记忆」分开）
 *
 * 记忆存偏好/事实；计划存目标、频率、步骤和完成记录，才能算进度、发提醒、
 * 接进周报。存储在本机 IndexedDB kv `practice:plan`，不参与设置导出。
 */
import { useSyncExternalStore } from 'react';
import type { AnalysisRecord, TestMode } from '@/types';
import { idbGetKV, idbPutKV } from '@/lib/storage/idb';

export type PlanFocus = 'pitch' | 'resonance' | 'stability' | 'range' | 'habit';

export interface PracticeStep {
  id: string;
  title: string;
  mode: TestMode;
  durationSec: number;
}

export interface PracticePlan {
  id: string;
  title: string;
  focus: PlanFocus;
  weeks: number;
  daysPerWeek: number;
  minutesPerSession: number;
  status: 'active' | 'paused' | 'done';
  steps: PracticeStep[];
  createdAt: number;
  updatedAt: number;
}

export interface PracticeLog {
  id: string;
  planId: string;
  stepId?: string;
  recordId?: string;
  at: number;
  completed: boolean;
}

interface PlanState {
  plan: PracticePlan | null;
  logs: PracticeLog[];
  /** 新录音未匹配到步骤时，等待用户选择算作哪一步 */
  pendingRecordId?: string;
}

const KV_KEY = 'practice:plan';
const EMPTY: PlanState = { plan: null, logs: [] };

let state: PlanState = EMPTY;
let loaded = false;
let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();
let queue: Promise<void> = Promise.resolve();

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function notify(): void {
  for (const l of listeners) l();
}

function enqueue(task: () => Promise<void>): Promise<void> {
  const next = queue.then(task);
  queue = next.catch(() => {});
  return next;
}

function persist(): Promise<void> {
  return enqueue(async () => {
    try {
      await idbPutKV(KV_KEY, state);
    } catch {
      /* 保持内存态，下次写入重试 */
    }
  });
}

function sanitizeStep(raw: unknown): PracticeStep | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const title = typeof o.title === 'string' ? o.title.trim().slice(0, 80) : '';
  const mode = o.mode === 'reading' || o.mode === 'sustained' || o.mode === 'glide' ? o.mode : null;
  const durationSec = typeof o.durationSec === 'number' ? Math.max(10, Math.min(1800, Math.round(o.durationSec))) : 60;
  if (!title || !mode) return null;
  return {
    id: typeof o.id === 'string' && o.id ? o.id : genId('step'),
    title,
    mode,
    durationSec,
  };
}

function sanitize(raw: unknown): PlanState {
  if (!raw || typeof raw !== 'object') return EMPTY;
  const o = raw as Record<string, unknown>;
  const planRaw = o.plan && typeof o.plan === 'object' ? o.plan as Record<string, unknown> : null;
  if (!planRaw) return EMPTY;
  const steps = Array.isArray(planRaw.steps) ? planRaw.steps.map(sanitizeStep).filter((s): s is PracticeStep => !!s) : [];
  const focus: PlanFocus = planRaw.focus === 'pitch' || planRaw.focus === 'resonance'
    || planRaw.focus === 'stability' || planRaw.focus === 'range' || planRaw.focus === 'habit'
    ? planRaw.focus : 'pitch';
  const plan: PracticePlan = {
    id: typeof planRaw.id === 'string' && planRaw.id ? planRaw.id : genId('plan'),
    title: typeof planRaw.title === 'string' && planRaw.title.trim() ? planRaw.title.trim().slice(0, 80) : '练习计划',
    focus,
    weeks: typeof planRaw.weeks === 'number' ? Math.max(1, Math.min(52, Math.round(planRaw.weeks))) : 4,
    daysPerWeek: typeof planRaw.daysPerWeek === 'number' ? Math.max(1, Math.min(7, Math.round(planRaw.daysPerWeek))) : 3,
    minutesPerSession: typeof planRaw.minutesPerSession === 'number' ? Math.max(2, Math.min(60, Math.round(planRaw.minutesPerSession))) : 10,
    status: planRaw.status === 'paused' || planRaw.status === 'done' ? planRaw.status : 'active',
    steps: steps.length > 0 ? steps : defaultSteps(focus),
    createdAt: typeof planRaw.createdAt === 'number' ? planRaw.createdAt : Date.now(),
    updatedAt: typeof planRaw.updatedAt === 'number' ? planRaw.updatedAt : Date.now(),
  };
  const logsRaw = Array.isArray(o.logs) ? o.logs : [];
  const logs: PracticeLog[] = [];
  for (const l of logsRaw) {
    if (!l || typeof l !== 'object') continue;
    const x = l as Record<string, unknown>;
    if (typeof x.id !== 'string' || typeof x.at !== 'number') continue;
    logs.push({
      id: x.id,
      planId: typeof x.planId === 'string' ? x.planId : plan.id,
      ...(typeof x.stepId === 'string' ? { stepId: x.stepId } : {}),
      ...(typeof x.recordId === 'string' ? { recordId: x.recordId } : {}),
      at: x.at,
      completed: x.completed !== false,
    });
  }
  return {
    plan,
    logs: logs.filter((l) => l.planId === plan.id).slice(-500),
    ...(typeof o.pendingRecordId === 'string' ? { pendingRecordId: o.pendingRecordId } : {}),
  };
}

export async function loadPracticePlan(): Promise<void> {
  if (loaded) return;
  loadPromise ??= (async () => {
    try {
      const raw = await idbGetKV<unknown>(KV_KEY);
      state = sanitize(raw);
    } catch {
      state = EMPTY;
    } finally {
      loaded = true;
      notify();
    }
  })();
  await loadPromise;
}

export function getPracticePlanState(): PlanState {
  return state;
}

export function subscribePracticePlan(fn: () => void): () => void {
  listeners.add(fn);
  void loadPracticePlan();
  return () => listeners.delete(fn);
}

export function usePracticePlan(): PlanState {
  return useSyncExternalStore(subscribePracticePlan, getPracticePlanState, getPracticePlanState);
}

function defaultSteps(focus: PlanFocus): PracticeStep[] {
  const mk = (id: string, title: string, mode: TestMode, durationSec: number): PracticeStep => ({ id, title, mode, durationSec });
  if (focus === 'resonance') {
    return [
      mk('s1', '共鸣热身：持续元音', 'sustained', 60),
      mk('s2', '朗读段落，保持前置共鸣', 'reading', 120),
    ];
  }
  if (focus === 'stability') {
    return [
      mk('s1', '稳定长音', 'sustained', 90),
      mk('s2', '朗读段落，控制音量', 'reading', 120),
    ];
  }
  if (focus === 'range') {
    return [
      mk('s1', '滑音：舒适低音到目标高音', 'glide', 90),
      mk('s2', '朗读段落，带入目标音区', 'reading', 120),
    ];
  }
  if (focus === 'habit') {
    return [
      mk('s1', '朗读段落', 'reading', 180),
      mk('s2', '轻松长音收尾', 'sustained', 60),
    ];
  }
  return [
    mk('s1', '目标音区持续发声', 'sustained', 60),
    mk('s2', '滑音：低音到目标音高', 'glide', 60),
    mk('s3', '朗读段落，带入目标音区', 'reading', 120),
  ];
}

export function createPracticePlan(input: {
  title?: string;
  focus: PlanFocus;
  weeks: number;
  daysPerWeek: number;
  minutesPerSession: number;
  status?: PracticePlan['status'];
  steps?: PracticeStep[];
}): PracticePlan {
  const now = Date.now();
  const plan: PracticePlan = {
    id: genId('plan'),
    title: (input.title?.trim() || '练习计划').slice(0, 80),
    focus: input.focus,
    weeks: Math.max(1, Math.min(52, Math.round(input.weeks))),
    daysPerWeek: Math.max(1, Math.min(7, Math.round(input.daysPerWeek))),
    minutesPerSession: Math.max(2, Math.min(60, Math.round(input.minutesPerSession))),
    status: input.status ?? 'active',
    steps: input.steps?.length ? input.steps : defaultSteps(input.focus),
    createdAt: now,
    updatedAt: now,
  };
  state = { plan, logs: [] };
  notify();
  void persist();
  return plan;
}

export function updatePracticePlan(patch: Partial<Pick<PracticePlan, 'title' | 'focus' | 'weeks' | 'daysPerWeek' | 'minutesPerSession' | 'status'>>): PracticePlan | null {
  if (!state.plan) return null;
  const next: PracticePlan = {
    ...state.plan,
    ...patch,
    updatedAt: Date.now(),
  };
  state = { ...state, plan: next };
  notify();
  void persist();
  return next;
}

export function clearPracticePlan(): void {
  state = { plan: null, logs: [] };
  notify();
  void persist();
}

/** 同一天同一步骤只记一次；同一录音不重复记 */
export function logPractice(input: {
  stepId?: string;
  recordId?: string;
  at?: number;
  completed?: boolean;
}): PracticeLog | null {
  const plan = state.plan;
  if (!plan) return null;
  const at = input.at ?? Date.now();
  if (input.recordId && state.logs.some((l) => l.recordId === input.recordId)) return null;
  const day = new Date(at).toDateString();
  if (input.stepId && state.logs.some((l) => l.stepId === input.stepId && new Date(l.at).toDateString() === day)) {
    return null;
  }
  const log: PracticeLog = {
    id: genId('log'),
    planId: plan.id,
    ...(input.stepId ? { stepId: input.stepId } : {}),
    ...(input.recordId ? { recordId: input.recordId } : {}),
    at,
    completed: input.completed !== false,
  };
  state = { ...state, logs: [...state.logs, log].slice(-500), pendingRecordId: undefined };
  notify();
  void persist();
  return log;
}

export function removePracticeLog(id: string): void {
  if (!state.logs.some((l) => l.id === id)) return;
  state = { ...state, logs: state.logs.filter((l) => l.id !== id) };
  notify();
  void persist();
}

export function setPendingPracticeRecord(recordId: string | undefined): void {
  state = { ...state, pendingRecordId: recordId };
  notify();
  void persist();
}

function startOfWeek(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const offset = (d.getDay() + 6) % 7; // 周一为一周开始
  d.setDate(d.getDate() - offset);
  return d.getTime();
}

export interface PlanProgress {
  done: number;
  target: number;
  pct: number;
  nextStep: PracticeStep | null;
}

export function planProgress(plan: PracticePlan, logs: PracticeLog[], now = Date.now()): PlanProgress {
  const weekStart = startOfWeek(now);
  const done = logs.filter((l) => l.planId === plan.id && l.completed && l.at >= weekStart).length;
  const target = plan.daysPerWeek;
  const nextStep = plan.steps.length > 0 ? plan.steps[done % plan.steps.length] : null;
  return {
    done,
    target,
    pct: target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0,
    nextStep,
  };
}

/** 周报 / 助手提示词用的计划摘要 */
export function planSummaryForPrompt(plan: PracticePlan | null, logs: PracticeLog[], now = Date.now()): string {
  if (!plan) return '';
  const p = planProgress(plan, logs, now);
  return [
    `练习计划：${plan.title}（${plan.focus}，${plan.weeks} 周，每周 ${plan.daysPerWeek} 次，每次约 ${plan.minutesPerSession} 分钟）`,
    `本周完成：${p.done}/${p.target} 次`,
    p.nextStep ? `下一步：${p.nextStep.title}（${p.nextStep.mode}，约 ${p.nextStep.durationSec} 秒）` : '',
  ].filter(Boolean).join('\n');
}

/** 提醒用：同步读取当前计划的下一步 */
export function nextPracticeStep(): PracticeStep | null {
  if (!state.plan || state.plan.status !== 'active') return null;
  return planProgress(state.plan, state.logs).nextStep;
}

/**
 * 录音结束后尝试自动关联计划：
 * 模式一致且时长达到步骤的一半才自动记为完成；否则挂起，等用户在计划条里选择。
 */
export function autoLogPracticeForRecord(record: AnalysisRecord): 'logged' | 'pending' | 'none' {
  const plan = state.plan;
  if (!plan || plan.status !== 'active' || !record.mode) return 'none';
  const step = planProgress(plan, state.logs).nextStep;
  if (!step) return 'none';
  if (record.mode === step.mode && record.stats.durationSec >= step.durationSec * 0.5) {
    const log = logPractice({ stepId: step.id, recordId: record.id, at: record.createdAt });
    return log ? 'logged' : 'none';
  }
  setPendingPracticeRecord(record.id);
  return 'pending';
}
