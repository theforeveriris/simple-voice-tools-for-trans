/**
 * 练习计划的助手工具
 * - get_plan：读取当前计划与本周进度
 * - create_plan / update_plan：生成待确认操作（用户确认后才落库）
 * - log_practice：记录一次完成，立即执行并可撤销
 */
import { toast } from 'sonner';
import { t } from '@/i18n';
import type { LlmToolSpec } from '@/lib/llm';
import type { AssistantToolOutcome } from '@/lib/assistantTools';
import { createAssistantAction, type AssistantActionContext } from '@/lib/assistantActions';
import {
  getPracticePlanState,
  loadPracticePlan,
  logPractice,
  planProgress,
  planSummaryForPrompt,
  removePracticeLog,
  type PlanFocus,
} from '@/lib/practicePlan';

const FOCUSES: PlanFocus[] = ['pitch', 'resonance', 'stability', 'range', 'habit'];

export const PRACTICE_PLAN_TOOLS: LlmToolSpec[] = [
  {
    name: 'get_plan',
    description: '读取用户当前的练习计划、每周目标、本周完成次数和下一步。用户问「我的计划」「今天练什么」时使用。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'create_plan',
    description:
      '为用户创建一份练习计划。必须先了解用户目标；提交后会在聊天里显示确认卡，用户确认后才真正保存。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '计划名称，简短' },
        focus: { type: 'string', enum: FOCUSES, description: '重点：音高 / 共鸣 / 稳定 / 音域 / 习惯' },
        weeks: { type: 'integer', minimum: 1, maximum: 52 },
        daysPerWeek: { type: 'integer', minimum: 1, maximum: 7 },
        minutesPerSession: { type: 'integer', minimum: 2, maximum: 60 },
      },
      required: ['title', 'focus', 'weeks', 'daysPerWeek', 'minutesPerSession'],
    },
  },
  {
    name: 'update_plan',
    description: '修改当前计划的状态或频率。提交后需要用户确认。',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'paused', 'done'] },
        title: { type: 'string' },
        daysPerWeek: { type: 'integer', minimum: 1, maximum: 7 },
        minutesPerSession: { type: 'integer', minimum: 2, maximum: 60 },
      },
      required: [],
    },
  },
  {
    name: 'log_practice',
    description: '记录用户完成了一次计划练习。用户明确说「练完了」「今天完成了」时使用；可带录音 id。',
    parameters: {
      type: 'object',
      properties: {
        stepId: { type: 'string', description: '完成的步骤 id（来自 get_plan）' },
        recordId: { type: 'string', description: '关联的录音 id（可选）' },
      },
      required: [],
    },
  },
];

function actionOutcome(action: ReturnType<typeof createAssistantAction>): AssistantToolOutcome {
  if (action.error || !action.action) {
    return { text: action.error ?? '操作未通过校验。', summary: '计划操作：未通过' };
  }
  return {
    text: `已创建待确认计划操作：${action.action.summary}\n等待用户点击确认；不要声称已经保存。`,
    summary: '计划操作：等待确认',
    pendingAction: action.action,
  };
}

export async function runPracticePlanTool(
  name: string,
  args: Record<string, unknown>,
  ctx: AssistantActionContext,
): Promise<AssistantToolOutcome | null> {
  await loadPracticePlan();
  const state = getPracticePlanState();

  if (name === 'get_plan') {
    if (!state.plan) {
      return {
        text: '用户还没有练习计划。可以先用 create_plan 提议一份，并说明会先让用户确认。',
        summary: '读取计划：无',
      };
    }
    const p = planProgress(state.plan, state.logs);
    return {
      text: [
        planSummaryForPrompt(state.plan, state.logs),
        `计划 id=${state.plan.id}`,
        state.plan.steps.map((s) => `- ${s.id} ${s.title}（${s.mode}，约 ${s.durationSec} 秒）`).join('\n'),
        `本周下一步：${p.nextStep ? `${p.nextStep.id} ${p.nextStep.title}` : '无'}`,
      ].join('\n'),
      summary: `读取计划：${p.done}/${p.target}`,
    };
  }

  if (name === 'create_plan') {
    return actionOutcome(createAssistantAction('createPlan', args, ctx));
  }

  if (name === 'update_plan') {
    return actionOutcome(createAssistantAction('updatePlan', args, ctx));
  }

  if (name === 'log_practice') {
    if (!state.plan) return { text: '用户还没有练习计划。', summary: '记录练习：无计划' };
    const stepId = typeof args.stepId === 'string' ? args.stepId : undefined;
    if (stepId && !state.plan.steps.some((s) => s.id === stepId)) {
      return { text: `计划里没有步骤 id=${stepId}。`, summary: '记录练习：步骤不存在' };
    }
    const log = logPractice({
      stepId,
      recordId: typeof args.recordId === 'string' ? args.recordId : undefined,
    });
    if (!log) return { text: '这条练习今天已经记录过，或没有可记录的步骤。', summary: '记录练习：已存在' };
    toast.success(t('assistant.planLogged'), {
      action: {
        label: t('common.undo'),
        onClick: () => removePracticeLog(log.id),
      },
    });
    return { text: '已记录一次练习完成。', summary: '记录练习：1 次' };
  }

  return null;
}
