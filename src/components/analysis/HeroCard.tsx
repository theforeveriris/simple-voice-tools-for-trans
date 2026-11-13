/**
 * 声纹概览卡
 * 平均基频（音名 / 音分偏差 / 录音时间 / 区间与模式徽标）
 * + 音域标尺（男/女声区色带上的 P10–P90 括条与平均基频游标）
 * + 时长 / F1 / F2 / 响度四项统计。
 */

import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { MOTION } from '@/lib/motion';
import { Music2, Sparkles } from 'lucide-react';
import { freqToNote, bandOf, BAND_COLORS, getBandRanges } from '@/constants';
import { formatClock } from '@/lib/utils';
import { localeTag, t } from '@/i18n';
import type { AnalysisRecord } from '@/types';

/* ------------------------------- 音域标尺 ------------------------------- */

/** 对数刻度：60–520Hz 映射到 0–100% */
const RULER_MIN = 60;
const RULER_MAX = 520;
const posPct = (f: number) => ((Math.log(f / RULER_MIN) / Math.log(RULER_MAX / RULER_MIN)) * 100).toFixed(2);

/**
 * 音域标尺：在男/女声区色带上标出当前区间的
 * P10–P90 音域范围（圆角括条）与平均基频位置（游标）
 */
function RangeRuler({ record }: { record: AnalysisRecord }) {
  const { avgF0, p10F0, p90F0 } = record.stats;
  const band = bandOf(avgF0);
  // 色带分段跟随自定义音区边界（与曲线着色、占比统计同一来源）
  const ranges = getBandRanges();
  const seg = (a: number, b: number) => `${Number(posPct(b)) - Number(posPct(a))}%`;
  return (
    <div className="w-full">
      <div className="relative h-3.5 w-full overflow-hidden rounded-full">
        <div className="absolute inset-0 flex">
          <span className="h-full" style={{ width: `${posPct(ranges.male[0])}%`, background: `${BAND_COLORS.low}30` }} />
          <span className="h-full" style={{ width: seg(ranges.male[0], ranges.transition[0]), background: `${BAND_COLORS.male}45` }} />
          <span className="h-full" style={{ width: seg(ranges.transition[0], ranges.female[0]), background: `${BAND_COLORS.transition}26` }} />
          <span className="h-full" style={{ width: seg(ranges.female[0], ranges.female[1]), background: `${BAND_COLORS.female}45` }} />
          <span className="h-full flex-1" style={{ background: `${BAND_COLORS.high}30` }} />
        </div>
        {/* P10–P90 音域括条（颜色取自主题变量，深浅模式均可见） */}
        <div
          className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full border-2 shadow transition-all duration-700"
          style={{
            left: `${posPct(Math.max(RULER_MIN, p10F0))}%`,
            width: `${Number(posPct(Math.min(RULER_MAX, p90F0))) - Number(posPct(Math.max(RULER_MIN, p10F0)))}%`,
            background: 'rgb(var(--c-ink-rgb) / 0.28)',
            borderColor: 'rgb(var(--c-card-rgb) / 0.9)',
          }}
        />
        {/* 平均基频游标 */}
        <div
          className="absolute top-1/2 z-10 h-5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink shadow ring-2 transition-all duration-700"
          style={{ left: `${posPct(Math.min(RULER_MAX, Math.max(RULER_MIN, avgF0)))}%`, ['--tw-ring-color' as string]: 'rgb(var(--c-card-rgb))' }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
        <span className="text-ink-2">{t('analysis.rangeP10P90', { a: p10F0.toFixed(0), b: p90F0.toFixed(0) })}</span>
        <span className="flex items-center gap-2 text-ink-2">
          <span className="tabular-nums">
            {new Date(record.createdAt).toLocaleString(localeTag(), { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </span>
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-ink">
            <span className="size-1.5 rounded-full" style={{ background: BAND_COLORS[band] }} />
            {t(`band.${band}`)}
          </span>
        </span>
      </div>
    </div>
  );
}

/* ------------------------------- 声纹概览卡 ------------------------------- */

function StatChip({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] text-ink-2">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}

export function HeroSummary({
  record,
  range,
  actions,
}: {
  record: AnalysisRecord;
  range: [number, number];
  actions?: ReactNode;
}) {
  const { avgF0 } = record.stats;
  const note = freqToNote(avgF0);
  const isPartial = range[0] > 0.001 || range[1] < record.durationSec - 0.001;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={MOTION.emphasis}
      className="card-surface p-5"
    >
      {/* 标签行：平均基频；区间/模式徽标桌面端同行、移动端换行；右侧为操作按钮 */}
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-ink-2">
          <Sparkles size={12} className="shrink-0 text-accent" />
          {t('analysis.avgF0')}
        </p>
        <div className="order-3 mt-1.5 flex w-full flex-wrap items-center gap-1.5 sm:order-none sm:mt-0 sm:w-auto">
          <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-on-accent-soft">
            {isPartial ? t('analysis.chipRange', { a: formatClock(range[0]), b: formatClock(range[1]) }) : t('analysis.chipFull')}
          </span>
          {record.mode && (
            <span className="flex items-center gap-1 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-on-accent-soft">
              <Music2 size={9} />
              {t(`mode.${record.mode}`)}
            </span>
          )}
        </div>
        {actions && <div className="ml-auto flex shrink-0 items-center gap-0.5">{actions}</div>}
      </div>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="min-w-40">
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-semibold tracking-tight tabular-nums text-ink">
              {avgF0.toFixed(1)}
            </span>
            <span className="text-sm text-ink-2">Hz</span>
            <span className="text-sm font-semibold text-accent">{note.name}</span>
          </div>
        </div>
        <div className="min-w-[280px] flex-1 lg:max-w-md">
          <RangeRuler record={record} />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <StatChip label={t('analysis.statDuration')} value={`${record.stats.durationSec.toFixed(1)} ${t('analysis.unitSec')}`} />
        <StatChip label={t('analysis.statF1')} value={record.stats.avgF1 != null ? `${record.stats.avgF1.toFixed(0)} Hz` : '—'} />
        <StatChip label={t('analysis.statF2')} value={record.stats.avgF2 != null ? `${record.stats.avgF2.toFixed(0)} Hz` : '—'} />
        <StatChip label={t('analysis.statDb')} value={`${record.stats.avgDb.toFixed(1)} dB`} />
      </div>
      {/* 环境元数据（自动标注，有才显示）：底噪 / 麦克风 / 时段 */}
      {record.env && (record.env.noiseFloorDb != null || record.env.micLabel || record.env.hourOfDay != null) && (
        <p className="mt-2.5 flex flex-wrap gap-x-3 gap-y-0.5 px-0.5 text-[10px] tabular-nums text-ink-2">
          {record.env.noiseFloorDb != null && (
            <span>{t('analysis.envNoise')} {record.env.noiseFloorDb.toFixed(1)} dB</span>
          )}
          {record.env.micLabel && <span className="truncate">{t('analysis.envMic')} {record.env.micLabel}</span>}
          {record.env.hourOfDay != null && (
            <span>{t('analysis.envHour')} {String(record.env.hourOfDay).padStart(2, '0')}:00</span>
          )}
          {record.env.inputGainDb != null && (
            <span>{t('analysis.envGain')} +{record.env.inputGainDb} dB</span>
          )}
        </p>
      )}
    </motion.div>
  );
}
