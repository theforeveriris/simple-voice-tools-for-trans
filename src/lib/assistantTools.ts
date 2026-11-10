/**
 * AI 助手的只读查询工具
 *
 * 这些工具只读取本机已有数据（记录 / 内置文档），不产生任何写入。
 * 工具循环见 assistantAgent.ts；调用结果会以文本回填给模型，
 * 记录 id 用于模型输出 record:// 图表。
 */
import type { AnalysisRecord, AppSettings, TestMode } from '@/types';
import { retrieveDocsDetailed } from '@/lib/docKnowledge';
import type { LlmToolSpec } from '@/lib/llm';
import type { ChatConversation, ChatRef } from './llmChats';
import { searchChats } from './chatSearch';
import {
  computeTrend,
  formatTrendText,
  isTrendMetric,
  trendMetricLabel,
  type TrendCompare,
} from './assistantTrends';
import {
  assessRecordQuality,
  deltaIsSignificant,
  qualityLabel,
  type MdcMetric,
} from './measurement';
import { buildContextReport, buildStatsReport, normalizeModeArg, normalizeRangeSelector } from './assistantCommandRuntime';

export type AssistantToolContext = {
  records: AnalysisRecord[];
  settings: Pick<AppSettings, 'targetEnabled' | 'targetF0Min' | 'targetF0Max'> & {
    baselineRecordId?: string | null;
  };
  /** 本地对话列表（search_chats 用） */
  chats?: ChatConversation[];
  currentChatId?: string;
  /** 当前对话已固定（pinned）的记录 id（get_context 用） */
  pinnedRecordIds?: string[];
  /** 当前页面（get_context 用） */
  currentPage?: { tab: string; recordId?: string | null };
  chatTitle?: string;
  messageCount?: number;
  privacy?: string;
  memoryOff?: boolean;
};

export type AssistantToolOutcome = {
  /** 回填给模型的文本 */
  text: string;
  /** 展示在「本轮上下文」里的简述 */
  summary: string;
  /** 结果里出现过的记录 id（供图表与上下文面板） */
  recordIds?: string[];
  /** 命中的内置文档 */
  docs?: { title: string; chars: number }[];
  /** 跨对话检索命中的参考对话 */
  chatRefs?: ChatRef[];
  /** 需要用户确认的写操作（一次最多一个） */
  pendingAction?: import('./assistantActions').AssistantAction;
  /** 需要用户选择的问题（一次最多一个） */
  pendingChoice?: import('./assistantChoice').PendingChoice;
  /** 需要用户一次提交的多问题卡 */
  pendingChoiceSet?: import('./assistantChoice').PendingChoiceSet;
};

const MAX_QUERY = 20;

/** 工具定义（JSON Schema；OpenAI / Anthropic 共用） */
export const ASSISTANT_DATA_TOOLS: LlmToolSpec[] = [
  {
    name: 'query_records',
    description:
      '按时间范围 / 测试模式查询历史录音的紧凑列表。需要趋势、最近几次表现或挑选记录时使用；只返回摘要，详细指标用 get_record。',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: '起始日期，YYYY-MM-DD（含当天，可选）' },
        to: { type: 'string', description: '结束日期，YYYY-MM-DD（含当天，可选）' },
        mode: {
          type: 'string',
          enum: ['reading', 'sustained', 'glide'],
          description: '测试模式（可选）',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_QUERY,
          description: `最多返回几条，默认 8（上限 ${MAX_QUERY}）`,
        },
      },
      required: [],
    },
  },
  {
    name: 'get_record',
    description:
      '读取一条记录的详细统计（基频、靶标命中、共振峰、嗓音质量等）。用户明确提到某次录音，或 query_records 返回的摘要不够时使用。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '记录 id（来自 query_records 或历史上下文）' },
      },
      required: ['id'],
    },
  },
  {
    name: 'compare_records',
    description:
      '对比两条记录的指标差异。用户问「比上次进步了吗」「A 和 B 有什么区别」时使用；先用 query_records 找到两个 id。',
    parameters: {
      type: 'object',
      properties: {
        a: { type: 'string', description: '较早的记录 id' },
        b: { type: 'string', description: '较新的记录 id' },
      },
      required: ['a', 'b'],
    },
  },
  {
    name: 'search_docs',
    description:
      '检索应用内置的嗓音训练文档（官方口径、指标含义、参考区间）。回答概念、方法或产品用法时使用；不要用它查询用户自己的录音。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '2–8 个关键词或用户原话中的关键短语' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_trends',
    description:
      '按指标计算代码级趋势：均值、中位数、波动、首末变化、每周斜率、靶标命中率，以及相比上一周期 / 基线的差值。用户问「最近几次怎么样」「有没有进步」「本周比上周如何」「离基线多远」时使用；不要自己心算这些数字。',
    parameters: {
      type: 'object',
      properties: {
        metric: {
          type: 'string',
          enum: ['f0', 'f1', 'f2', 'jitter', 'shimmer', 'hnr', 'cpps', 'inTarget', 'duration'],
          description: 'F0 中位 / F1 / F2 / Jitter / Shimmer / HNR / CPPS / 靶标命中率 / 录音时长',
        },
        lastN: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          description: '最近几条记录，默认 8（上限 20）',
        },
        mode: {
          type: 'string',
          enum: ['reading', 'sustained', 'glide'],
          description: '测试模式（可选）',
        },
        from: { type: 'string', description: '起始日期 YYYY-MM-DD（可选）' },
        to: { type: 'string', description: '结束日期 YYYY-MM-DD（可选）' },
        compare: {
          type: 'string',
          enum: ['previous', 'baseline'],
          description: '与紧邻的上一周期比较，或与设置中的基线记录比较（可选）',
        },
      },
      required: ['metric'],
    },
  },
  {
    name: 'search_chats',
    description:
      '在用户的历史对话里检索「上次说过 / 之前聊过 / 那个练习」这类情节记忆。返回对话标题、日期、消息片段和 chatId；只查本地文本，不查录音数据。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '2–8 个关键词，或用户原话中的关键短语' },
        limit: { type: 'integer', minimum: 1, maximum: 8, description: '最多返回几个对话，默认 5' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_stats',
    description:
      '对一组历史录音做本地聚合统计（条数、平均 / 中位 F0、P10–P90、靶标命中率、总时长、模式分布）。用户问「这周整体怎么样」「最近状态」或需要汇总时使用；不要用 query_records 逐条累加。可以只给 range / mode，也可以给 selector。',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: '组合选择器：week / today / yesterday / month / all / last:N / latest / mode:reading|sustained|glide / date:YYYY-MM-DD；多个用空格分隔（可选）',
        },
        range: {
          type: 'string',
          description: '时间范围：week（默认）/ today / yesterday / month / all / last:N；与 mode 同时给出时取交集（可选）',
        },
        mode: {
          type: 'string',
          description: '测试模式：reading / sustained / glide，也接受「朗读 / 长音 / 滑音」（可选）',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_context',
    description:
      '读取当前对话的上下文摘要：已固定（pinned）的记录、当前页面、基线、记忆和隐私状态。用户问「你现在知道什么」「引用了哪些记录」或需要确认上下文时使用。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

function fmt(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return digits > 0 ? n.toFixed(digits) : String(Math.round(n));
}

function dateLabel(ts: number): string {
  const d = new Date(ts);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function modeLabel(mode: TestMode | undefined): string {
  return mode === 'sustained' ? '持续发声' : mode === 'glide' ? '滑音' : mode === 'reading' ? '朗读' : '未标注';
}

function summaryLine(r: AnalysisRecord): string {
  const st = r.stats;
  const parts = [
    `id=${r.id}`,
    dateLabel(r.createdAt),
    modeLabel(r.mode),
    `${fmt(st.durationSec, 1)}s`,
    `F0 中位 ${fmt(st.medianF0)} / P10 ${fmt(st.p10F0)} / P90 ${fmt(st.p90F0)} Hz`,
  ];
  if (st.inTargetPct != null) parts.push(`靶标命中 ${fmt(st.inTargetPct)}%`);
  if (st.avgF1 != null && st.avgF2 != null) parts.push(`F1/F2 ${fmt(st.avgF1)}/${fmt(st.avgF2)} Hz`);
  if (st.f2f1GapMedianHz != null) parts.push(`F2−F1 ${fmt(st.f2f1GapMedianHz)} Hz`);
  if (st.breathiness != null) parts.push(`气声 ${fmt(st.breathiness, 2)}`);
  const quality = assessRecordQuality(r);
  if (quality.level !== 'ok') {
    parts.push(`数据质量${qualityLabel(quality.level)}${quality.reasons.length > 0 ? `（${quality.reasons.slice(0, 2).join('；')}）` : ''}`);
  }
  return `- ${parts.join(' ｜ ')}`;
}

function detailText(r: AnalysisRecord): string {
  const st = r.stats;
  const lines = [
    `记录 id=${r.id}`,
    `时间：${dateLabel(r.createdAt)}`,
    `模式：${modeLabel(r.mode)}`,
    `时长：${fmt(st.durationSec, 1)} 秒，有声帧 ${fmt(st.voicedSamples)}/${fmt(st.totalSamples)}`,
    `基频：平均 ${fmt(st.avgF0)} / 中位 ${fmt(st.medianF0)} / 最低 ${fmt(st.minF0)} / 最高 ${fmt(st.maxF0)} / P10 ${fmt(st.p10F0)} / P90 ${fmt(st.p90F0)} / 标准差 ${fmt(st.stdF0, 1)} Hz`,
  ];
  if (st.inTargetPct != null) lines.push(`训练靶标命中率：${fmt(st.inTargetPct)}%`);
  if (st.avgF1 != null || st.avgF2 != null) {
    lines.push(`共振峰：F1 ${fmt(st.avgF1)} / F2 ${fmt(st.avgF2)} Hz`);
  }
  if (st.f2f1GapMedianHz != null) lines.push(`F2−F1 间距中位：${fmt(st.f2f1GapMedianHz)} Hz`);
  if (st.f1Range || st.f2Range) {
    lines.push(
      `共振峰范围：F1 ${st.f1Range ? `${fmt(st.f1Range[0])}–${fmt(st.f1Range[1])}` : '—'} / F2 ${st.f2Range ? `${fmt(st.f2Range[0])}–${fmt(st.f2Range[1])}` : '—'} Hz`,
    );
  }
  const quality: string[] = [];
  if (st.jitterPct != null) quality.push(`Jitter ${fmt(st.jitterPct, 2)}%`);
  if (st.shimmerPct != null) quality.push(`Shimmer ${fmt(st.shimmerPct, 2)}%`);
  if (st.hnrDb != null) quality.push(`HNR ${fmt(st.hnrDb, 1)} dB`);
  if (st.cppsDb != null) quality.push(`CPPS ${fmt(st.cppsDb, 1)} dB`);
  if (st.breathiness != null) quality.push(`气声 ${fmt(st.breathiness, 2)}`);
  if (st.h1h2Db != null) quality.push(`H1−H2 ${fmt(st.h1h2Db, 1)} dB`);
  if (quality.length) lines.push(`嗓音质量：${quality.join(' / ')}`);
  const recordQuality = assessRecordQuality(r);
  lines.push(`数据质量：${qualityLabel(recordQuality.level)}${recordQuality.reasons.length > 0 ? `（${recordQuality.reasons.join('；')}）` : ''}`);
  lines.push(`可用图表：pitch / formant / energy / vowel`);
  if (r.note?.trim()) lines.push(`备注：${r.note.trim().slice(0, 200)}`);
  return lines.join('\n');
}

function startOfDay(value: string): number | null {
  const t = new Date(value.length === 10 ? `${value}T00:00:00` : value).getTime();
  return Number.isFinite(t) ? t : null;
}

function endOfDay(value: string): number | null {
  const t = new Date(value.length === 10 ? `${value}T23:59:59.999` : value).getTime();
  return Number.isFinite(t) ? t : null;
}

function queryRecords(args: Record<string, unknown>, ctx: AssistantToolContext): AssistantToolOutcome {
  const from = typeof args.from === 'string' ? startOfDay(args.from) : null;
  const to = typeof args.to === 'string' ? endOfDay(args.to) : null;
  const mode = args.mode === 'reading' || args.mode === 'sustained' || args.mode === 'glide' ? args.mode : null;
  const limitRaw = typeof args.limit === 'number' ? Math.round(args.limit) : 8;
  const limit = Math.min(MAX_QUERY, Math.max(1, limitRaw));
  const matched = ctx.records
    .filter((r) => (from == null || r.createdAt >= from) && (to == null || r.createdAt <= to))
    .filter((r) => !mode || r.mode === mode)
    .sort((a, b) => b.createdAt - a.createdAt);
  if (matched.length === 0) {
    return { text: '没有符合条件的记录。', summary: '查询记录：0 条', recordIds: [] };
  }
  const shown = matched.slice(0, limit);
  const lines = [
    `共 ${matched.length} 条，按时间从新到旧，显示前 ${shown.length} 条：`,
    ...shown.map(summaryLine),
  ];
  if (matched.length > shown.length) lines.push(`（还有 ${matched.length - shown.length} 条未显示，可缩小时间范围）`);
  return {
    text: lines.join('\n'),
    summary: `查询记录：${matched.length} 条`,
    recordIds: shown.map((r) => r.id),
  };
}

function getRecord(args: Record<string, unknown>, ctx: AssistantToolContext): AssistantToolOutcome {
  const id = typeof args.id === 'string' ? args.id.trim() : '';
  const record = ctx.records.find((r) => r.id === id);
  if (!record) {
    return { text: `没有找到 id=${id || '（空）'} 的记录。可用 query_records 先查找。`, summary: '读取记录：未找到' };
  }
  return { text: detailText(record), summary: '读取记录：1 条', recordIds: [record.id] };
}

function signed(n: number, digits = 0): string {
  const v = digits > 0 ? n.toFixed(digits) : String(Math.round(n));
  return n > 0 ? `+${v}` : v;
}

function compareRecords(args: Record<string, unknown>, ctx: AssistantToolContext): AssistantToolOutcome {
  const aId = typeof args.a === 'string' ? args.a.trim() : '';
  const bId = typeof args.b === 'string' ? args.b.trim() : '';
  const a = ctx.records.find((r) => r.id === aId);
  const b = ctx.records.find((r) => r.id === bId);
  if (!a || !b) {
    return { text: `没有找到记录：${!a ? `a=${aId}` : ''}${!a && !b ? '，' : ''}${!b ? `b=${bId}` : ''}。`, summary: '对比记录：未找到' };
  }
  const lines = [
    `A：${dateLabel(a.createdAt)} · ${modeLabel(a.mode)}（id=${a.id}）`,
    `B：${dateLabel(b.createdAt)} · ${modeLabel(b.mode)}（id=${b.id}）`,
  ];
  const delta = (label: string, av: number | null | undefined, bv: number | null | undefined, unit: string, digits = 0, mdc?: MdcMetric) => {
    if (av == null || bv == null) return;
    const diff = bv - av;
    const note = mdc && !deltaIsSignificant(mdc, diff) ? '（基本持平，在测量波动范围内）' : '';
    lines.push(`${label}：${fmt(av, digits)} → ${fmt(bv, digits)} ${unit}（${signed(diff, digits)}）${note}`);
  };
  delta('F0 中位', a.stats.medianF0, b.stats.medianF0, 'Hz', 0, 'medianF0');
  delta('F0 P10', a.stats.p10F0, b.stats.p10F0, 'Hz');
  delta('F0 P90', a.stats.p90F0, b.stats.p90F0, 'Hz');
  delta('靶标命中率', a.stats.inTargetPct, b.stats.inTargetPct, '%', 0, 'inTarget');
  delta('F1', a.stats.avgF1, b.stats.avgF1, 'Hz', 0, 'avgF1');
  delta('F2', a.stats.avgF2, b.stats.avgF2, 'Hz', 0, 'avgF2');
  delta('F2−F1', a.stats.f2f1GapMedianHz, b.stats.f2f1GapMedianHz, 'Hz');
  delta('气声指数', a.stats.breathiness, b.stats.breathiness, '', 2);
  return {
    text: lines.join('\n'),
    summary: '对比记录：2 条',
    recordIds: [a.id, b.id],
  };
}

async function searchDocs(args: Record<string, unknown>): Promise<AssistantToolOutcome> {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) return { text: '查询词为空。', summary: '读取文档：0 篇' };
  const hit = await retrieveDocsDetailed(query, 4);
  if (!hit.text) return { text: `没有找到与「${query}」相关的内置文档。`, summary: '读取文档：0 篇' };
  return {
    text: hit.text,
    summary: `读取文档：${hit.docs.length} 篇`,
    docs: hit.docs,
  };
}

/** 跨对话情节检索：只返回本地片段，不把整段历史塞进上下文 */
function searchChatTool(args: Record<string, unknown>, ctx: AssistantToolContext): AssistantToolOutcome {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) return { text: '查询词为空。', summary: '参考对话：0 个' };
  const limit = typeof args.limit === 'number' && Number.isFinite(args.limit)
    ? Math.max(1, Math.min(8, Math.round(args.limit)))
    : 5;
  const hits = searchChats(ctx.chats ?? [], query, {
    excludeId: ctx.currentChatId,
    limit,
  });
  if (hits.length === 0) {
    return {
      text: `没有找到与「${query}」相关的历史对话。`,
      summary: '参考对话：0 个',
    };
  }
  const chatRefs: ChatRef[] = hits.map((hit) => {
    const snippet = hit.snippets[0];
    return {
      chatId: hit.chatId,
      title: hit.title,
      createdAt: hit.createdAt,
      messageIndex: snippet?.messageIndex ?? 0,
      snippet: snippet?.text ?? hit.title,
    };
  });
  const lines = [
    `找到 ${hits.length} 个相关历史对话（只列片段）：`,
    ...hits.map((hit, i) => {
      const date = new Date(hit.createdAt).toISOString().slice(0, 10);
      const snippets = hit.snippets
        .map((snippet) => `   ${snippet.role === 'user' ? '用户' : '助手'}：${snippet.text}`)
        .join('\n');
      return `${i + 1}. ${hit.title}（${date}）\n${snippets}`;
    }),
  ];
  return {
    text: lines.join('\n'),
    summary: `参考对话：${hits.length} 个`,
    chatRefs,
  };
}

/** 趋势工具：所有数字由 computeTrend 计算，模型只负责解释 */
function getTrends(args: Record<string, unknown>, ctx: AssistantToolContext): AssistantToolOutcome {
  const metric = isTrendMetric(args.metric) ? args.metric : null;
  if (!metric) {
    return { text: 'metric 无效。可用：f0 / f1 / f2 / jitter / shimmer / hnr / cpps / inTarget / duration。', summary: '趋势：参数无效' };
  }
  const lastN = typeof args.lastN === 'number' && Number.isFinite(args.lastN)
    ? Math.max(1, Math.min(20, Math.round(args.lastN)))
    : 8;
  const mode: TestMode | null = args.mode === 'reading' || args.mode === 'sustained' || args.mode === 'glide'
    ? args.mode
    : null;
  const compare: TrendCompare | null = args.compare === 'previous' || args.compare === 'baseline'
    ? args.compare
    : null;
  const from = typeof args.from === 'string' ? args.from : null;
  const to = typeof args.to === 'string' ? args.to : null;
  const baselineRecordId = compare === 'baseline' ? ctx.settings.baselineRecordId ?? null : null;
  const options = { lastN, mode, from, to, compare, baselineRecordId };
  const result = computeTrend(ctx.records, metric, options);
  let text = formatTrendText(result, options);
  if (compare === 'baseline' && !baselineRecordId) {
    text += '\n未设置基线记录，无法比较基线；可先在分析页把某条记录设为基线。';
  }
  return {
    text,
    summary: `趋势：${trendMetricLabel(metric)} · ${result.count} 条`,
    recordIds: result.recordIds,
  };
}

/** 执行一个只读工具；未知工具返回 null */
export async function runAssistantDataTool(
  name: string,
  args: Record<string, unknown>,
  ctx: AssistantToolContext,
): Promise<AssistantToolOutcome | null> {
  switch (name) {
    case 'query_records':
      return queryRecords(args, ctx);
    case 'get_record':
      return getRecord(args, ctx);
    case 'compare_records':
      return compareRecords(args, ctx);
    case 'search_docs':
      return searchDocs(args);
    case 'get_trends':
      return getTrends(args, ctx);
    case 'search_chats':
      return searchChatTool(args, ctx);
    case 'get_stats': {
      const rawSelector = typeof args.selector === 'string' ? args.selector.trim() : '';
      const selectors = rawSelector
        ? rawSelector.split(/\s+/)
        : [normalizeRangeSelector(args.range)];
      const report = buildStatsReport(
        ctx.records,
        selectors,
        ctx.settings.baselineRecordId,
        normalizeModeArg(args.mode),
      );
      return { text: report.text, summary: report.summary, recordIds: report.recordIds };
    }
    case 'get_context': {
      const report = buildContextReport({
        records: ctx.records,
        pinnedRecordIds: ctx.pinnedRecordIds,
        currentPage: ctx.currentPage,
        chatTitle: ctx.chatTitle,
        messageCount: ctx.messageCount,
        privacy: ctx.privacy,
        memoryOff: ctx.memoryOff,
        baselineRecordId: ctx.settings.baselineRecordId,
      });
      return { text: report.text, summary: report.summary, recordIds: report.recordIds };
    }
    default:
      return null;
  }
}
