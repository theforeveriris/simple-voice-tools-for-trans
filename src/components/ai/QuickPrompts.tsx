/**
 * 空会话的快捷提问：先给本地规则生成的问题，再在后台用一次非流式小请求
 * 让模型按最近记录生成更贴合的问题，回来后原地替换（数量一致，不跳动）。
 * 失败 / 超时 / 未配置模型时静默保留本地结果。
 * 版式：胶囊；点一下只填入输入框，不自动发送。
 */

import { useEffect, useMemo, useState } from 'react';
import { buildQuickPrompts } from '@/lib/assistantSuggestions';
import {
  buildSuggestPrompts, parseSuggestions, readSuggestCache, suggestFingerprint, writeSuggestCache,
} from '@/lib/assistantSuggestAi';
import { languageName, llmChat } from '@/lib/llm';
import { useActiveLlmConfig } from '@/lib/llmProfiles';
import { useHistoryStore } from '@/store/useHistoryStore';
import { useStore } from '@/store/useStore';
import { getLocale, t } from '@/i18n';
import { useI18n } from '@/i18n/hook';

/** AI 建议最少几条才替换本地结果（太少说明输出不完整） */
const MIN_AI_ITEMS = 3;
/** 后台请求超时：不阻塞界面，超时就继续用本地问题 */
const AI_TIMEOUT_MS = 12_000;

export function QuickPrompts({ onPick }: { onPick: (text: string) => void }) {
  useI18n();
  const records = useHistoryStore((s) => s.records);
  const goal = useStore((s) => s.settings.userGoal);
  const activeProfileId = useStore((s) => s.settings.llmActiveProfileId);
  const cfg = useActiveLlmConfig(activeProfileId);
  const [aiTexts, setAiTexts] = useState<string[] | null>(null);

  const localItems = useMemo(() => buildQuickPrompts(records, t), [records]);
  const cfgKey = cfg ? `${cfg.protocol}|${cfg.baseUrl}|${cfg.modelId}` : '';

  useEffect(() => {
    if (!cfg || records.length === 0) {
      setAiTexts(null);
      return;
    }
    let alive = true;
    const ctrl = new AbortController();
    const fp = suggestFingerprint(records, goal, getLocale());
    const timer = window.setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
    void (async () => {
      const cached = await readSuggestCache(fp);
      if (!alive) return;
      if (cached) {
        setAiTexts(cached);
        window.clearTimeout(timer);
        return;
      }
      try {
        const { system, user } = buildSuggestPrompts(records, { userGoal: goal }, languageName());
        const text = await llmChat(cfg, system, user, 0.6, ctrl.signal, 'assistant');
        const parsed = parseSuggestions(text, 4);
        if (!alive || parsed.length < MIN_AI_ITEMS) return;
        setAiTexts(parsed);
        void writeSuggestCache(fp, parsed);
      } catch {
        /* 静默回退：本地问题已经在显示 */
      } finally {
        window.clearTimeout(timer);
      }
    })();
    return () => {
      alive = false;
      ctrl.abort();
      window.clearTimeout(timer);
    };
    // cfg 用 cfgKey 表示，避免档案对象每次渲染更换引用导致重复请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfgKey, goal, records]);

  const items = aiTexts && aiTexts.length >= MIN_AI_ITEMS
    ? aiTexts.map((text, i) => ({ id: `ai-${i}`, text }))
    : localItems;

  return (
    <div className="flex w-full max-w-sm flex-wrap justify-center gap-2">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onPick(item.text)}
          className="max-w-full rounded-full border border-line/70 bg-ink/[0.04] px-3.5 py-1.5 text-left text-[11px] leading-snug text-ink transition-colors hover:border-line hover:bg-ink/[0.07] active:scale-[0.98]"
        >
          {item.text}
        </button>
      ))}
    </div>
  );
}
