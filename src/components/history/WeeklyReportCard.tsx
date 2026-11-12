/**
 * AI 周报卡（历史页 · 趋势视图底部）
 * 聚合最近 7 天记录（按模式分组）发给大模型，生成一段周总结：
 * 练习一致性 → 音高 vs 目标 → 共鸣 → 嗓音健康 → 下周建议。
 * 依赖 设置 → 大模型 中使用中档案的接口；同一周内会话级缓存。
 */

import { useEffect, useRef, useState } from 'react';
import { CalendarRange, Loader2, RefreshCw } from 'lucide-react';
import { useStore } from '@/store/useStore';
import {
  cachedWeeklyReport, fetchWeeklyReport, hasCachedWeeklyReport, weekRecords, weeklyReportKey,
  type LlmPromptOptions,
} from '@/lib/llm';
import { readLlmUsage, usageSince, type LlmUsageCount } from '@/lib/llmUsage';
import { useActiveLlmConfig } from '@/lib/llmProfiles';
import { planSummaryForPrompt, usePracticePlan } from '@/lib/practicePlan';
import { useLlmStream } from '@/hooks/useLlmStream';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import type { AnalysisRecord } from '@/types';
import { LlmResultView, StreamPreview } from '@/components/analysis/LlmResultView';

/** 近 7 天窗口（与周报聚合窗口一致） */
const WEEK_MS = 7 * 24 * 3600 * 1000;

/** token 数紧凑格式：<1000 原样，否则 K（一位小数）；与 LlmUsageSection 同规则 */
function fmtTokens(n: number): string {
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}K`;
}

/**
 * 近 7 天 AI 用量摘要行（周报生成成功后显示在卡底部）：
 * 明细日志按时间过滤（上限 200 条内），给出本周期调用次数与 token 消耗，
 * 让「本月花了多少」在消费场景（周报）里直接可见，不必去设置页翻。
 */
function WeeklyUsageLine() {
  useI18n();
  const [usage, setUsage] = useState<LlmUsageCount | null>(null);
  useEffect(() => {
    let alive = true;
    void readLlmUsage()
      .then((snap) => {
        if (alive) setUsage(usageSince(snap, WEEK_MS));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!usage || usage.calls === 0) return null;
  const tokens = usage.promptTokens + usage.completionTokens;
  return (
    <p className="mt-2 border-t border-black/[0.04] px-0.5 pt-2 text-[10px] tabular-nums text-ink-2">
      {t('history.reportUsage', {
        calls: usage.calls,
        tokens: fmtTokens(tokens),
      })}
    </p>
  );
}

export function WeeklyReportCard({ records }: { records: AnalysisRecord[] }) {
  useI18n();
  const adviceMode = useStore((s) => s.settings.adviceMode);
  const activeProfileId = useStore((s) => s.settings.llmActiveProfileId);
  const cfg = useActiveLlmConfig(activeProfileId);
  const extraRules = useStore((s) => s.settings.llmExtraRules);
  const promptOverride = useStore((s) => s.settings.llmPromptOverride);
  const userGoal = useStore((s) => s.settings.userGoal);
  const ageGroup = useStore((s) => s.settings.ageGroup);
  const planState = usePracticePlan();
  const planSummary = planSummaryForPrompt(planState.plan, planState.logs);
  const prompt: LlmPromptOptions = {
    extraRules,
    promptOverride,
    goal: userGoal,
    ageGroup,
    ...(planSummary ? { planSummary } : {}),
  };

  const key = cfg ? weeklyReportKey(cfg, records, prompt) : null;
  // effect 按缓存键（值稳定）触发，输入经 ref 传递
  const latest = useRef({ records, cfg, prompt });
  useEffect(() => {
    latest.current = { records, cfg, prompt };
  });
  const llm = useLlmStream({
    key,
    run: (signal, onDelta) => {
      const cur = latest.current;
      const curKey = weeklyReportKey(cur.cfg!, cur.records, cur.prompt);
      return cachedWeeklyReport(curKey, () => fetchWeeklyReport(cur.records, cur.cfg!, {
        prompt: cur.prompt,
        signal,
        onDelta,
      }));
    },
    checkCached: hasCachedWeeklyReport,
  });
  const { state, requestKey, stream, stale } = llm;
  const hasWeek = weekRecords(records).length > 0;

  return (
    <div className="card-surface p-4">
      <div className="mb-1.5 flex items-center justify-between px-0.5">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-ink">
          <CalendarRange size={13} className="text-accent" />
          {t('history.reportTitle')}
        </span>
        <span className="text-[10px] text-ink-2">{t('settings.labs')}</span>
      </div>

      {adviceMode !== 'llm' || !cfg ? (
        <p className="px-0.5 text-xs leading-relaxed text-ink-2">{t('history.reportNeedLlm')}</p>
      ) : !hasWeek ? (
        <p className="px-0.5 text-xs leading-relaxed text-ink-2">{t('history.reportEmpty')}</p>
      ) : llm.loading ? (
        <div className="flex flex-col px-0.5">
          <div className="flex items-center gap-2 text-xs text-ink-2">
            <Loader2 size={13} className="animate-spin text-accent" />
            {t('history.reportLoading')}
            <button
              onClick={llm.abort}
              className="ml-auto text-[11px] font-medium text-ink-2 transition-opacity hover:opacity-70"
            >
              {t('common.cancel')}
            </button>
          </div>
          {stream?.key === requestKey && <StreamPreview text={stream.text} />}
        </div>
      ) : state.error != null ? (
        <div className="flex flex-col gap-1.5 px-0.5">
          <p className="text-xs leading-relaxed text-ink">
            <span className="font-medium">{t('history.reportFail')}</span>
            <span className="ml-1 break-all text-ink-2">{state.error}</span>
          </p>
          <button
            onClick={llm.retry}
            className="flex w-fit items-center gap-1.5 text-xs font-medium text-accent transition-opacity hover:opacity-70"
          >
            <RefreshCw size={12} />
            {t('analysis.adviceLlmRetry')}
          </button>
        </div>
      ) : state.cancelled ? (
        <div className="flex flex-col gap-1.5 px-0.5">
          <p className="text-xs leading-relaxed text-ink-2">{t('analysis.adviceLlmCancelled')}</p>
          <button
            onClick={llm.retry}
            className="flex w-fit items-center gap-1.5 text-xs font-medium text-accent transition-opacity hover:opacity-70"
          >
            <RefreshCw size={12} />
            {t('analysis.adviceLlmRetry')}
          </button>
        </div>
      ) : state.result ? (
        <>
          <LlmResultView result={state.result} />
          {/* stale = 输入在生成后变化过且未自动重取（缓存未命中），提示可重新生成 */}
          <button
            onClick={llm.retry}
            className={`mt-2 flex items-center gap-1.5 px-0.5 text-[11px] font-medium transition-opacity hover:opacity-70 ${stale ? 'text-accent' : 'text-ink-2'}`}
          >
            <RefreshCw size={11} />
            {t('history.reportRegenerate')}
          </button>
          <WeeklyUsageLine />
        </>
      ) : (
        <button
          onClick={llm.start}
          className="rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-on-accent transition-opacity hover:opacity-90"
        >
          {t('history.reportGenerate')}
        </button>
      )}
    </div>
  );
}
