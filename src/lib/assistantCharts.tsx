/**
 * 助手消息内的记录图表（与分析页同一画笔）
 * 模型可在回复中用 `![说明](record://<recordId>/<kind>)` 引用某次记录的图。
 * 渲染直接复用分析页的 SeriesChart（paintChart 画笔）——像素级一致：
 * 音区背景 / 网格 / 刻度 / 靶标带 / 分段着色全部同源；
 * 并自带交互：滚轮缩放 + 拖动平移 + 双击复位（与交互式 HTML 报告同一习惯）。
 * 支持 kind：pitch / formant / energy / vowel（映射 SeriesChart 的 vowelSpace）。
 * 记录不存在或 kind 未知时显示占位说明（模型可能编造 id，不抛错）。
 * 引用语法的字符串路由见 assistantChartRoute.ts。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ImageOff, ZoomIn } from 'lucide-react';
import { t } from '@/i18n';
import { useHistoryStore } from '@/store/useHistoryStore';
import { useStore } from '@/store/useStore';
import { SeriesChart, type ChartKind } from '@/components/charts/SeriesChart';
import { TrendChart } from '@/components/charts/TrendChart';
import type { AnalysisRecord } from '@/types';
import { cn } from '@/lib/utils';
import type { ImgKind, TrendChartMetric } from './assistantChartRoute';

/** record:// kind → SeriesChart kind */
function toChartKind(k: ImgKind): ChartKind {
  return k === 'vowel' ? 'vowelSpace' : k;
}

/** 记录图表：SeriesChart + 滚轮/拖动交互（区间状态自持，双击复位） */
function InteractiveRecordChart({ rec, kind }: { rec: AnalysisRecord; kind: ImgKind }) {
  const dur = Math.max(0.001, rec.durationSec);
  const [range, setRange] = useState<[number, number]>([0, dur]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; range: [number, number] } | null>(null);

  // 记录切换（同组件实例被复用）时重置区间：渲染期派生重置，避免 effect 级联渲染。
  // 用记录 id 判断（只比 durationSec 时，等长的不同记录不会重置）
  const [loadedId, setLoadedId] = useState(rec.id);
  if (rec.id !== loadedId) {
    setLoadedId(rec.id);
    setRange([0, dur]);
  }

  const chartKind = toChartKind(kind);
  // crosshair 仅时间序列图支持（pitch/energy/formant）
  const zoomable = chartKind !== 'vowelSpace';

  const onWheel = (e: React.WheelEvent) => {
    if (!zoomable) return;
    e.preventDefault();
    const el = wrapRef.current;
    if (!el) return;
    const frac = Math.max(0, Math.min(1, (e.clientX - el.getBoundingClientRect().left) / el.clientWidth));
    const [t0, t1] = range;
    const span = t1 - t0;
    const next = Math.max(0.5, Math.min(dur, span * (e.deltaY > 0 ? 1.25 : 0.8)));
    const mid = t0 + span * frac;
    setRange([Math.max(0, Math.min(dur - next, mid - frac * next)), Math.min(dur, mid - frac * next + next)]);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!zoomable) return;
    dragRef.current = { x: e.clientX, range };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const el = wrapRef.current;
    if (!el) return;
    const dx = ((e.clientX - drag.x) / el.clientWidth) * (drag.range[1] - drag.range[0]);
    const span = drag.range[1] - drag.range[0];
    const t0 = Math.max(0, Math.min(dur - span, drag.range[0] - dx));
    setRange([t0, t0 + span]);
  };
  const endDrag = () => { dragRef.current = null; };

  const isZoomed = range[0] > 0.01 || range[1] < dur - 0.01;

  return (
    <div className="my-1">
      <div
        ref={wrapRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => setRange([0, dur])}
        className={cn('relative h-36', zoomable && 'cursor-grab touch-pan-y select-none active:cursor-grabbing')}
      >
        <SeriesChart
          kind={chartKind}
          series={rec.series}
          range={range}
          ariaLabel={t(`assistant.chart.${kind}`)}
        />
      </div>
      <p className="mt-0.5 flex items-center gap-1 text-[10px] text-ink-2">
        {zoomable && <ZoomIn size={10} className="shrink-0" />}
        <span className="truncate">
          {t(`assistant.chart.${kind}`)}
          {zoomable && isZoomed && ` · ${t('assistant.chartZoomed')}`}
        </span>
      </p>
    </div>
  );
}

/** 单个 record:// 引用的解析与渲染 */
function RecordImage({ recordId, kind, alt }: { recordId: string; kind: ImgKind; alt: string }) {
  const [rec, setRec] = useState<AnalysisRecord | null | 'loading'>('loading');
  useEffect(() => {
    let alive = true;
    void (async () => {
      const store = useHistoryStore.getState();
      if (!store.ready) await store.hydrate();
      const all = await store.getAllRecords();
      const hit = all.find((r) => r.id === recordId) ?? null;
      if (alive) setRec(hit);
    })();
    return () => { alive = false; };
  }, [recordId]);

  if (rec === 'loading') {
    return <span className="my-3 block h-20 animate-pulse rounded-2xl bg-card" aria-label={alt} />;
  }
  if (rec == null) {
    return (
      <span className="my-3 flex items-center gap-1.5 rounded-2xl bg-card px-3 py-2 text-[10px] text-ink-2">
        <ImageOff size={11} />
        {t('assistant.chartMissing')}
      </span>
    );
  }
  const date = new Date(rec.createdAt);
  return (
    <figure
      className="my-3 block rounded-2xl bg-card p-3 text-left shadow-[0_2px_10px_rgba(28,25,45,0.05)]"
      onClick={(e) => e.stopPropagation()}
    >
      <InteractiveRecordChart rec={rec} kind={kind} />
      <figcaption className="mt-1 px-0.5 text-[10px] text-ink-2">
        {alt || t(`mode.${rec.mode ?? 'reading'}`)} · {date.getMonth() + 1}/{date.getDate()}
      </figcaption>
    </figure>
  );
}

export { RecordImage };

/** 趋势图：复用历史页 TrendChart，限制为最近 lastN 条 */
export function TrendImage({
  metric,
  lastN,
  alt,
}: {
  metric: TrendChartMetric;
  lastN: number;
  alt: string;
}) {
  const records = useHistoryStore((s) => s.records);
  const setCurrentAnalysis = useStore((s) => s.setCurrentAnalysis);
  const setTab = useStore((s) => s.setTab);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const store = useHistoryStore.getState();
      if (!store.ready) await store.hydrate();
      if (alive) setReady(true);
    })();
    return () => { alive = false; };
  }, []);

  const shown = useMemo(
    () => [...records].sort((a, b) => a.createdAt - b.createdAt).slice(-lastN),
    [records, lastN],
  );

  if (!ready && shown.length === 0) {
    return <span className="my-3 block h-20 animate-pulse rounded-2xl bg-card" aria-label={alt} />;
  }
  if (shown.length === 0) {
    return (
      <span className="my-3 flex items-center gap-1.5 rounded-2xl bg-card px-3 py-2 text-[10px] text-ink-2">
        <ImageOff size={11} />
        {t('assistant.chartMissing')}
      </span>
    );
  }

  return (
    <figure
      className="my-3 block rounded-2xl bg-card p-3 text-left shadow-[0_2px_10px_rgba(28,25,45,0.05)]"
      onClick={(e) => e.stopPropagation()}
    >
      <TrendChart
        records={shown}
        metric={metric}
        connectLine={false}
        onOpen={(record) => {
          setCurrentAnalysis(record);
          setTab('analysis');
        }}
      />
      <figcaption className="mt-1 px-0.5 text-[10px] text-ink-2">
        {alt || t('assistant.chartTrend')} · {shown.length} 条
      </figcaption>
    </figure>
  );
}

/** 两条记录并排对比：复用 RecordImage，避免再写一套画笔 */
export function CompareImage({
  a,
  b,
  kind,
  alt,
}: {
  a: string;
  b: string;
  kind: ImgKind;
  alt: string;
}) {
  return (
    <figure
      className="my-3 block rounded-2xl bg-card p-3 text-left shadow-[0_2px_10px_rgba(28,25,45,0.05)]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="min-w-0">
          <span className="mb-1 inline-flex rounded bg-surface-hi px-1.5 py-0.5 text-[9px] text-ink-2">A</span>
          <RecordImage recordId={a} kind={kind} alt={`A · ${alt}`} />
        </div>
        <div className="min-w-0">
          <span className="mb-1 inline-flex rounded bg-surface-hi px-1.5 py-0.5 text-[9px] text-ink-2">B</span>
          <RecordImage recordId={b} kind={kind} alt={`B · ${alt}`} />
        </div>
      </div>
      <figcaption className="mt-1 px-0.5 text-[10px] text-ink-2">{alt || t('assistant.chartCompare')}</figcaption>
    </figure>
  );
}

