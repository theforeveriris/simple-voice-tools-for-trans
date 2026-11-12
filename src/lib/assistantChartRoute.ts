/**
 * 助手消息里的图表引用路由（纯字符串层，可单测、无 window 依赖）
 *
 * 语法：
 * - `![说明](record://<recordId>/<kind>)` 单条记录
 * - `![说明](trend://<metric>/last:<n>)` 多记录趋势
 * - `![说明](compare://<idA>,<idB>/<kind>)` 两条记录并排对比
 *
 * 渲染组件见 assistantCharts.tsx。
 */
export const IMG_KINDS = ['pitch', 'formant', 'energy', 'vowel'] as const;
export type ImgKind = (typeof IMG_KINDS)[number];

/** TrendChart 目前支持的纵轴指标 */
export const TREND_CHART_METRICS = ['f0', 'mpt', 'cpps'] as const;
export type TrendChartMetric = (typeof TREND_CHART_METRICS)[number];

export interface AssistantChartPart {
  type: 'img';
  content: string;
  alt?: string;
  /** record:// */
  recordId?: string;
  kind?: ImgKind;
  /** trend:// */
  trend?: { metric: TrendChartMetric; lastN: number };
  /** compare:// */
  compare?: { a: string; b: string; kind: ImgKind };
  /** 语法可识别但参数不合法 */
  chartError?: string;
}

export function isImgKind(v: string): v is ImgKind {
  return (IMG_KINDS as readonly string[]).includes(v);
}

export function isTrendChartMetric(v: string): v is TrendChartMetric {
  return (TREND_CHART_METRICS as readonly string[]).includes(v);
}

const CHART_RE = /!\[([^\]]*)\]\((record:\/\/([A-Za-z0-9_.-]+)\/(\w+)|trend:\/\/([a-z0-9]+)\/last:(\d{1,2})|compare:\/\/([A-Za-z0-9_.-]+),([A-Za-z0-9_.-]+)\/(\w+))\)/g;

/**
 * 文本 → 分段：图表引用独立成段，其余走 Markdown。
 */
export function renderAssistantContent(text: string): Array<{ type: 'md'; content: string } | AssistantChartPart> {
  const parts: Array<{ type: 'md'; content: string } | AssistantChartPart> = [];
  let last = 0;
  const re = new RegExp(CHART_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: 'md', content: text.slice(last, m.index) });
    const alt = m[1];
    const base = { type: 'img' as const, content: m[0], alt };
    if (m[3]) {
      const kind = m[4];
      parts.push({
        ...base,
        recordId: m[3],
        ...(isImgKind(kind) ? { kind } : { chartError: 'unknown-kind' }),
      });
    } else if (m[5]) {
      const metric = m[5];
      const lastN = Math.max(1, Math.min(20, Number(m[6]) || 8));
      parts.push({
        ...base,
        ...(isTrendChartMetric(metric)
          ? { trend: { metric, lastN } }
          : { chartError: 'unknown-metric' }),
      });
    } else if (m[7]) {
      const kind = m[9];
      parts.push({
        ...base,
        ...(isImgKind(kind)
          ? { compare: { a: m[7], b: m[8], kind } }
          : { chartError: 'unknown-kind' }),
      });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ type: 'md', content: text.slice(last) });
  return parts;
}
