/**
 * AI 回复的文本路由：把一条回复拆成 Markdown / 原生图表 / genui 组件。
 *
 * - `record://` 单条记录图
 * - `trend://` 多记录趋势图
 * - `compare://` 两条记录并排对比
 * - ```genui 围栏是站点渲染的沙箱 HTML 组件（见 assistantGenui.tsx）
 * - 未闭合的 genui 围栏在流式输出期间返回 pending，避免把半截 HTML 当正文
 *
 * 纯字符串层，可单测；不依赖 window / React。
 */
import {
  renderAssistantContent as splitCharts,
  type AssistantChartPart,
} from './assistantChartRoute';

export type AssistantPart =
  | { type: 'md'; content: string }
  | AssistantChartPart
  | { type: 'genui'; content: string }
  | { type: 'genui-pending' };

const GENUI_FENCE = /```genui[ \t]*\r?\n([\s\S]*?)```/gi;
const GENUI_OPEN = /```genui[ \t]*\r?\n/i;

export function renderAssistantMessage(text: string): AssistantPart[] {
  const out: AssistantPart[] = [];

  const pushMd = (chunk: string) => {
    if (!chunk) return;
    for (const p of splitCharts(chunk)) {
      if (p.type === 'img') out.push(p);
      else out.push({ type: 'md', content: p.content });
    }
  };

  let last = 0;
  const re = new RegExp(GENUI_FENCE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    pushMd(text.slice(last, m.index));
    const html = m[1].trim();
    if (html) out.push({ type: 'genui', content: html });
    last = m.index + m[0].length;
  }

  const rest = text.slice(last);
  // 流式输出时围栏可能还没闭合：只显示 pending，不把半截 HTML 当 Markdown
  const open = rest.search(GENUI_OPEN);
  if (open >= 0) {
    pushMd(rest.slice(0, open));
    out.push({ type: 'genui-pending' });
  } else {
    pushMd(rest);
  }
  return out;
}
