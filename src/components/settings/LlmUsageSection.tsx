/**
 * Token 用量分区（大模型配置下方）
 * 读取本机 kv（llm:usage:*）展示各功能的调用次数与 token 消耗，
 * 费用由模型单价自动折算：优先用服务商 /models 返回的真实单价，
 * 其次内置单价目录（lib/llmPricing.ts）。数据由 lib/llm.ts 落账。
 */

import { useEffect, useState } from 'react';
import { Gauge } from 'lucide-react';
import {
  clearLlmUsage, emptyTotals, LLM_FEATURES, readLlmUsage,
  type LlmFeature, type LlmUsageCount, type LlmUsageSnapshot,
} from '@/lib/llmUsage';
import { useActiveLlmConfig } from '@/lib/llmProfiles';
import { builtinPriceFor, resolveModelPrice } from '@/lib/llmPricing';
import type { ModelPrice } from '@/lib/llmModels';
import { t } from '@/i18n';
import type { DictKey } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import type { AppSettings } from '@/types';
import { SettingsSection, SettingRow } from './rows';
import { InfoTip } from './InfoTip';

const FEATURE_KEY: Record<LlmFeature, DictKey> = {
  advice: 'settings.llmUsageFeatureAdvice',
  weekly: 'settings.llmUsageFeatureWeekly',
  translate: 'settings.llmUsageFeatureTranslate',
  test: 'settings.llmUsageFeatureTest',
  assistant: 'settings.llmUsageFeatureAssistant',
};

/** token 数紧凑格式：<1000 原样，否则 K（一位小数） */
function fmtTokens(n: number): string {
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}K`;
}

/** 费用紧凑格式：小于 0.01 保留四位，其余两位小数 */
function fmtCost(n: number): string {
  return n > 0 && n < 0.01 ? n.toFixed(4) : n.toFixed(2);
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function LlmUsageSection({
  settings,
}: {
  settings: AppSettings;
}) {
  useI18n();
  const [snap, setSnap] = useState<LlmUsageSnapshot | null>(null);
  // 清空按钮两步确认：第一次点击进入确认态，再次点击才真正清空
  const [confirmClear, setConfirmClear] = useState(false);
  const cfg = useActiveLlmConfig(settings.llmActiveProfileId);
  /**
   * 单价：内置目录同步可得；服务商 /models 的价格异步到达后按 cfg 覆盖。
   * 用 { key, price } 而不是在 effect 里同步 setState——key 不匹配就回退内置值。
   */
  const cfgKey = cfg ? `${cfg.protocol ?? 'openai'}|${cfg.baseUrl}|${cfg.modelId}` : '';
  const [remotePrice, setRemotePrice] = useState<{ key: string; price: ModelPrice | null } | null>(null);
  const price = remotePrice && remotePrice.key === cfgKey ? remotePrice.price : builtinPriceFor(cfg);

  useEffect(() => {
    let alive = true;
    void readLlmUsage()
      .then((s) => {
        if (alive) setSnap(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!cfg) return;
    let alive = true;
    void resolveModelPrice(cfg).then((p) => {
      if (alive) setRemotePrice({ key: cfgKey, price: p });
    });
    return () => {
      alive = false;
    };
    // cfgKey 已覆盖 cfg 的三个关键字段
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfgKey]);

  const onClear = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    void clearLlmUsage()
      .then(() => setSnap({ totals: emptyTotals(), log: [] }))
      .catch(() => {});
  };

  const showCost = price != null;
  const cost = (c: LlmUsageCount) => (c.promptTokens / 1e6) * price!.input + (c.completionTokens / 1e6) * price!.output;

  const priceLabel = price
    ? t('settings.llmUsagePriceResolved', {
      model: cfg?.modelId ?? '—',
      input: String(price.input),
      output: String(price.output),
    })
    : t('settings.llmUsagePriceUnknown');

  return (
    <SettingsSection
      icon={Gauge}
      title={<InfoTip label={t('settings.llmUsageTitle')} text={priceLabel} wide />}
    >
      {!snap ? (
        <p className="py-2 text-xs text-ink-2">{t('settings.llmUsageCounting')}</p>
      ) : snap.totals.all.calls === 0 ? (
        <p className="py-2 text-xs leading-relaxed text-ink-2">{t('settings.llmUsageEmpty')}</p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {LLM_FEATURES.filter((f) => snap.totals.byFeature[f].calls > 0).map((f) => {
            const c = snap.totals.byFeature[f];
            return (
              <SettingRow key={f} label={t(FEATURE_KEY[f])}>
                <span className="text-[11px] tabular-nums text-ink-2">
                  {c.calls} {t('settings.llmUsageCalls')}
                  <span className="ml-2">↑ {fmtTokens(c.promptTokens)}</span>
                  <span className="ml-1.5">↓ {fmtTokens(c.completionTokens)}</span>
                  {showCost && <span className="ml-1.5">≈ {fmtCost(cost(c))}</span>}
                </span>
              </SettingRow>
            );
          })}
          <SettingRow label={<span className="font-semibold">{t('settings.llmUsageTotal')}</span>}>
            <span className="text-[11px] font-semibold tabular-nums text-ink">
              {snap.totals.all.calls} {t('settings.llmUsageCalls')}
              <span className="ml-2">↑ {fmtTokens(snap.totals.all.promptTokens)}</span>
              <span className="ml-1.5">↓ {fmtTokens(snap.totals.all.completionTokens)}</span>
              {showCost && <span className="ml-1.5">≈ {fmtCost(cost(snap.totals.all))}</span>}
            </span>
          </SettingRow>
          {snap.totals.all.estCalls > 0 && (
            <p className="mt-1 text-[11px] leading-relaxed text-ink-2">
              {t('settings.llmUsageEst', { count: snap.totals.all.estCalls })}
            </p>
          )}
          {snap.log.length > 0 && (
            <div className="mt-2">
              <p className="mb-1 text-[11px] font-medium text-ink-2">{t('settings.llmUsageRecent')}</p>
              <ul className="flex flex-col gap-0.5">
                {snap.log.slice(0, 8).map((e, i) => (
                  <li key={`${e.at}-${i}`} className="flex items-baseline justify-between gap-3 text-[10px] tabular-nums text-ink-2">
                    <span className="shrink-0">{fmtTime(e.at)}</span>
                    <span className="min-w-0 flex-1 truncate">{t(FEATURE_KEY[e.feature])} · {e.model}</span>
                    <span className="shrink-0">{e.est ? '~' : ''}{fmtTokens(e.promptTokens + e.completionTokens)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-2.5 flex items-center justify-between gap-3">
            <p className="text-[11px] leading-snug text-ink-2">{t('settings.llmUsageDesc')}</p>
            <button
              onClick={onClear}
              className="shrink-0 text-xs font-medium text-accent transition-opacity hover:opacity-70"
            >
              {t(confirmClear ? 'settings.llmUsageClearConfirm' : 'settings.llmUsageClear')}
            </button>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}
