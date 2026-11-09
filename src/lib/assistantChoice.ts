/**
 * AI 的阻塞式选择题（受控 genui）
 *
 * 模型不直接输出一段「你要 A 还是 B？」然后结束；它调用 ask_choice 提交结构化
 * 问题和选项，前端统一渲染 ChoiceCard。用户选完后自动追加一条用户消息并继续
 * 生成，模型不需要再次询问。
 */
import type { LlmToolSpec } from './llm';
import type { AssistantToolOutcome } from './assistantTools';

export type ChoiceSelection = 'single' | 'multiple';

export interface ChoiceOption {
  id: string;
  label: string;
  description?: string;
}

export interface PendingChoice {
  id: string;
  question: string;
  selection: ChoiceSelection;
  options: ChoiceOption[];
  /** 是否显示「其他」输入框 */
  allowOther: boolean;
  createdAt: number;
}

export interface ChoiceResult {
  selectedIds: string[];
  custom?: string;
  skipped?: boolean;
  /** 展示用摘要（用户消息 chip 用） */
  label?: string;
}

function genId(): string {
  return `choice_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** 解析并校验模型提交的选择器参数；无效时返回 null */
export function parseChoiceCall(args: Record<string, unknown>): PendingChoice | null {
  const question = typeof args.question === 'string' ? args.question.trim().slice(0, 160) : '';
  if (!question) return null;
  const rawOptions = Array.isArray(args.options) ? args.options : [];
  const options: ChoiceOption[] = [];
  const seen = new Set<string>();
  for (const raw of rawOptions.slice(0, 6)) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const label = typeof o.label === 'string' ? o.label.trim().slice(0, 80) : '';
    if (!label) continue;
    const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim().slice(0, 40) : `o${options.length + 1}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const description = typeof o.description === 'string' ? o.description.trim().slice(0, 160) : '';
    options.push({ id, label, ...(description ? { description } : {}) });
  }
  if (options.length < 2) return null;
  return {
    id: genId(),
    question,
    selection: args.selection === 'multiple' ? 'multiple' : 'single',
    options,
    allowOther: args.allowOther !== false,
    createdAt: Date.now(),
  };
}

/** 把选择结果转成下一条用户消息，供模型继续回答 */
export function buildChoiceUserMessage(choice: PendingChoice, result: ChoiceResult): string {
  if (result.skipped) {
    return `关于「${choice.question}」，用户选择先不决定，请直接继续给出建议。`;
  }
  const labels = choice.options
    .filter((o) => result.selectedIds.includes(o.id))
    .map((o) => o.label);
  const custom = result.custom?.trim();
  if (labels.length === 0 && !custom) {
    return `关于「${choice.question}」，用户没有选择具体选项，请继续。`;
  }
  const picked = [...labels, ...(custom ? [`其他：${custom}`] : [])].join('、');
  return `关于「${choice.question}」，用户选择了：${picked}。请继续。`;
}

/** 选项/自定义内容的中文摘要（UI 已选状态用） */
export function choiceResultLabel(choice: PendingChoice, result: ChoiceResult): string {
  if (result.skipped) return '';
  const labels = choice.options
    .filter((o) => result.selectedIds.includes(o.id))
    .map((o) => o.label);
  const custom = result.custom?.trim();
  return [...labels, ...(custom ? [`其他：${custom}`] : [])].join('、');
}

export const ASSISTANT_CHOICE_TOOL: LlmToolSpec = {
  name: 'ask_choice',
  description:
    '当回答取决于用户的选择（训练方向、范围、偏好、下一步等）时，向用户展示一个统一选择器并暂停当前回合。用户选完后会自动继续；可以连续调用多轮。如果用户要求演示/测试选择器或多轮提问，也必须调用本工具，不要生成 HTML/代码演示。不要在正文里问完就结束。',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: '简短问题，最多 160 字' },
      selection: {
        type: 'string',
        enum: ['single', 'multiple'],
        description: '单选（默认）或多选',
      },
      options: {
        type: 'array',
        minItems: 2,
        maxItems: 6,
        description: '2–6 个选项；每项包含 label，可选 description',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: '选项标题，简短' },
            description: { type: 'string', description: '一行说明，可选' },
          },
          required: ['label'],
        },
      },
      allowOther: {
        type: 'boolean',
        description: '是否显示「其他」输入框，默认 true',
      },
    },
    required: ['question', 'options'],
  },
};

/** 执行 ask_choice 工具；返回待用户选择的选择器 */
export function runAssistantChoiceTool(
  name: string,
  args: Record<string, unknown>,
): AssistantToolOutcome | null {
  if (name !== 'ask_choice') return null;
  const choice = parseChoiceCall(args);
  if (!choice) {
    return {
      text: '选择器参数无效：需要 2–6 个带 label 的选项，以及一个非空问题。',
      summary: '选择器：参数无效',
    };
  }
  return {
    text: `已向用户展示选择器：「${choice.question}」。等待用户选择，不要继续回答。`,
    summary: '等待用户选择',
    pendingChoice: choice,
  };
}
