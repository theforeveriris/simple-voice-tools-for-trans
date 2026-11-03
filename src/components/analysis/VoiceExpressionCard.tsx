/**
 * 声音性别表达参考卡（VFP 风格）
 *
 * 把中位基频与 F2−F1 共鸣间距合成一个 0–100 的连续参考分：
 * 越高越靠近女性化参考，越低越靠近男性化参考，50 附近为中性。
 * 概念取自 inaSpeechSegmenter 的 VFP（Interspeech 2023），但本项目只做
 * 透明的声学近似，不打包其 CNN；卡片文案与文档均明确这一点。
 *
 * 评分实现见 src/lib/voiceExpression.ts（纯函数、可单测）。
 */

import { Scale } from 'lucide-react';
import { BAND_COLORS } from '@/constants';
import { t, type DictKey } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { computeVoiceExpression, type VoiceExpressionZone } from '@/lib/voiceExpression';
import type { AnalysisRecord } from '@/types';
import { InfoTip } from '../settings/InfoTip';

/** 标记色：中性用中灰（BAND_COLORS.transition 近黑，深色主题下会与卡片融在一起） */
const ZONE_DOT: Record<VoiceExpressionZone, string> = {
  masculine: BAND_COLORS.male,
  neutral: '#8A8794',
  feminine: BAND_COLORS.female,
};

const ZONE_LABEL_KEY: Record<VoiceExpressionZone, DictKey> = {
  masculine: 'analysis.expressionZoneMasculine',
  neutral: 'analysis.expressionZoneNeutral',
  feminine: 'analysis.expressionZoneFeminine',
};

const REFERENCE_ROWS: [VoiceExpressionZone, DictKey][] = [
  ['masculine', 'analysis.expressionMasculineRef'],
  ['neutral', 'analysis.expressionNeutralRef'],
  ['feminine', 'analysis.expressionFeminineRef'],
];

export function VoiceExpressionCard({ record }: { record: AnalysisRecord }) {
  useI18n();
  const { stats } = record;
  const result = computeVoiceExpression({
    medianF0: stats.medianF0,
    f2f1GapHz: stats.f2f1GapHz,
    avgF2: stats.avgF2,
    voicedSamples: stats.voicedSamples,
    sampleHz: stats.sampleHz,
  });
  if (!result) return null;

  const zoneLabel = t(ZONE_LABEL_KEY[result.zone]);
  // 短样本保留一位小数，避免 <0.5 秒时显示成「0 秒」
  const voicedLabel = result.voicedSeconds >= 10
    ? result.voicedSeconds.toFixed(0)
    : result.voicedSeconds.toFixed(1);
  const resonanceDetail = result.resonanceBasis === 'gap'
    ? t('analysis.expressionGapValue', { n: Math.round(stats.f2f1GapHz ?? 0) })
    : result.resonanceBasis === 'f2'
      ? t('analysis.expressionF2Value', { n: Math.round(stats.avgF2 ?? 0) })
      : null;

  return (
    <div className="card-surface p-4">
      <div className="mb-2 flex items-center gap-1.5 px-0.5">
        <Scale size={13} className="text-accent" />
        <span className="text-xs font-semibold text-ink">{t('analysis.expressionTitle')}</span>
        <InfoTip label="" text={t('analysis.expressionTip')} />
        <span className="ml-auto rounded-full bg-surface-hi px-2 py-0.5 text-[10px] font-medium text-ink-2">
          {zoneLabel}
        </span>
      </div>

      <p className="px-0.5 text-[10px] text-ink-2">{t('analysis.expressionScore')}</p>
      <div className="flex items-end gap-1.5 px-0.5">
        <span className="text-3xl font-semibold leading-none tabular-nums text-ink">{result.score}</span>
        <span className="pb-0.5 text-[11px] text-ink-2">/ 100</span>
      </div>

      {/* 双极标尺：左男右女，刻度在 33 / 67（与三档边界一致） */}
      <div
        className="mt-3"
        role="img"
        aria-label={`${t('analysis.expressionScore')} ${result.score}/100 — ${zoneLabel}`}
      >
        <div className="relative h-2.5">
          <div
            className="absolute inset-0 overflow-hidden rounded-full"
            style={{
              background: `linear-gradient(90deg, ${BAND_COLORS.male}66 0%, ${BAND_COLORS.transition}33 50%, ${BAND_COLORS.female}66 100%)`,
            }}
          >
            <span className="absolute inset-y-0 left-1/3 w-px bg-white/60" />
            <span className="absolute inset-y-0 left-2/3 w-px bg-white/60" />
          </div>
          <span
            className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/80 shadow-sm"
            style={{ left: `${result.score}%`, background: ZONE_DOT[result.zone] }}
          />
        </div>
        <div className="mt-1 grid grid-cols-3 text-[10px] text-ink-2">
          <span>{t('analysis.expressionZoneMasculine')}</span>
          <span className="text-center">{t('analysis.expressionZoneNeutral')}</span>
          <span className="text-right">{t('analysis.expressionZoneFeminine')}</span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-2xl bg-surface-hi/60 px-3 py-2">
          <p className="text-[10px] text-ink-2">{t('analysis.expressionPitch')}</p>
          <p className="text-sm font-semibold tabular-nums text-ink">{result.pitchScore}</p>
          <p className="tabular-nums text-[10px] text-ink-2">{Math.round(stats.medianF0)} Hz</p>
        </div>
        <div className="rounded-2xl bg-surface-hi/60 px-3 py-2">
          <p className="text-[10px] text-ink-2">{t('analysis.expressionResonance')}</p>
          <p className="text-sm font-semibold tabular-nums text-ink">{result.resonanceScore ?? '—'}</p>
          <p className="truncate text-[10px] text-ink-2">
            {resonanceDetail ?? t('analysis.expressionNoResonance')}
          </p>
        </div>
        <div className="rounded-2xl bg-surface-hi/60 px-3 py-2">
          <p className="text-[10px] text-ink-2">{t('analysis.expressionSamples')}</p>
          <p className="text-sm font-semibold tabular-nums text-ink">{voicedLabel} s</p>
          <p className="text-[10px] text-ink-2">{t('analysis.expressionVoiced')}</p>
        </div>
      </div>

      {result.confidence !== 'high' && (
        <p className="mt-2 px-0.5 text-[10px] leading-relaxed text-[#B0532F]">
          {t('analysis.expressionSampleShort', { n: voicedLabel })}
        </p>
      )}
      {record.mode !== 'reading' && (
        <p className="mt-2 px-0.5 text-[10px] leading-relaxed text-ink-2">
          {t('analysis.expressionModeNote')}
        </p>
      )}

      <div className="mt-3 space-y-1 border-t border-black/[0.04] pt-2.5">
        {REFERENCE_ROWS.map(([zone, key]) => (
          <div key={zone} className="flex items-start gap-2 text-[10px] leading-relaxed text-ink-2">
            <span
              className="mt-[3px] size-1.5 shrink-0 rounded-full"
              style={{ background: ZONE_DOT[zone] }}
            />
            <span>{t(key)}</span>
          </div>
        ))}
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-ink-2/80">{t('analysis.expressionNote')}</p>
    </div>
  );
}
