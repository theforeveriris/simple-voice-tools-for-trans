/**
 * 统计表格
 * 音高 / 共振峰 / 能量 / 嗓音质量四组指标，跟随当前查看区间
 */

import type { ReactNode } from 'react';
import { freqToNote } from '@/constants';
import { t } from '@/i18n';
import { useStore } from '@/store/useStore';
import type { AnalysisRecord } from '@/types';

/* -------------------------------- 统计表格 -------------------------------- */

function StatGroup({ title, rows }: { title: string; rows: [string, ReactNode][] }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold text-ink">{title}</p>
      <table className="w-full">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-t border-black/[0.04] first:border-t-0">
              <td className="py-1.5 pr-2 text-[11px] text-ink-2">{label}</td>
              <td className="py-1.5 text-right text-xs font-medium tabular-nums text-ink">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fmtHz(v: number | null | undefined, digits = 1): string {
  return v != null ? `${v.toFixed(digits)} Hz` : '—';
}

export function StatsTable({ record }: { record: AnalysisRecord }) {
  const s = record.stats;
  const splOffset = useStore((st) => st.settings.splOffsetDb);
  // SPL 校准后：录音电平(dBFS) + 偏移 → 真实声压级；未校准只显示 dBFS
  const dbLabel = (db: number) => (splOffset != null ? `${db.toFixed(1)} dB（≈ ${(db + splOffset).toFixed(0)} dB SPL）` : `${db.toFixed(1)} dB`);
  const voicedPct = s.totalSamples ? Math.round((s.voicedSamples / s.totalSamples) * 100) : 0;
  // 谱类指标（H1−H2 / H2−H4 / H1−A3 / 气声度 / 鼻化）需要完整录音音频离线计算；
  // 旧记录或未保存音频时为 null，这里给出可操作的说明（有音频时重算可补齐）
  const vqMissing = s.jitterPct == null && s.hnrDb == null && s.cppsDb == null;
  const spectralMissing = s.h1h2Db == null || s.h2h4Db == null || s.h1a3Db == null
    || s.breathiness == null || s.nasalityDb == null;
  const vqHint = vqMissing || spectralMissing ? t('analysis.vqHintMissing') : t('analysis.vqHint');
  return (
    <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatGroup
        title={t('analysis.groupPitch')}
        rows={[
          [t('analysis.rowAvgF0'), `${s.avgF0.toFixed(1)} Hz（${freqToNote(s.avgF0).name}）`],
          [t('analysis.rowMedianF0'), fmtHz(s.medianF0)],
          [t('analysis.rowMinMaxF0'), `${s.minF0.toFixed(0)} / ${s.maxF0.toFixed(0)} Hz`],
          [t('analysis.rowP10P90'), `${s.p10F0.toFixed(0)} / ${s.p90F0.toFixed(0)} Hz`],
          [t('analysis.rowStdF0'), `${s.stdF0.toFixed(1)} Hz`],
          [t('analysis.rowMalePct'), `${s.malePct}%`],
          [t('analysis.rowFemalePct'), `${s.femalePct}%`],
          [t('analysis.rowTransPct'), `${s.transitionPct}%`],
          ...(s.inTargetPct != null
            ? ([[t('analysis.rowTargetPct'), `${s.inTargetPct}%`]] as [string, ReactNode][])
            : []),
        ]}
      />
      <StatGroup
        title={t('analysis.groupFormant')}
        rows={[
          [t('analysis.rowAvgF1'), fmtHz(s.avgF1, 0)],
          [t('analysis.rowF1Range'), s.f1Range ? `${s.f1Range[0].toFixed(0)} – ${s.f1Range[1].toFixed(0)} Hz` : '—'],
          [t('analysis.rowAvgF2'), fmtHz(s.avgF2, 0)],
          [t('analysis.rowF2Range'), s.f2Range ? `${s.f2Range[0].toFixed(0)} – ${s.f2Range[1].toFixed(0)} Hz` : '—'],
          [t('analysis.rowF1F2Ratio'), s.avgF1 && s.avgF2 ? (s.avgF2 / s.avgF1).toFixed(2) : '—'],
          // 共鸣感知指标（旧记录无此字段显示 —；用「重新分析」可补算）
          ...(s.f2f1GapHz != null
            ? ([[t('analysis.rowF2f1Gap'), `${s.f2f1GapHz.toFixed(0)} Hz（中位 ${s.f2f1GapMedianHz?.toFixed(0) ?? '—'}）`]] as [string, ReactNode][])
            : []),
          ...(s.spectralTiltDbOct != null
            ? ([[t('analysis.rowSpectralTilt'), `${s.spectralTiltDbOct.toFixed(1)} dB/oct`]] as [string, ReactNode][])
            : []),
        ]}
      />
      <StatGroup
        title={t('analysis.groupEnergy')}
        rows={[
          [t('analysis.rowDuration'), `${s.durationSec.toFixed(1)} ${t('analysis.unitSec')}`],
          [t('analysis.rowVoicedPct'), `${voicedPct}%`],
          [t('analysis.rowAvgDb'), dbLabel(s.avgDb)],
          [t('analysis.rowPeakDb'), dbLabel(s.peakDb)],
          [t('analysis.rowFrames'), `${s.totalSamples}（${s.sampleHz.toFixed(0)} Hz）`],
        ]}
      />
      <StatGroup
        title={t('analysis.groupVq')}
        rows={[
          [t('analysis.rowJitter'), s.jitterPct != null ? `${s.jitterPct.toFixed(2)} %` : '—'],
          [t('analysis.rowShimmer'), s.shimmerPct != null ? `${s.shimmerPct.toFixed(2)} %` : '—'],
          [t('analysis.rowHnr'), s.hnrDb != null ? `${s.hnrDb.toFixed(1)} dB` : '—'],
          [t('analysis.rowCpps'), s.cppsDb != null ? `${s.cppsDb.toFixed(1)} dB` : '—'],
          [t('analysis.rowH1H2'), s.h1h2Db != null ? `${s.h1h2Db.toFixed(1)} dB` : '—'],
          [t('analysis.rowH2H4'), s.h2h4Db != null ? `${s.h2h4Db.toFixed(1)} dB` : '—'],
          [t('analysis.rowH1A3'), s.h1a3Db != null ? `${s.h1a3Db.toFixed(1)} dB` : '—'],
          [t('analysis.rowBreathiness'), s.breathiness != null ? `${(s.breathiness * 100).toFixed(0)} %` : '—'],
          [t('analysis.rowNasality'), s.nasalityDb != null ? `${s.nasalityDb.toFixed(1)} dB` : '—'],
          [t('analysis.rowNote'), <span key="hint" className="text-[10px] font-normal text-ink-2">{vqHint}</span>],
        ]}
      />
    </div>
  );
}
