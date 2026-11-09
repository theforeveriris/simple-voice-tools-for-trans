/**
 * AI 助手的受控写操作
 *
 * 模型不能直接修改设置：它只能提交一个 PendingAction，由聊天里的 ActionCard
 * 展示前后对比，用户确认后才调用 store。导出会直接下载，但同样先确认。
 * 删除记录 / 清空数据等破坏性操作永远不在此白名单内。
 */
import type { AnalysisRecord, AppSettings, ViewType } from '@/types';
import { recordsWithinLastDays } from '@/lib/assistantCommands';
import { downloadText, recordsToSummaryCsv } from '@/lib/export/csv';
import { useHistoryStore } from '@/store/useHistoryStore';
import { useStore } from '@/store/useStore';
import { createPracticePlan, clearPracticePlan, getPracticePlanState, updatePracticePlan, type PlanFocus } from '@/lib/practicePlan';
import type { LlmToolSpec } from '@/lib/llm';
import type { AssistantToolOutcome } from '@/lib/assistantTools';

export type AssistantActionKind =
  | 'setTarget'
  | 'setBaseline'
  | 'createPlan'
  | 'updatePlan'
  | 'export'
  | 'open';

export interface AssistantAction {
  id: string;
  kind: AssistantActionKind;
  /** 结构化参数（setTarget: min/max；setBaseline: recordId；export: scope/format） */
  args: Record<string, unknown>;
  /** 一句话说明（展示在确认卡上） */
  summary: string;
  /** 修改前快照 */
  before: Record<string, unknown>;
  createdAt: number;
}

export interface AssistantActionContext {
  settings: AppSettings;
  records: AnalysisRecord[];
}

const FOCUS_LABEL: Record<PlanFocus, string> = {
  pitch: '音高',
  resonance: '共鸣',
  stability: '稳定',
  range: '音域',
  habit: '习惯',
};

function genId(): string {
  return `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function dateLabel(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** 未成年：限制计划强度，但不改变成人计划 */
function minorPlanCaps(ageGroup: AssistantActionContext['settings']['ageGroup']): { days: number; minutes: number } | null {
  return ageGroup === 'child' || ageGroup === 'adolescent'
    ? { days: 5, minutes: 20 }
    : null;
}

/**
 * 校验模型提出的操作；通过则返回待确认 action。
 * 只允许白名单内的安全操作。
 */
export function createAssistantAction(
  kind: string,
  args: Record<string, unknown>,
  ctx: AssistantActionContext,
): { action?: AssistantAction; error?: string } {
  if (ctx.settings.assistantWrites === 'off') {
    return { error: '用户已关闭 AI 写入权限，只能说明建议，不能提议修改。' };
  }
  const base = { id: genId(), createdAt: Date.now() };

  if (kind === 'setTarget') {
    const min = asNumber(args.min);
    const max = asNumber(args.max);
    if (min == null || max == null || min < 50 || max > 500 || min >= max) {
      return { error: '目标音高区间需要两个 50–500 Hz 的数字，且下限小于上限。' };
    }
    return {
      action: {
        ...base,
        kind: 'setTarget',
        args: { min: Math.round(min), max: Math.round(max) },
        summary: `目标音高 ${ctx.settings.targetF0Min}–${ctx.settings.targetF0Max} Hz → ${Math.round(min)}–${Math.round(max)} Hz`,
        before: {
          min: ctx.settings.targetF0Min,
          max: ctx.settings.targetF0Max,
          enabled: ctx.settings.targetEnabled,
        },
      },
    };
  }

  if (kind === 'setBaseline') {
    const id = typeof args.recordId === 'string' ? args.recordId.trim() : '';
    const record = ctx.records.find((r) => r.id === id);
    if (!record) return { error: `没有找到 id=${id || '（空）'} 的记录，无法设为基线。` };
    const old = ctx.records.find((r) => r.id === ctx.settings.baselineRecordId);
    return {
      action: {
        ...base,
        kind: 'setBaseline',
        args: { recordId: record.id },
        summary: `基线：${old ? `${dateLabel(old.createdAt)} · ${old.mode ?? '记录'}` : '未设置'} → ${dateLabel(record.createdAt)} · ${record.mode ?? '记录'}`,
        before: { recordId: ctx.settings.baselineRecordId ?? null },
      },
    };
  }

  if (kind === 'createPlan') {
    const focuses: PlanFocus[] = ['pitch', 'resonance', 'stability', 'range', 'habit'];
    const focus = typeof args.focus === 'string' && focuses.includes(args.focus as PlanFocus)
      ? args.focus as PlanFocus
      : null;
    const title = typeof args.title === 'string' ? args.title.trim().slice(0, 80) : '';
    const weeks = asNumber(args.weeks);
    const daysPerWeek = asNumber(args.daysPerWeek);
    const minutesPerSession = asNumber(args.minutesPerSession);
    if (!focus || !title || weeks == null || daysPerWeek == null || minutesPerSession == null
      || weeks < 1 || weeks > 52 || daysPerWeek < 1 || daysPerWeek > 7
      || minutesPerSession < 2 || minutesPerSession > 60) {
      return { error: '计划需要标题、重点、1–52 周、每周 1–7 次、每次 2–60 分钟。' };
    }
    const caps = minorPlanCaps(ctx.settings.ageGroup);
    const cappedDays = caps ? Math.min(daysPerWeek, caps.days) : daysPerWeek;
    const cappedMinutes = caps ? Math.min(minutesPerSession, caps.minutes) : minutesPerSession;
    return {
      action: {
        ...base,
        kind: 'createPlan',
        args: { title, focus, weeks, daysPerWeek: cappedDays, minutesPerSession: cappedMinutes },
        summary: `创建计划「${title}」：${FOCUS_LABEL[focus]}，每周 ${cappedDays} 次，每次约 ${cappedMinutes} 分钟${caps ? '（未成年强度上限）' : ''}`,
        before: {},
      },
    };
  }

  if (kind === 'updatePlan') {
    const plan = getPracticePlanState().plan;
    if (!plan) return { error: '当前没有可更新的练习计划。' };
    const patch: Record<string, unknown> = {};
    if (args.status === 'active' || args.status === 'paused' || args.status === 'done') patch.status = args.status;
    if (typeof args.title === 'string' && args.title.trim()) patch.title = args.title.trim().slice(0, 80);
    const caps = minorPlanCaps(ctx.settings.ageGroup);
    if (typeof args.daysPerWeek === 'number' && args.daysPerWeek >= 1 && args.daysPerWeek <= 7) {
      patch.daysPerWeek = caps ? Math.min(Math.round(args.daysPerWeek), caps.days) : Math.round(args.daysPerWeek);
    }
    if (typeof args.minutesPerSession === 'number' && args.minutesPerSession >= 2 && args.minutesPerSession <= 60) {
      patch.minutesPerSession = caps
        ? Math.min(Math.round(args.minutesPerSession), caps.minutes)
        : Math.round(args.minutesPerSession);
    }
    if (Object.keys(patch).length === 0) return { error: '没有可更新的计划字段。' };
    return {
      action: {
        ...base,
        kind: 'updatePlan',
        args: { id: plan.id, ...patch },
        summary: `更新计划「${plan.title}」：${Object.entries(patch).map(([k, v]) => `${k}=${String(v)}`).join('，')}`,
        before: {
          title: plan.title,
          status: plan.status,
          daysPerWeek: plan.daysPerWeek,
          minutesPerSession: plan.minutesPerSession,
        },
      },
    };
  }

  if (kind === 'export') {
    const scope = args.scope === 'all' ? 'all' : 'last7';
    const picked = scope === 'all' ? ctx.records : recordsWithinLastDays(ctx.records, 7);
    if (picked.length === 0) return { error: '所选范围内没有记录可导出。' };
    return {
      action: {
        ...base,
        kind: 'export',
        args: { scope, format: 'csv' },
        summary: `导出${scope === 'all' ? '全部' : '最近 7 天'} ${picked.length} 条记录（CSV）`,
        before: {},
      },
    };
  }

  if (kind === 'open') {
    const tab = typeof args.tab === 'string' ? args.tab : '';
    const allowed: ViewType[] = ['test', 'analysis', 'history', 'assistant', 'settings'];
    if (!allowed.includes(tab as ViewType)) return { error: '未知页面。' };
    return {
      action: {
        ...base,
        kind: 'open',
        args: { tab },
        summary: `打开${tab === 'analysis' ? '分析' : tab === 'history' ? '历史' : tab === 'settings' ? '设置' : tab === 'test' ? '测试' : '助手'}页`,
        before: {},
      },
    };
  }

  return { error: `不支持的操作：${kind}` };
}

/** 用户确认后执行；返回 toast 文案与可选撤销函数 */
export async function applyAssistantAction(
  action: AssistantAction,
): Promise<{ ok: boolean; error?: string; undo?: () => void; planId?: string }> {
  const store = useStore.getState();
  if (store.settings.assistantWrites === 'off') {
    return { ok: false, error: 'AI 写入权限已关闭。' };
  }

  if (action.kind === 'setTarget') {
    const min = asNumber(action.args.min);
    const max = asNumber(action.args.max);
    if (min == null || max == null) return { ok: false, error: '目标区间无效。' };
    const before = action.before as { min?: number; max?: number; enabled?: boolean };
    store.updateSettings({ targetF0Min: min, targetF0Max: max, targetEnabled: true });
    return {
      ok: true,
      undo: () => store.updateSettings({
        targetF0Min: before.min ?? 120,
        targetF0Max: before.max ?? 220,
        targetEnabled: before.enabled === true,
      }),
    };
  }

  if (action.kind === 'setBaseline') {
    const id = typeof action.args.recordId === 'string' ? action.args.recordId : '';
    if (!id) return { ok: false, error: '基线记录无效。' };
    const before = action.before as { recordId?: string | null };
    store.updateSettings({ baselineRecordId: id });
    return {
      ok: true,
      undo: () => store.updateSettings({ baselineRecordId: before.recordId ?? undefined }),
    };
  }

  if (action.kind === 'createPlan') {
    const focus = action.args.focus as PlanFocus;
    const plan = createPracticePlan({
      title: typeof action.args.title === 'string' ? action.args.title : undefined,
      focus,
      weeks: Number(action.args.weeks) || 4,
      daysPerWeek: Number(action.args.daysPerWeek) || 3,
      minutesPerSession: Number(action.args.minutesPerSession) || 10,
    });
    return { ok: true, planId: plan.id, undo: () => clearPracticePlan() };
  }

  if (action.kind === 'updatePlan') {
    const before = action.before as {
      title?: string;
      status?: 'active' | 'paused' | 'done';
      daysPerWeek?: number;
      minutesPerSession?: number;
    };
    const patch = {
      ...(typeof action.args.status === 'string' ? { status: action.args.status as 'active' | 'paused' | 'done' } : {}),
      ...(typeof action.args.title === 'string' ? { title: action.args.title } : {}),
      ...(typeof action.args.daysPerWeek === 'number' ? { daysPerWeek: action.args.daysPerWeek } : {}),
      ...(typeof action.args.minutesPerSession === 'number' ? { minutesPerSession: action.args.minutesPerSession } : {}),
    };
    const plan = updatePracticePlan(patch);
    if (!plan) return { ok: false, error: '当前没有可更新的练习计划。' };
    return {
      ok: true,
      planId: plan.id,
      undo: () => updatePracticePlan(before),
    };
  }

  if (action.kind === 'export') {
    const scope = action.args.scope === 'all' ? 'all' : 'last7';
    const records = useHistoryStore.getState().records;
    const picked = scope === 'all' ? records : recordsWithinLastDays(records, 7);
    if (picked.length === 0) return { ok: false, error: '没有记录可导出。' };
    downloadText(`svt-records-${scope}.csv`, recordsToSummaryCsv(picked), 'text/csv');
    return { ok: true };
  }

  if (action.kind === 'open') {
    const tab = action.args.tab as ViewType;
    store.setTab(tab);
    return { ok: true };
  }

  return { ok: false, error: '未知操作。' };
}

/* ------------------------------ 工具 ------------------------------ */

export const ASSISTANT_ACTION_TOOLS: LlmToolSpec[] = [
  {
    name: 'propose_action',
    description:
      '提议一个需要用户确认的修改：调整目标音高区间、设置基线记录、或导出记录 CSV。不要直接执行；用户会在聊天里看到前后对比并确认。删除记录和清空数据不可用。',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['setTarget', 'setBaseline', 'export'],
          description: '操作类型',
        },
        args: {
          type: 'object',
          description:
            'setTarget: {min,max}（Hz）；setBaseline: {recordId}；export: {scope:"last7"|"all",format:"csv"}',
        },
      },
      required: ['kind', 'args'],
    },
  },
  {
    name: 'open_page',
    description: '打开应用内的页面（测试 / 分析 / 历史 / 设置 / 助手）。只做导航，不修改任何数据。',
    parameters: {
      type: 'object',
      properties: {
        tab: { type: 'string', enum: ['test', 'analysis', 'history', 'assistant', 'settings'] },
      },
      required: ['tab'],
    },
  },
];

/** 执行操作类工具；未知工具返回 null */
export async function runAssistantActionTool(
  name: string,
  args: Record<string, unknown>,
  ctx: AssistantActionContext,
): Promise<AssistantToolOutcome | null> {
  if (name === 'propose_action') {
    const kind = typeof args.kind === 'string' ? args.kind : '';
    const payload = args.args && typeof args.args === 'object' ? args.args as Record<string, unknown> : {};
    const res = createAssistantAction(kind, payload, ctx);
    if (res.error) {
      return {
        text: res.error,
        summary: '提议修改：未通过校验',
      };
    }
    return {
      text: `已创建待确认操作：${res.action!.summary}\n等待用户在聊天里点击确认；不要声称已经修改。`,
      summary: '提议修改：等待确认',
      pendingAction: res.action,
    };
  }

  if (name === 'open_page') {
    const tab = typeof args.tab === 'string' ? args.tab : '';
    const allowed: ViewType[] = ['test', 'analysis', 'history', 'assistant', 'settings'];
    if (!allowed.includes(tab as ViewType)) {
      return { text: `未知页面：${tab}`, summary: '打开页面：失败' };
    }
    useStore.getState().setTab(tab as ViewType);
    return { text: `已打开${tab}页面。`, summary: '打开页面：1 次' };
  }

  return null;
}
