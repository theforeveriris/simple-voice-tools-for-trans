/**
 * 花园视图（历史页第三视图）——虚拟化版本
 * 按月分节的虚拟滚动列表：只渲染视口 ± 缓冲内的花，窗口外用占位高度，
 * 记录数增长到几千条时渲染量恒定（总 DOM 节点 ≈ 视口行数 × 每行数）。
 * 每行花数严格跟随设置（2–5），移动端与桌面端一致；行高按容器宽度收缩，
 * 避免窄屏多列时花朵溢出单元格。
 * flowerOf 映射结果经 useMemo 缓存，滚动与重渲染不重复计算。
 * 点花弹详情：大花 + 映射依据标注 + 跳转分析页。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MOTION } from '@/lib/motion';
import { X, BarChart3 } from 'lucide-react';
import { flowerOf, rotationJitter, flowerSideStats, _internal, type Flower } from '@/lib/flower';
import { applyLuaFlowers, computeLuaFlowers } from '@/lib/lua/flower';
import { FlowerSvg } from '@/components/flowers/FlowerSvg';
import { useStore } from '@/store/useStore';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import type { AnalysisRecord, TestMode } from '@/types';
import { cn } from '@/lib/utils';

/** 花坛过滤（与趋势视图同款模式集） */
const GARDEN_FILTERS: { id: 'all' | TestMode; labelKey: 'common.all' | 'mode.reading' | 'mode.sustained' | 'mode.glide' }[] = [
  { id: 'all', labelKey: 'common.all' },
  { id: 'reading', labelKey: 'mode.reading' },
  { id: 'sustained', labelKey: 'mode.sustained' },
  { id: 'glide', labelKey: 'mode.glide' },
];

/** 布局常量（px）：行高按列数与容器宽度自适应（花尺寸随单元格缩放） */
const BASE_ROW_H = 132; // 4 列时的行高基准
const BUFFER_ROWS = 3; // 视口上下各多渲染的行数

/** 月份标签（YYYY/M） */
function monthLabel(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}/${d.getMonth() + 1}`;
}

interface Row {
  kind: 'month' | 'flowers';
  /** month 行：标签；flowers 行：本行花朵 */
  label?: string;
  monthKey?: string;
  flowers?: { record: AnalysisRecord; flower: Flower; rotation: number }[];
}

/** 把记录按月分组 → 行序列（月头行 + 每行 cols 朵的花行），最新在前 */
function buildRows(records: AnalysisRecord[], cols: number, monthSections: boolean): Row[] {
  const sorted = [...records].sort((a, b) => b.createdAt - a.createdAt);
  const rows: Row[] = [];
  let curMonth = '';
  let buf: NonNullable<Row['flowers']> = [];
  const flush = () => {
    if (buf.length > 0) {
      rows.push({ kind: 'flowers', monthKey: curMonth, flowers: buf });
      buf = [];
    }
  };
  for (const r of sorted) {
    const m = monthLabel(r.createdAt);
    if (monthSections && m !== curMonth) {
      flush();
      curMonth = m;
      rows.push({ kind: 'month', label: m });
    }
    buf.push({ record: r, flower: flowerOf(r), rotation: rotationJitter(r.id) });
    if (buf.length >= cols) flush();
  }
  flush();
  return rows;
}

/** 花朵详情弹窗 */
function FlowerDetail({
  record,
  flower,
  onClose,
  onOpenAnalysis,
}: {
  record: AnalysisRecord;
  flower: Flower;
  onClose: () => void;
  onOpenAnalysis: () => void;
}) {
  useI18n();
  const d = new Date(record.createdAt);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] grid place-items-center bg-black/30 px-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.92, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={MOTION.springSoft}
        onClick={(e) => e.stopPropagation()}
        className="card-surface relative flex w-full max-w-sm flex-col items-center p-5"
      >
        <button
          onClick={onClose}
          aria-label={t('common.close')}
          className="absolute right-3 top-3 grid size-8 place-items-center rounded-full text-ink-2 hover:bg-surface-hi"
        >
          <X size={15} />
        </button>
        <FlowerSvg flower={flower} rotation={rotationJitter(record.id)} className="h-44 w-44" />
        <p className="mt-1 text-sm font-semibold text-ink">
          {d.getFullYear()}/{d.getMonth() + 1}/{d.getDate()} {t(`mode.${record.mode ?? 'reading'}`)}
        </p>
        {/* 侧数字：平均基频 / MPT / 响度（不进花的参数） */}
        <p className="text-[10px] tabular-nums text-ink-2">{flowerSideStats(record).join(' · ')}</p>
        {/* 映射依据：哪瓣是什么 */}
        <ul className="mt-3 w-full space-y-1">
          {flower.basis.facts.map((fact) => (
            <li key={fact} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-2">
              <span className="mt-[6px] size-1 shrink-0 rounded-full bg-accent/70" />
              {fact}
            </li>
          ))}
        </ul>
        <button
          onClick={onOpenAnalysis}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-full bg-accent py-2.5 text-sm font-medium text-on-accent transition-opacity hover:opacity-90"
        >
          <BarChart3 size={14} />
          {t('garden.openAnalysis')}
        </button>
      </motion.div>
    </motion.div>
  );
}

export function GardenView({
  records,
  totalCount,
  onOpenAnalysis,
}: {
  records: AnalysisRecord[];
  /** 全库记录总数（内存窗口截断时提示「只显示最近 N 条」） */
  totalCount: number;
  onOpenAnalysis: (record: AnalysisRecord) => void;
}) {
  useI18n();
  const gardenColumns = useStore((s) => s.settings.gardenColumns);
  const monthSections = useStore((s) => s.settings.gardenMonthSections);
  const [filter, setFilter] = useState<'all' | TestMode>('all');
  const [detail, setDetail] = useState<{ record: AnalysisRecord; flower: Flower } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);
  const [viewportW, setViewportW] = useState(0);
  const COLS = Math.max(1, Math.min(5, gardenColumns));

  const filtered = useMemo(
    () => (filter === 'all' ? records : records.filter((r) => r.mode === filter)),
    [records, filter],
  );

  // Lua 花朵脚本：记录集变化时异步预计算，完成后注入槽位（flowerOf 内部消费）
  const [luaVersion, setLuaVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    void computeLuaFlowers(filtered, (r) => _internal.bandEnergies(r)).then((map) => {
      if (!alive) return;
      applyLuaFlowers(map);
      setLuaVersion((n) => n + 1); // 触发 rows 重算（Lua 花生效）
    });
    return () => { alive = false; };
  }, [filtered]);

  // 列数严格跟随设置；行高按容器宽度与列数缩放，窄屏多列也不会溢出
  const cols = useMemo(() => Math.max(1, COLS), [COLS]);
  const rowH = useMemo(() => {
    const cellW = viewportW > 0
      ? (viewportW - 16 - (cols - 1) * 8) / cols
      : BASE_ROW_H * 0.82;
    return Math.round(Math.max(70, Math.min(BASE_ROW_H * (4 / cols) ** 0.5, cellW * 1.15)));
  }, [cols, viewportW]);
  const monthH = 36;

  // 行布局（含 flowerOf 映射）：luaVersion 有意依赖（Lua 花异步就绪后重算）
  // eslint-disable-next-line react-hooks/exhaustive-deps -- luaVersion 是有意依赖：Lua 花就绪后用槽位重映射
  const rows = useMemo(() => buildRows(filtered, cols, monthSections), [filtered, cols, monthSections, luaVersion]);
  const rowOffsets = useMemo(() => {
    const offs: number[] = [];
    let y = 0;
    for (const r of rows) {
      offs.push(y);
      y += r.kind === 'month' ? monthH : rowH;
    }
    offs.push(y);
    return offs; // 长 = rows.length + 1
  }, [rows, rowH, monthH]);
  const totalH = rowOffsets[rowOffsets.length - 1] ?? 0;

  // 容器宽度：决定行高与每条花的尺寸（移动端与桌面端同一列数）
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportW(el.clientWidth));
    ro.observe(el);
    setViewportW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // 滚动监听（rAF 节流）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setScrollTop(el.scrollTop);
        setViewportH(el.clientHeight);
        setViewportW(el.clientWidth);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [filter, filtered.length]);

  // 可视行窗口
  const [startRow, endRow] = useMemo(() => {
    let lo = 0;
    let hi = rows.length;
    const buffer = BUFFER_ROWS * (rowH + monthH);
    // 二分找第一个底部越过视口顶的行
    {
      let a = 0;
      let b = rows.length - 1;
      const target = scrollTop - buffer;
      while (a <= b) {
        const mid = (a + b) >> 1;
        if (rowOffsets[mid + 1] <= target) a = mid + 1;
        else { lo = mid; b = mid - 1; }
      }
    }
    {
      let a = lo;
      let b = rows.length - 1;
      const target = scrollTop + viewportH + buffer;
      while (a <= b) {
        const mid = (a + b) >> 1;
        if (rowOffsets[mid] < target) a = mid + 1;
        else { hi = mid; b = mid - 1; }
      }
    }
    return [lo, hi];
  }, [rows, rowOffsets, scrollTop, viewportH, rowH, monthH]);

  const visible = rows.slice(startRow, Math.min(endRow + 1, rows.length));
  const gridColsClass = cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-2' : cols === 3 ? 'grid-cols-3' : cols === 5 ? 'grid-cols-5' : 'grid-cols-4';
  /** 少量记录直接随页面滚动；大量记录才启用内嵌虚拟滚动 */
  const virtualize = filtered.length > 120;

  const flowerButton = (r: AnalysisRecord, flower: Flower, rotation: number) => (
    <button
      key={r.id}
      onClick={() => setDetail({ record: r, flower })}
      className="group flex flex-col items-center justify-center rounded-2xl bg-card/60 px-2 py-1 transition-colors hover:bg-card"
      aria-label={`${t('garden.openDetail')}: ${r.stats.avgF0.toFixed(1)} Hz`}
    >
      <FlowerSvg
        flower={flower}
        rotation={rotation}
        className="transition-transform group-active:scale-95"
        style={{ width: rowH * 0.62, height: rowH * 0.62 }}
      />
      <span className="text-[10px] tabular-nums text-ink-2">
        {new Date(r.createdAt).getMonth() + 1}/{new Date(r.createdAt).getDate()}
        {' · '}
        {r.stats.avgF0.toFixed(0)}Hz
      </span>
    </button>
  );

  const flowerGrid = (row: Row, key: string, style?: CSSProperties) => (
    <div key={key} className={cn('grid gap-2', gridColsClass)} style={style}>
      {row.flowers!.map(({ record: r, flower, rotation }) => flowerButton(r, flower, rotation))}
    </div>
  );

  return (
    <div ref={rootRef}>
      {/* 模式过滤（布局设置在 设置 → 外观 → 花园布局） */}
      <div className="mb-3 flex items-center justify-center">
        <div className="flex items-center rounded-full bg-surface-hi p-0.5" role="group" aria-label={t('garden.filterLabel')}>
          {GARDEN_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={cn(
                'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                filter === f.id ? 'bg-card text-ink shadow-sm' : 'text-ink-2 hover:text-ink',
              )}
            >
              {t(f.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-ink-2">{t('garden.empty')}</p>
      ) : virtualize ? (
        /* 大量记录才使用内嵌虚拟滚动；少量记录直接随页面滚动 */
        <div ref={scrollRef} className="max-h-[62dvh] overflow-y-auto overscroll-contain pr-1">
          <div style={{ height: totalH, position: 'relative' }}>
            {visible.map((row, i) => {
              const idx = startRow + i;
              const y = rowOffsets[idx];
              if (row.kind === 'month') {
                return (
                  <p
                    key={`m-${row.label}-${idx}`}
                    className="absolute inset-x-0 flex items-center gap-2 px-1 text-[11px] font-semibold text-ink-2"
                    style={{ top: y, height: monthH - 6 }}
                  >
                    {row.label}
                    <span className="h-px flex-1 bg-black/[0.06]" />
                  </p>
                );
              }
              return flowerGrid(row, `f-${row.monthKey}-${idx}`, {
                top: y,
                height: rowH,
                position: 'absolute',
                left: 0,
                right: 0,
              });
            })}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row, idx) => row.kind === 'month' ? (
            <p
              key={`m-${row.label}-${idx}`}
              className="flex items-center gap-2 px-1 text-[11px] font-semibold text-ink-2"
            >
              {row.label}
              <span className="h-px flex-1 bg-black/[0.06]" />
            </p>
          ) : flowerGrid(row, `f-${row.monthKey}-${idx}`))}
        </div>
      )}

      <AnimatePresence>
        {detail && (
          <FlowerDetail
            record={detail.record}
            flower={detail.flower}
            onClose={() => setDetail(null)}
            onOpenAnalysis={() => {
              const target = detail.record;
              setDetail(null);
              onOpenAnalysis(target);
            }}
          />
        )}
      </AnimatePresence>

      {/* 数据范围提示（内存窗口截断时） */}
      {totalCount > records.length && (
        <p className="mt-3 text-center text-[10px] text-ink-2/70">
          {t('garden.truncated', { shown: records.length, total: totalCount })}
        </p>
      )}
    </div>
  );
}
