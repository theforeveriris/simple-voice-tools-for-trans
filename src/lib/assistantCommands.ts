/**
 * AI 助手 Slash 命令：解析、能力注册表与记录选择器。
 *
 * 命令只在用户输入框最开头识别，由客户端执行；模型不能生成或触发命令。
 * 解析与选择器都是纯函数，便于单测。
 */

import type { AnalysisRecord, TestMode } from '@/types';
import type { DictKey } from '@/i18n';

export type AssistantCommandId =
  | 'help'
  | 'new'
  | 'record'
  | 'stop'
  | 'attach'
  | 'detach'
  | 'compare'
  | 'review'
  | 'open'
  | 'unknown';

export interface ParsedCommand {
  id: AssistantCommandId;
  /** 原样保留完整输入，便于错误提示 */
  raw: string;
  /** 命令后的参数（已按空白拆分） */
  args: string[];
  /** 未知命令的原始命令词 */
  unknownName?: string;
}

export type AssistantCommandCategory = 'capture' | 'context' | 'analysis' | 'open' | 'session';

export interface AssistantCommandSpec {
  id: Exclude<AssistantCommandId, 'unknown'>;
  /** 展示用命令（含参数） */
  usage: string;
  /** 菜单分组 */
  category: AssistantCommandCategory;
  /** 说明词条 */
  descriptionKey: DictKey;
}

/** 菜单与 /help 的唯一数据源 */
export const ASSISTANT_COMMANDS: AssistantCommandSpec[] = [
  {
    id: 'record',
    usage: '/record [reading|sustained|glide]',
    category: 'capture',
    descriptionKey: 'assistant.cmd.record',
  },
  {
    id: 'stop',
    usage: '/stop',
    category: 'capture',
    descriptionKey: 'assistant.cmd.stop',
  },
  {
    id: 'attach',
    usage: '/attach <latest|last:N|today|week|id:…>',
    category: 'context',
    descriptionKey: 'assistant.cmd.attach',
  },
  {
    id: 'detach',
    usage: '/detach [all|<selector>]',
    category: 'context',
    descriptionKey: 'assistant.cmd.detach',
  },
  {
    id: 'compare',
    usage: '/compare <A> <B>',
    category: 'analysis',
    descriptionKey: 'assistant.cmd.compare',
  },
  {
    id: 'review',
    usage: '/review [today|week|month|all]',
    category: 'analysis',
    descriptionKey: 'assistant.cmd.review',
  },
  {
    id: 'open',
    usage: '/open <analysis|records|settings> [id|latest]',
    category: 'open',
    descriptionKey: 'assistant.cmd.open',
  },
  {
    id: 'new',
    usage: '/new',
    category: 'session',
    descriptionKey: 'assistant.cmd.new',
  },
  {
    id: 'help',
    usage: '/help [command]',
    category: 'session',
    descriptionKey: 'assistant.cmd.help',
  },
];

const ALIASES: Record<string, AssistantCommandId> = {
  '/r': 'record',
  '/record': 'record',
  '/录音': 'record',
  '/stop': 'stop',
  '/停止': 'stop',
  '/a': 'attach',
  '/attach': 'attach',
  '/引用': 'attach',
  '/detach': 'detach',
  '/取消引用': 'detach',
  '/c': 'compare',
  '/compare': 'compare',
  '/对比': 'compare',
  '/review': 'review',
  '/整理': 'review',
  '/open': 'open',
  '/new': 'new',
  '/新对话': 'new',
  '/help': 'help',
  '/帮助': 'help',
  '/?': 'help',
};

/** 解析一条用户输入；非命令返回 null，未知命令返回 id='unknown' */
export function parseAssistantCommand(input: string): ParsedCommand | null {
  const raw = input.trim();
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  const parts = raw.split(/\s+/);
  const head = parts[0].toLowerCase();
  const args = parts.slice(1);
  if (!head) return null;

  const preset: Partial<Record<string, AssistantCommandId>> = {
    '/analysis': 'open',
    '/分析页': 'open',
    '/records': 'open',
    '/记录': 'open',
    '/settings': 'open',
    '/设置': 'open',
  };
  if (preset[head]) {
    const page = head === '/analysis' || head === '/分析页'
      ? 'analysis'
      : head === '/records' || head === '/记录'
        ? 'records'
        : 'settings';
    return { id: 'open', raw, args: [page, ...args] };
  }

  const id = ALIASES[head];
  if (!id) return { id: 'unknown', raw, args, unknownName: parts[0] };
  return { id, raw, args };
}

/** 按前缀过滤命令菜单 */
export function filterCommands(query: string): AssistantCommandSpec[] {
  const q = query.trim().toLowerCase();
  if (!q || q === '/') return ASSISTANT_COMMANDS;
  return ASSISTANT_COMMANDS.filter((c) => c.usage.toLowerCase().includes(q));
}

/** 测试模式参数：空 = reading；无法识别返回 null */
export function parseTestMode(arg: string | undefined): TestMode | null {
  if (!arg) return 'reading';
  const v = arg.toLowerCase();
  if (v === 'reading' || v === 'read' || v === '朗读') return 'reading';
  if (v === 'sustained' || v === 'sustain' || v === '长音' || v === '持续') return 'sustained';
  if (v === 'glide' || v === '滑音') return 'glide';
  return null;
}

const DAY = 86_400_000;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayStartFromYmd(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setHours(0, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function byCreatedAsc(a: AnalysisRecord, b: AnalysisRecord): number {
  return a.createdAt - b.createdAt;
}

/**
 * 解析记录选择器。返回按时间升序的记录。
 * 支持：latest / all / last:N / today / yesterday / week / month /
 * id:<id> / baseline / date:YYYY-MM-DD / range:A..B / mode:reading|sustained|glide
 */
export function resolveRecordSelector(
  selector: string,
  records: AnalysisRecord[],
  baselineId?: string,
  now = Date.now(),
): AnalysisRecord[] {
  const sorted = [...records].sort(byCreatedAsc);
  const s = selector.trim().toLowerCase();
  if (!s || s === 'latest') {
    return sorted.length ? [sorted[sorted.length - 1]] : [];
  }
  if (s === 'all') return sorted;
  if (s === 'baseline') {
    const base = baselineId ? sorted.find((r) => r.id === baselineId) : undefined;
    return base ? [base] : [];
  }
  if (s.startsWith('last:')) {
    const n = Number(s.slice(5));
    if (!Number.isFinite(n) || n <= 0) return [];
    return sorted.slice(-Math.min(Math.floor(n), sorted.length));
  }
  if (s === 'today' || s === 'yesterday' || s === 'week' || s === 'month') {
    const today = startOfDay(now);
    let from = today;
    if (s === 'yesterday') from = today - DAY;
    if (s === 'week') from = today - 6 * DAY;
    if (s === 'month') from = today - 29 * DAY;
    const to = s === 'yesterday' ? today : today + DAY;
    return sorted.filter((r) => r.createdAt >= from && r.createdAt < to);
  }
  if (s.startsWith('id:')) {
    const id = selector.trim().slice(3);
    return sorted.filter((r) => r.id === id);
  }
  if (s.startsWith('date:')) {
    const from = dayStartFromYmd(s.slice(5));
    if (from == null) return [];
    return sorted.filter((r) => r.createdAt >= from && r.createdAt < from + DAY);
  }
  if (s.startsWith('range:')) {
    const body = s.slice(6);
    const [a, b] = body.split('..');
    const from = a ? dayStartFromYmd(a) : null;
    const toDay = b ? dayStartFromYmd(b) : null;
    if (from == null || toDay == null) return [];
    const to = toDay + DAY;
    return sorted.filter((r) => r.createdAt >= from && r.createdAt < to);
  }
  if (s.startsWith('mode:')) {
    const mode = s.slice(5);
    return sorted.filter((r) => (r.mode ?? 'reading') === mode);
  }
  // 允许直接写记录 id
  return sorted.filter((r) => r.id === selector.trim());
}

/** 多个选择器取并集（按 id 去重，保持时间升序） */
export function resolveRecordSelectors(
  selectors: string[],
  records: AnalysisRecord[],
  baselineId?: string,
  now = Date.now(),
): AnalysisRecord[] {
  const map = new Map<string, AnalysisRecord>();
  for (const selector of selectors) {
    for (const r of resolveRecordSelector(selector, records, baselineId, now)) {
      map.set(r.id, r);
    }
  }
  return [...map.values()].sort(byCreatedAsc);
}

/** /review 的范围：非法值回退 week */
export function reviewRangeDays(arg: string | undefined): { days: number; key: string } {
  switch ((arg ?? '').toLowerCase()) {
    case 'today': return { days: 1, key: 'today' };
    case 'month': return { days: 30, key: 'month' };
    case 'all': return { days: 0, key: 'all' };
    case 'week':
    default: return { days: 7, key: 'week' };
  }
}
