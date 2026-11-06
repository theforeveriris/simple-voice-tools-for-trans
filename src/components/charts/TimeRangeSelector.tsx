/**
 * 时间轴区间选择器
 * 分析页每个图表下方的双滑块控件：
 * 背景以能量密度条预览整段录音，拖动滑块选择图表显示的时间区间，
 * 在选中窗口中间按住拖动可整体平移，双击重置为全段。
 * 造型极简：细轨、细滑块、无内嵌文字。
 */

import { useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { RecordSeries } from '@/types';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';

interface TimeRangeSelectorProps {
  series: RecordSeries;
  /** 时间轴总长（秒） */
  total: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
  className?: string;
}

const MIN_SPAN = 0.4; // 最小选择跨度（秒）
const HANDLE_EDGE = 0.8; // 滑块命中范围（秒），靠近端点视为拖端点
const BUCKETS = 90;

export function TimeRangeSelector({ series, total, value, onChange, className }: TimeRangeSelectorProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: 0 | 1 | 'pan'; grabT: number; grabValue: [number, number] } | null>(null);
  const [dragging, setDragging] = useState<0 | 1 | 'pan' | null>(null);

  // 能量密度预览条：把 rmsDb 分桶取峰值，映射到条高
  const bars = useMemo(() => {
    const out = new Array<number>(BUCKETS).fill(-90);
    for (let i = 0; i < series.t.length; i++) {
      const b = Math.min(BUCKETS - 1, Math.floor((series.t[i] / Math.max(total, 0.01)) * BUCKETS));
      out[b] = Math.max(out[b], series.rmsDb[i]);
    }
    return out.map((db) => {
      const norm = Math.max(0, Math.min(1, (db + 90) / 85));
      return 0.08 + norm * 0.92;
    });
  }, [series, total]);

  const pct = (t: number) => `${Math.max(0, Math.min(100, (t / Math.max(total, 0.01)) * 100))}%`;

  const posToT = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    const p = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return p * total;
  };

  const applyDrag = (handle: 0 | 1, t: number) => {
    if (handle === 0) {
      onChange([Math.max(0, Math.min(t, value[1] - MIN_SPAN)), value[1]]);
    } else {
      onChange([value[0], Math.min(total, Math.max(t, value[0] + MIN_SPAN))]);
    }
  };

  /** 整体平移选中窗口（保持跨度不变） */
  const applyPan = (grabT: number, grabValue: [number, number], t: number) => {
    const span = grabValue[1] - grabValue[0];
    let t0 = grabValue[0] + (t - grabT);
    t0 = Math.max(0, Math.min(total - span, t0));
    onChange([t0, t0 + span]);
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    const t = posToT(e.clientX);
    const nearStart = Math.abs(t - value[0]) <= HANDLE_EDGE && Math.abs(t - value[0]) <= Math.abs(t - value[1]);
    const nearEnd = !nearStart && Math.abs(t - value[1]) <= HANDLE_EDGE;
    if (nearStart) {
      dragRef.current = { mode: 0, grabT: t, grabValue: value };
      setDragging(0);
      applyDrag(0, t);
    } else if (nearEnd) {
      dragRef.current = { mode: 1, grabT: t, grabValue: value };
      setDragging(1);
      applyDrag(1, t);
    } else if (t > value[0] && t < value[1]) {
      // 窗口内部按住 → 整体平移
      dragRef.current = { mode: 'pan', grabT: t, grabValue: value };
      setDragging('pan');
    } else {
      // 点击窗口外空白 → 就近端点跳转
      const handle: 0 | 1 = Math.abs(t - value[0]) <= Math.abs(t - value[1]) ? 0 : 1;
      dragRef.current = { mode: handle, grabT: t, grabValue: value };
      setDragging(handle);
      applyDrag(handle, t);
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const t = posToT(e.clientX);
    if (drag.mode === 'pan') applyPan(drag.grabT, drag.grabValue, t);
    else applyDrag(drag.mode, t);
  };

  const endDrag = () => {
    dragRef.current = null;
    setDragging(null);
  };

  const onDoubleClick = () => onChange([0, total]);

  const isPartial = value[0] > 0.001 || value[1] < total - 0.001;

  return (
    <div className={cn('select-none', className)}>
      <div
        ref={trackRef}
        className={cn(
          'relative h-6 touch-none overflow-hidden bg-surface-hi',
          dragging === 'pan' ? 'cursor-grabbing' : 'cursor-ew-resize',
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={onDoubleClick}
      >
        {/* 能量密度预览 */}
        <div className="absolute inset-0 flex items-end gap-px px-px pb-px">
          {bars.map((h, i) => (
            <div
              key={i}
              className="flex-1 bg-ink/10"
              style={{ height: `${h * 100}%` }}
            />
          ))}
        </div>

        {/* 选中窗口 */}
        <div
          className={cn(
            'pointer-events-none absolute inset-y-0 border-x border-accent/70 bg-accent/10',
            dragging === 'pan' && 'cursor-grabbing',
          )}
          style={{ left: pct(value[0]), width: `${(Math.min(100, ((value[1] - value[0]) / Math.max(total, 0.01)) * 100))}%` }}
        />

        {/* 两个细滑块 */}
        {([0, 1] as const).map((handle) => (
          <div
            key={handle}
            className={cn(
              'pointer-events-none absolute inset-y-0 w-1 -translate-x-1/2 bg-accent transition-transform',
              dragging === handle ? 'scale-x-150' : '',
            )}
            style={{ left: pct(value[handle]) }}
          />
        ))}
      </div>
      {isPartial && (
        <div className="mt-1 flex items-center justify-center text-[10px] tabular-nums">
          <button onClick={() => onChange([0, total])} className="font-medium text-accent transition-opacity hover:opacity-70">
            {t('common.reset')}
          </button>
        </div>
      )}
    </div>
  );
}
