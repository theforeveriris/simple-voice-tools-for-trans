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
import type { LlmToolSpec } from '@/lib/llm';
import type { AssistantToolOutcome } from '@/lib/assistantTools';

export type AssistantActionKind = 'setTarget' | 'setBaseline' | 'export' | 'open';

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
): Promise<{ ok: boolean; error?: string; undo?: () => void }> {
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
