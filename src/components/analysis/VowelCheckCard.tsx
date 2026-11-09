/**
 * 长音元音检查卡
 * 长音测试录完后自动从稳态段判断最接近的普通话主元音，再与该元音的
 * 同性别参考均值比较。不需要用户预先选择；判断不确定时明确标出候选，
 * 不强行给一个元音。
 */
import { useMemo } from 'react';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { detectSustainedVowel } from '@/lib/vowelCheck';
import type { AnalysisRecord } from '@/types';

/** 三档参考位置：−1 男性均值，+1 女性均值 */
function zoneKey(position: number): 'analysis.vowelZoneMale' | 'analysis.vowelZoneMid' | 'analysis.vowelZoneFemale' {
  if (position < -0.33) return 'analysis.vowelZoneMale';
  if (position > 0.33) return 'analysis.vowelZoneFemale';
  return 'analysis.vowelZoneMid';
}

export function VowelCheckCard({ record }: { record: AnalysisRecord }) {
  useI18n();
  const result = useMemo(() => detectSustainedVowel(record.series), [record.series]);
  const { segment, best, second } = result;

  const title = (
    <h3 className="text-sm font-semibold text-ink">
      {t('analysis.vowelCheckTitle')}
      {best && (result.confidence === 'high' || result.confidence === 'medium') && (
        <span className="ml-1.5 font-mono text-accent">/{best.label}/</span>
      )}
      {best && (result.confidence === 'high' || result.confidence === 'medium') && (
        <span className="ml-1.5 text-[9px] font-normal text-ink-2">{t('analysis.vowelAuto')}</span>
      )}
    </h3>
  );

  if (!segment.enough) {
    return (
      <div className="card-surface p-4">
        {title}
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-2">
          {t('analysis.vowelInsufficient')}
        </p>
      </div>
    );
  }

  const hasMatch = result.confidence !== 'none';
  const confident = result.confidence === 'high' || result.confidence === 'medium';
  const pct = ((result.position + 1) / 2) * 100;
  const badge = confident && best
    ? `${t(zoneKey(result.position))} · ${result.position >= 0 ? '+' : ''}${result.position.toFixed(2)}`
    : result.confidence === 'low'
      ? `${t('analysis.vowelUncertain')} · ${best?.label ?? '?'} / ${second?.label ?? '?'}`
      : t('analysis.vowelNoMatchShort');
  const stats = [
    { label: t('analysis.vowelF1'), value: Math.round(segment.f1) },
    { label: t('analysis.vowelF2'), value: Math.round(segment.f2) },
    { label: t('analysis.vowelF0'), value: Math.round(segment.f0) },
  ];

  return (
    <div className="card-surface p-4">
      <div className="flex items-start justify-between gap-2">
        {title}
        <span className="mt-0.5 shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
          {badge}
        </span>
      </div>

      <p className="mt-1 text-[10px] tabular-nums text-ink-2">
        {t('analysis.vowelStable', {
          s: segment.seconds.toFixed(1),
          n: segment.frames,
        })}
      </p>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl bg-surface-hi/60 px-3 py-2">
            <p className="text-[10px] text-ink-2">{s.label}</p>
            <p className="text-sm font-semibold tabular-nums text-ink">
              {s.value}
              <span className="ml-0.5 text-[10px] font-normal text-ink-2">Hz</span>
            </p>
          </div>
        ))}
      </div>

      {confident && best && (
        <div className="mt-3">
          <div className="flex items-end justify-between text-[10px] text-ink-2">
            <span>{t('analysis.vowelMaleRef')}</span>
            <span>{t('analysis.vowelFemaleRef')}</span>
          </div>
          <div className="relative mt-1 h-1.5 rounded-full bg-line/60">
            <span
              className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_1px_4px_rgba(0,0,0,0.25)]"
              style={{ left: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {result.confidence === 'medium' && second && (
        <p className="mt-1 text-[10px] text-ink-2">
          {t('analysis.vowelSecond', { v: second.label })}
        </p>
      )}

      {result.confidence === 'low' && best && second && (
        <p className="mt-2 text-[11px] text-ink">
          {t('analysis.vowelCandidates', { a: best.label, b: second.label })}
        </p>
      )}

      {!hasMatch && best && (
        <p className="mt-2 text-[11px] leading-relaxed text-ink-2">
          {t('analysis.vowelNoMatch', { v: best.label })}
        </p>
      )}

      {hasMatch && best && (
        <p className="mt-2 text-[10px] tabular-nums text-ink-2">
          {t('analysis.vowelRefValues', {
            m1: best.male.f1,
            m2: best.male.f2,
            f1: best.female.f1,
            f2: best.female.f2,
          })}
        </p>
      )}
      {!segment.stable && (
        <p className="mt-1 text-[10px] text-accent2">{t('analysis.vowelUnstable')}</p>
      )}
      <p className="mt-1 text-[9px] leading-relaxed text-ink-2/70">
        {t('analysis.vowelRefNote')}
      </p>
    </div>
  );
}
