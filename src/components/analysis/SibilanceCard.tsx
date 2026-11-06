/**
 * 咝音分析卡（实验性）
 * 从录音音频重新计算高频谱，挑选咝音帧输出频谱重心统计，
 * 按训练方向（userGoal）定位参考区间——/s/ 位置的量化反馈。
 * 无录音音频的记录显示不可用提示（与嗓音质量四项同口径）。
 */

import { useEffect, useState } from 'react';
import { Waves } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { useHistoryStore } from '@/store/useHistoryStore';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { analyzeSibilanceAudio, type SibilanceStats } from '@/lib/audio/sibilance';
import type { AnalysisRecord } from '@/types';
import { InfoTip } from '../settings/InfoTip';

export function SibilanceCard({ record }: { record: AnalysisRecord }) {
  useI18n();
  const goal = useStore((s) => s.settings.userGoal);
  const [stats, setStats] = useState<SibilanceStats | null | 'unavailable'>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const audio = await useHistoryStore.getState().getAudio(record.id);
      if (!alive) return;
      if (!audio) {
        setStats('unavailable');
        return;
      }
      try {
        const s = await analyzeSibilanceAudio(audio, goal);
        if (alive) setStats(s ?? 'unavailable');
      } catch {
        if (alive) setStats(null);
      }
    })();
    return () => { alive = false; };
  }, [record.id, goal]);

  const refLabel = stats && stats !== 'unavailable' && stats.refRange
    ? `${(stats.refRange[0] / 1000).toFixed(1)}–${(stats.refRange[1] / 1000).toFixed(1)}kHz`
    : null;

  return (
    <div className="card-surface p-4">
      <div className="mb-2.5 flex items-center gap-1.5 px-0.5">
        <Waves size={13} className="text-accent" />
        <span className="text-xs font-semibold text-ink">{t('sibilance.title')}</span>
        <InfoTip label="" text={`${t('sibilance.explain')}\n${t('sibilance.needAudio')}`} />
      </div>
      {stats === 'unavailable' ? (
        <p className="px-0.5 text-xs text-ink-2">{t('sibilance.needAudio')}</p>
      ) : stats == null ? (
        <p className="px-0.5 text-xs text-ink-2">{t('sibilance.analyzing')}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex items-center gap-3 rounded-2xl bg-surface-hi/60 px-4 py-3">
              <div>
                <p className="text-[11px] text-ink-2">{t('sibilance.centroid')}</p>
                <p className="text-lg font-semibold tabular-nums text-ink">
                  {stats.centroidHz >= 1000
                    ? t('sibilance.khz', { n: (stats.centroidHz / 1000).toFixed(2) })
                    : t('sibilance.hz', { n: Math.round(stats.centroidHz) })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-2xl bg-surface-hi/60 px-4 py-3">
              <div>
                <p className="text-[11px] text-ink-2">{t('sibilance.range')}</p>
                <p className="text-sm font-semibold tabular-nums text-ink">
                  {(stats.p10Hz / 1000).toFixed(1)}–{(stats.p90Hz / 1000).toFixed(1)}kHz
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-2xl bg-surface-hi/60 px-4 py-3">
              <div>
                <p className="text-[11px] text-ink-2">
                  {refLabel ? t('sibilance.ref', { range: refLabel }) : t('sibilance.refNone')}
                </p>
                <p className="text-sm font-semibold tabular-nums text-ink">
                  {stats.refPos != null
                    ? `${Math.round(Math.max(0, Math.min(1, stats.refPos)) * 100)}%`
                    : t('sibilance.frames', { n: stats.frames })}
                </p>
              </div>
            </div>
          </div>
          {/* 参考区间标尺 */}
          {stats.refPos != null && (
            <div className="mt-3 px-1">
              <div className="relative h-2 rounded-full bg-surface-hi">
                <div
                  className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-accent"
                  style={{ left: `${Math.max(2, Math.min(98, stats.refPos * 100))}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[10px] tabular-nums text-ink-2">
                <span>{(stats.refRange![0] / 1000).toFixed(1)}kHz</span>
                <span>{(stats.refRange![1] / 1000).toFixed(1)}kHz</span>
              </div>
            </div>
          )}
          <p className="mt-2 text-[10px] leading-relaxed text-ink-2">{t('sibilance.explain')}</p>
        </>
      )}
    </div>
  );
}
