/**
 * 音高算法对比卡片（实验性）
 * 对当前记录的录音音频用 pYIN 与 MPM 重算基频，与录音时的 YIN 曲线
 * 三线叠加，附一致率 / 中位偏差统计——检验音高结果的算法敏感性。
 * 纯前端按需计算（Worker），不落库；无音频的记录显示不可用说明。
 */

import { useEffect, useRef, useState } from 'react';
import { FlaskConical, Play } from 'lucide-react';
import { toast } from 'sonner';
import { useHistoryStore } from '@/store/useHistoryStore';
import { getPitchAxis } from '@/constants';
import { drawPitchBands } from '@/components/charts/chartPainters';
import {
  recomputePitch, compareWithRecord, ALT_ALGOS,
  type AltCompareResult,
} from '@/lib/audio/pitchCompare';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import type { AnalysisRecord } from '@/types';

/** 三条曲线的固定配色（算法标识色，不随主题变化）：YIN 深灰 / pYIN 琥珀 / MPM 青碧 */
const ALGO_COLORS: Record<string, string> = {
  yin: '#8A8694',
  pyin: '#D9930D',
  mpm: '#1F9E8E',
};

export function PitchAlgorithmCard({ record }: { record: AnalysisRecord }) {
  useI18n();
  const getAudio = useHistoryStore((s) => s.getAudio);
  // 音频可用性：无音频（未保存/导入无音频）时整卡隐藏
  const [hasAudio, setHasAudio] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);
  const [pct, setPct] = useState(0);
  const [results, setResults] = useState<AltCompareResult[] | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 0, h: 0 });

  useEffect(() => {
    let alive = true;
    setResults(null);
    setHasAudio(null);
    getAudio(record.id).then((blob) => {
      if (alive) setHasAudio(blob != null);
    });
    return () => {
      alive = false;
    };
  }, [record.id, getAudio]);

  // 画布尺寸自适应
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * (window.devicePixelRatio || 1)));
      canvas.height = Math.max(1, Math.round(rect.height * (window.devicePixelRatio || 1)));
      sizeRef.current = { w: rect.width, h: rect.height };
      paint();
    });
    ro.observe(canvas);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);

  const run = async () => {
    if (running) return;
    setRunning(true);
    setPct(0);
    try {
      const audio = await getAudio(record.id);
      if (!audio) {
        setHasAudio(false);
        return;
      }
      const out: AltCompareResult[] = [];
      for (let i = 0; i < ALT_ALGOS.length; i++) {
        const algo = ALT_ALGOS[i];
        const series = await recomputePitch(audio, algo, (f) => {
          setPct((i + f) / ALT_ALGOS.length);
        });
        out.push({ algo, series, agreement: compareWithRecord(record, series) });
      }
      setResults(out);
    } catch {
      toast.error(t('ab.fail'));
    } finally {
      setRunning(false);
    }
  };

  /** 三线叠加：原始 YIN（灰）+ pYIN（琥珀）+ MPM（青碧） */
  const paint = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { w, h } = sizeRef.current;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (w < 8 || h < 8) return;

    const [fMin, fMax] = getPitchAxis();
    const yFor = (f: number) => h - ((f - fMin) / (fMax - fMin)) * h;
    const xFor = (tt: number) => (tt / Math.max(1e-6, record.durationSec)) * w;

    // 音区背景色带：直接复用音高图的画笔（含分界虚线），保证两图视觉口径一致
    drawPitchBands(ctx, w, h, fMin, fMax, yFor);

    // 横向参考网格（100/300/500 Hz）
    ctx.strokeStyle = 'rgba(128,124,140,0.35)';
    ctx.lineWidth = 1;
    ctx.font = '9px "Inter Tight", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(128,124,140,0.9)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const v of [100, 300, 500]) {
      if (v <= fMin || v >= fMax) continue;
      const y = Math.round(yFor(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.fillText(`${v}Hz`, 4, y - 5);
    }

    // 备选算法曲线（画在下层，按各自时间轴）
    const drawSeries = (ts: number[], f0: (number | null)[], color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      let open = false;
      for (let i = 0; i < ts.length; i++) {
        const f = f0[i];
        if (f == null || !isFinite(f)) {
          open = false;
          continue;
        }
        const x = xFor(ts[i]);
        const y = yFor(f);
        if (open) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        open = true;
      }
      ctx.stroke();
    };

    if (results) {
      for (const r of results) drawSeries(r.series.t, r.series.f0, ALGO_COLORS[r.algo], 1.8);
    }
    // 原始曲线（画在最上层，逐段按音区着色）
    drawSeries(record.series.t, record.series.f0, 'rgba(38,36,46,0.9)', 1.4);
  };

  if (hasAudio === null) return null; // 音频检查中
  if (!hasAudio) {
    // 无录音音频：保留卡片占位（与咝音卡一致，可在设置中关闭）
    return (
      <div className="card-surface p-4">
        <div className="mb-1.5 flex items-center gap-1.5 px-0.5">
          <FlaskConical size={13} />
          <span className="text-xs font-medium tracking-wide text-ink-2">{t('ab.title')}</span>
        </div>
        <p className="px-0.5 text-xs text-ink-2">{t('ab.needAudio')}</p>
      </div>
    );
  }

  return (
    <div className="card-surface p-4">
      <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
        <span className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-ink-2">
          <FlaskConical size={13} />
          {t('ab.title')}
        </span>
        {results && (
          <div className="flex items-center gap-3 text-[11px] text-ink-2">
            {(['yin', 'pyin', 'mpm'] as const).map((algo) => (
              <span key={algo} className="flex items-center gap-1">
                <span
                  className="inline-block size-2 rounded-full"
                  style={{ background: ALGO_COLORS[algo] }}
                />
                {algo.toUpperCase()}
              </span>
            ))}
          </div>
        )}
      </div>
      <p className="mb-3 px-0.5 text-[11px] leading-relaxed text-ink-2">{t('ab.desc')}</p>

      {results ? (
        <>
          <canvas ref={canvasRef} className="block h-[210px] w-full" aria-label={t('ab.title')} />
          <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 px-0.5 text-[11px] text-ink-2">
            {results.map((r) => (
              <span key={r.algo}>
                <span className="font-medium" style={{ color: ALGO_COLORS[r.algo] }}>
                  {r.algo.toUpperCase()}
                </span>
                {' · '}
                {t('ab.agree')} {r.agreement.agreePct}% · {t('ab.medDev')} {r.agreement.medAbsCents}¢
                <span className="ml-1 text-ink-2/60">({r.agreement.compared})</span>
              </span>
            ))}
          </div>
          <p className="mt-1 px-0.5 text-[10px] leading-relaxed text-ink-2/70">{t('ab.agreeHint')}</p>
        </>
      ) : (
        <div className="flex flex-col items-center gap-2.5 py-6">
          <button
            onClick={() => void run()}
            disabled={running}
            className="flex items-center gap-2 rounded-full bg-accent px-5 py-2 text-xs font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <Play size={13} />
            {running ? t('ab.running', { pct: Math.round(pct * 100) }) : t('ab.run')}
          </button>
          <p className="text-[10px] text-ink-2/70">{t('ab.needAudio')}</p>
        </div>
      )}

      {results && (
        <div className="mt-2.5 flex justify-end">
          <button
            onClick={() => void run()}
            disabled={running}
            className="px-1 py-1 text-xs font-medium text-accent transition-opacity hover:opacity-70 disabled:opacity-60"
          >
            {running ? t('ab.running', { pct: Math.round(pct * 100) }) : t('ab.rerun')}
          </button>
        </div>
      )}
    </div>
  );
}
