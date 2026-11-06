/**
 * 空会话的快捷提问（纯逻辑，可单测）
 *
 * 不调用大模型：只用本地历史记录与训练目标拼出 4 个问题，
 * 点一下只填入输入框（由 UI 决定，不自动发送）。
 * 记录很少或没有记录时降级为通用问题，保证永远有内容可点。
 */

import type { AnalysisRecord, TestMode } from '@/types';
import type { DictKey } from '@/i18n';

export type SuggestTranslate = (key: DictKey, params?: Record<string, string | number>) => string;

export interface QuickPrompt {
  /** 稳定 id（用于渲染 key 与单测断言） */
  id: 'trend' | 'pitch' | 'plan' | 'compare' | 'start' | 'vfp';
  /** 填进输入框的完整问题 */
  text: string;
  /** 卡片下方的小字说明（来源/依据） */
  hint: string;
}

const DAY_MS = 86_400_000;

/** 当前模式集合里出现次数最多的模式（至少 2 条；忽略未标注模式） */
function dominantMode(records: AnalysisRecord[]): TestMode | null {
  const counts = new Map<TestMode, number>();
  for (const r of records) {
    if (!r.mode) continue;
    counts.set(r.mode, (counts.get(r.mode) ?? 0) + 1);
  }
  let best: TestMode | null = null;
  let bestCount = 0;
  for (const [mode, n] of counts) {
    if (n > bestCount) {
      best = mode;
      bestCount = n;
    }
  }
  return bestCount >= 2 ? best : null;
}

function shortDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * 生成 4 个快捷提问。
 * @param records 历史记录（顺序不限，内部按时间倒序）
 * @param tr 翻译函数（7 语言）
 * @param now 当前时间（测试注入）
 */
export function buildQuickPrompts(
  records: AnalysisRecord[],
  tr: SuggestTranslate,
  now: number = Date.now(),
): QuickPrompt[] {
  const sorted = [...records].sort((a, b) => b.createdAt - a.createdAt);
  const latest = sorted[0];

  if (!latest) {
    return [
      { id: 'start', text: tr('assistant.sugg.startFirst'), hint: tr('assistant.sugg.hintGeneral') },
      { id: 'vfp', text: tr('assistant.sugg.whatIsVfp'), hint: tr('assistant.sugg.hintDoc') },
      { id: 'plan', text: tr('assistant.sugg.plan'), hint: tr('assistant.sugg.hintPlan') },
      { id: 'compare', text: tr('assistant.sugg.compare'), hint: tr('assistant.sugg.hintRecent2') },
    ];
  }

  const last7 = sorted.filter((r) => now - r.createdAt <= 7 * DAY_MS);
  const trend: QuickPrompt = last7.length >= 2
    ? { id: 'trend', text: tr('assistant.sugg.trend'), hint: tr('assistant.sugg.byRecords', { n: last7.length }) }
    : { id: 'trend', text: tr('assistant.sugg.latest'), hint: tr('assistant.sugg.byLatest') };

  const hz = Math.round(latest.stats.avgF0);
  const pitch: QuickPrompt = {
    id: 'pitch',
    text: tr('assistant.sugg.pitch', { hz }),
    hint: tr('assistant.sugg.byLatestDate', { date: shortDate(latest.createdAt) }),
  };

  const plan: QuickPrompt = {
    id: 'plan',
    text: tr('assistant.sugg.plan'),
    hint: tr('assistant.sugg.hintPlan'),
  };

  const mode = dominantMode(last7.length >= 2 ? last7 : sorted.slice(0, 10));
  const compare: QuickPrompt = mode
    ? { id: 'compare', text: tr('assistant.sugg.compareMode', { mode: tr(`mode.${mode}`) }), hint: tr('assistant.sugg.hintRecent7') }
    : { id: 'compare', text: tr('assistant.sugg.compare'), hint: tr('assistant.sugg.hintRecent2') };

  return [trend, pitch, plan, compare];
}
