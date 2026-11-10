/**
 * 助手命令 runtime：用户 `/stats`、`/context` 与模型工具共用的只读实现。
 *
 * 用户命令只把结果展示在本地对话框，不写入聊天消息，因此模型上下文完全无感；
 * 模型通过 `get_stats` / `get_context` 工具调用同一套函数，结果作为 tool result 回填。
 */
import type { AnalysisRecord } from '@/types';
import type { LlmToolSpec } from '@/lib/llm';
import { resolveRecordSelectors } from './assistantCommands';

export interface AssistantCommandReport {
  title: string;
  text: string;
  /** 工具轨迹里的一行摘要 */
  summary: string;
  /** 结果涉及的记录 id */
  recordIds: string[];
}

export interface ContextReportInput {
  records: AnalysisRecord[];
  pinnedRecordIds?: string[];
  currentPage?: { tab: string; recordId?: string | null };
  chatTitle?: string;
  messageCount?: number;
  privacy?: string;
  memoryOff?: boolean;
  baselineRecordId?: string | null;
}

/**
 * 模型可调用的本地命令入口（与用户 / 命令共用能力层）。
 * 只开放只读 / 低风险命令；录音、清空、删除、新建对话等仍归用户。
 */
export const ASSISTANT_COMMAND_TOOL: LlmToolSpec = {
  name: 'run_command',
  description:
    '执行本地助手命令（和用户输入的 / 命令同一套能力）。可用：stats（统计记录）、context（查看引用记录 / 页面 / 记忆状态）、attach（固定记录）、detach（取消固定）、open（打开页面）。用户命令本身对模型不可见；需要这些能力时主动调用本工具。',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'stats=统计；context=查看上下文；attach=固定记录；detach=取消固定；open=打开页面。web_search 是独立工具，请直接调用 web_search；若走本工具，可写 "web_search <关键词>"。',
      },
      args: {
        type: 'string',
        description: '命令参数：stats 用 week/today/last:N/all/mode:...；attach 用 latest/last:N/today/id:...；detach 可空或 all；open 用 test/analysis/history/assistant/settings',
      },
      params: {
        type: 'object',
        description: '可选的结构化参数（部分模型会用它代替 args）；stats 可传 range / mode',
        additionalProperties: true,
      },
      query: {
        type: 'string',
        description: 'web_search 的关键词（兼容部分模型把 query 放在顶层参数）',
      },
    },
    required: ['command'],
  },
};

const MODE_LABEL: Record<string, string> = {
  reading: '朗读',
  sustained: '长音',
  glide: '滑音',
};

/** 工具调用里的 range 别名 → assistantCommands 选择器 */
export function normalizeRangeSelector(range: unknown): string {
  if (typeof range !== 'string') return 'week';
  const text = range.trim().toLowerCase();
  if (!text) return 'week';
  const map: Record<string, string> = {
    'last_7d': 'week',
    'last7d': 'week',
    '7d': 'week',
    'week': 'week',
    'past_week': 'week',
    '本周': 'week',
    '最近7天': 'week',
    today: 'today',
    '今天': 'today',
    yesterday: 'yesterday',
    '昨天': 'yesterday',
    month: 'month',
    '30d': 'month',
    'last_30d': 'month',
    '本月': 'month',
    '最近30天': 'month',
    all: 'all',
    '全部': 'all',
    latest: 'latest',
    '最新': 'latest',
  };
  if (map[text]) return map[text];
  const last = text.match(/^last[:_\s-]?(\d+)$/);
  if (last) return `last:${last[1]}`;
  if (/^\d+$/.test(text)) return `last:${text}`;
  if (text.startsWith('date:') || text.startsWith('mode:') || text.startsWith('id:')) return text;
  return text;
}

/** 工具调用里的 mode 别名 → reading / sustained / glide */
export function normalizeModeArg(mode: unknown): 'reading' | 'sustained' | 'glide' | null {
  if (typeof mode !== 'string') return null;
  const text = mode.trim().toLowerCase();
  const map: Record<string, 'reading' | 'sustained' | 'glide'> = {
    reading: 'reading',
    read: 'reading',
    '朗读': 'reading',
    '阅读': 'reading',
    sustained: 'sustained',
    sustain: 'sustained',
    '长音': 'sustained',
    '持续': 'sustained',
    glide: 'glide',
    '滑音': 'glide',
  };
  return map[text] ?? null;
}

function one(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(1).replace(/\.0$/, '');
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function durationText(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0s';
  if (sec < 60) return `${one(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s ? `${m}m ${s}s` : `${m}m`;
}

function dateText(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
}

function recordDetail(rec: AnalysisRecord): string {
  return `${dateText(rec.createdAt)} · ${MODE_LABEL[rec.mode ?? 'reading'] ?? rec.mode} · ${one(rec.stats.avgF0)}Hz`;
}

/** 选择器的可读标签（只用于展示，不影响解析） */
export function selectorLabel(selectors: string[]): string {
  if (!selectors.length) return '最近 7 天';
  if (selectors.length > 1) return selectors.join(' · ');
  const s = selectors[0].trim().toLowerCase();
  if (s === 'week') return '最近 7 天';
  if (s === 'today') return '今天';
  if (s === 'yesterday') return '昨天';
  if (s === 'month') return '最近 30 天';
  if (s === 'all') return '全部';
  if (s === 'latest') return '最新一条';
  if (s === 'baseline') return '基线';
  if (s.startsWith('last:')) return `最近 ${s.slice(5)} 条`;
  if (s.startsWith('mode:')) return `模式：${MODE_LABEL[s.slice(5)] ?? s.slice(5)}`;
  if (s.startsWith('date:')) return s.slice(5);
  if (s.startsWith('range:')) return s.slice(6).replace('..', '–');
  return selectors[0];
}

/**
 * 聚合统计。selector 支持 assistantCommands 里的全部记录选择器；
 * 多个选择器会取并集。
 */
export function buildStatsReport(
  records: AnalysisRecord[],
  selectors: string[],
  baselineRecordId?: string | null,
  mode?: 'reading' | 'sustained' | 'glide' | null,
): AssistantCommandReport {
  const resolved = resolveRecordSelectors(selectors, records, baselineRecordId ?? undefined);
  const matched = mode
    ? resolved.filter((r) => (r.mode ?? 'reading') === mode)
    : resolved;
  if (!matched.length) {
    return {
      title: '统计',
      text: '没有符合条件的记录。',
      summary: '统计：0 条',
      recordIds: [],
    };
  }
  const rangeLabel = mode
    ? `${selectorLabel(selectors)} · 模式：${MODE_LABEL[mode]}`
    : selectorLabel(selectors);
  const sorted = [...matched].sort((a, b) => a.createdAt - b.createdAt);
  const count = sorted.length;
  const avgF0 = mean(sorted.map((r) => r.stats.avgF0));
  const medianF0 = median(sorted.map((r) => r.stats.medianF0));
  const p10 = mean(sorted.map((r) => r.stats.p10F0));
  const p90 = mean(sorted.map((r) => r.stats.p90F0));
  const inTarget = sorted
    .map((r) => r.stats.inTargetPct)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const totalSec = sorted.reduce((sum, r) => sum + (r.stats.durationSec || r.durationSec || 0), 0);
  const modeCounts = sorted.reduce<Record<string, number>>((out, r) => {
    const mode = r.mode ?? 'reading';
    out[mode] = (out[mode] ?? 0) + 1;
    return out;
  }, {});
  const modeLine = Object.entries(modeCounts)
    .map(([mode, n]) => `${MODE_LABEL[mode] ?? mode} ${n}`)
    .join(' · ');
  const dateRange = sorted[0].createdAt === sorted[count - 1].createdAt
    ? dateText(sorted[0].createdAt)
    : `${dateText(sorted[0].createdAt)}–${dateText(sorted[count - 1].createdAt)}`;

  const lines = [
    `范围：${rangeLabel} · ${count} 条`,
    dateRange,
    `平均 F0 ${one(avgF0)} Hz · 中位 ${one(medianF0)} Hz`,
    `P10–P90 ${one(p10)}–${one(p90)} Hz`,
    inTarget.length
      ? `靶标命中 ${one(mean(inTarget))}%（${inTarget.length} 条有靶标）`
      : '靶标命中：无靶标数据',
    `总时长 ${durationText(totalSec)} · 平均 ${durationText(totalSec / count)}`,
    ...(modeLine ? [`模式：${modeLine}`] : []),
  ];

  return {
    title: '统计',
    text: lines.join('\n'),
    summary: `统计：${count} 条 · 平均 ${one(avgF0)} Hz`,
    recordIds: sorted.slice(-20).map((r) => r.id),
  };
}

function privacyLabel(privacy?: string): string {
  if (privacy === 'private') return '私密';
  if (privacy === 'no-write') return '只读记忆';
  return '普通';
}

/** 当前对话上下文摘要：pinned 记录、当前页、基线、记忆 / 隐私。 */
export function buildContextReport(input: ContextReportInput): AssistantCommandReport {
  const pinned = (input.pinnedRecordIds ?? [])
    .map((id) => input.records.find((r) => r.id === id))
    .filter((r): r is AnalysisRecord => !!r)
    .sort((a, b) => a.createdAt - b.createdAt);
  const baseline = input.baselineRecordId
    ? input.records.find((r) => r.id === input.baselineRecordId)
    : null;
  const lines = [
    `对话：${input.chatTitle?.trim() || '新对话'}`,
    `消息 ${input.messageCount ?? 0} 条 · 记忆 ${input.memoryOff ? '关闭' : '开启'} · 隐私 ${privacyLabel(input.privacy)}`,
  ];
  if (baseline) lines.push(`基线：${recordDetail(baseline)}`);
  if (input.currentPage) {
    lines.push(`当前页面：${input.currentPage.tab}${input.currentPage.recordId ? ` · 记录 ${input.currentPage.recordId}` : ''}`);
  }
  if (!pinned.length) {
    lines.push('已引用记录：无（可用 /attach latest 固定记录）');
  } else {
    lines.push(`已引用 ${pinned.length} 条记录：`);
    pinned.forEach((r, i) => {
      const note = r.note?.trim() ? ` · ${r.note.trim().slice(0, 40)}` : '';
      lines.push(`${i + 1}. ${recordDetail(r)}${note}（id=${r.id}）`);
    });
  }

  return {
    title: '上下文',
    text: lines.join('\n'),
    summary: `上下文：${pinned.length} 条引用`,
    recordIds: [
      ...pinned.map((r) => r.id),
      ...(input.currentPage?.recordId ? [input.currentPage.recordId] : []),
      ...(baseline ? [baseline.id] : []),
    ],
  };
}
