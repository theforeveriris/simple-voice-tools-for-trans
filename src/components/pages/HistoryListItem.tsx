/**
 * 历史列表的记录卡与相关工具
 * 从 HistoryPage 拆出：长按手势 hook 与记录卡。
 * （删除撤销见 historyActions.ts）
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Trash2, ChevronRight, StickyNote } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { useHistoryStore } from '@/store/useHistoryStore';
import { spawnDeleteParticles } from '@/lib/deleteParticles';
import { MOTION } from '@/lib/motion';
import { MiniSpark } from '@/components/charts/MiniSpark';
import { freqToNote, bandOf, BAND_COLORS } from '@/constants';
import { t } from '@/i18n';
import type { AnalysisRecord } from '@/types';
import { cn } from '@/lib/utils';

const LONG_PRESS_MS = 480;

function formatDate(ts: number): { date: string; time: string } {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** 长按进入多选的手势处理（移动距离超阈值视为滚动，取消长按） */
function useLongPress(onLongPress: () => void) {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);
  const origin = useRef({ x: 0, y: 0 });

  // 卸载时清掉未触发的定时器：长按中卡片被移除/切视图，不应再把页面带入多选
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const onPointerDown = (e: ReactPointerEvent) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    fired.current = false;
    origin.current = { x: e.clientX, y: e.clientY };
    timer.current = window.setTimeout(() => {
      fired.current = true;
      onLongPress();
      navigator.vibrate?.(12);
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (timer.current === null) return;
    if (Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > 12) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };
  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    /** 长按后抬起时的 click 不应触发点击行为 */
    consumeClick: () => {
      const was = fired.current;
      fired.current = false;
      return was;
    },
  };
}

export function RecordCard({
  record,
  selected,
  selectionMode,
  onOpen,
  onToggleSelect,
  onEnterSelection,
  onDelete,
}: {
  record: AnalysisRecord;
  selected: boolean;
  selectionMode: boolean;
  onOpen: () => void;
  onToggleSelect: () => void;
  onEnterSelection: () => void;
  onDelete: () => void;
}) {
  const { date, time } = formatDate(record.createdAt);
  const band = bandOf(record.stats.avgF0);
  const note = freqToNote(record.stats.avgF0);
  const press = useLongPress(onEnterSelection);
  // 移动端整行迷你曲线开关（设置 → 外观；桌面端内联曲线不受影响）
  const mobileSpark = useStore((s) => s.settings.mobileSpark);
  // 删除动画（设置 → 外观 → 动效，默认开启）；系统开启「减少动态效果」时自动关闭
  const deleteAnimation = useStore((s) => s.settings.deleteAnimation);
  const reduceMotion = useReducedMotion() ?? false;
  const animateDelete = deleteAnimation && !reduceMotion;
  // 只有真正进入回收站（删除）才播放纸屑效果；搜索过滤等淡出即可
  const inTrash = useHistoryStore((s) => s.trash.some((item) => item.id === record.id));
  const deleteExit = animateDelete && inTrash;
  const cardRef = useRef<HTMLDivElement>(null);
  const particlesSpawned = useRef(false);

  useLayoutEffect(() => {
    if (!inTrash) {
      particlesSpawned.current = false;
      return;
    }
    if (!animateDelete || particlesSpawned.current) return;
    const el = cardRef.current;
    if (!el) return;
    particlesSpawned.current = true;
    spawnDeleteParticles(el);
  }, [inTrash, animateDelete]);

  const handleClick = () => {
    if (press.consumeClick()) return;
    if (selectionMode) onToggleSelect();
    else onOpen();
  };

  return (
    <motion.div
      ref={cardRef}
      layout={animateDelete}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={
        deleteExit
          ? {
              opacity: 0,
              height: 0,
              marginBottom: 0,
              paddingTop: 0,
              paddingBottom: 0,
              transition: {
                opacity: { duration: 0 },
                height: { delay: 0.1, ...MOTION.reflow },
                marginBottom: { delay: 0.1, ...MOTION.reflow },
                paddingTop: { delay: 0.1, ...MOTION.reflow },
                paddingBottom: { delay: 0.1, ...MOTION.reflow },
              },
            }
          : inTrash
            ? { transition: { duration: 0 } }
            : { opacity: 0, scale: 0.97, transition: reduceMotion ? { duration: 0 } : MOTION.base }
      }
      transition={{
        ...MOTION.page,
        layout: animateDelete ? MOTION.reflow : { duration: 0 },
      }}
      style={deleteExit ? { overflow: 'hidden' } : undefined}
      onClick={handleClick}
      onKeyDown={(e) => {
        // 键盘等价操作：Enter/Space 打开（多选模式下切换选中）。
        // 必须排除来自内部交互元素（删除按钮）的事件，否则删除按钮上的
        // Enter 会被 preventDefault 并变成「打开记录」，删除永远不生效。
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
      role="button"
      tabIndex={0}
      className={cn(
        'group mb-2.5 flex cursor-pointer select-none flex-col gap-1.5 rounded-[20px] bg-card p-4 shadow-[0_2px_14px_rgba(28,25,45,0.05),0_1px_3px_rgba(28,25,45,0.04)] transition-shadow last:mb-0 hover:shadow-[0_6px_24px_rgba(28,25,45,0.09),0_2px_6px_rgba(28,25,45,0.05)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/70 sm:flex-row sm:items-center sm:gap-4',
        selectionMode && selected && 'ring-2 ring-accent',
      )}
      {...(selectionMode ? {} : press)}
    >
      {/* 日期栏（桌面端左侧；移动端并入下方信息行） */}
      <div className="hidden w-16 shrink-0 text-center sm:block">
        <p className="text-xs font-semibold tabular-nums text-ink">{date}</p>
        <p className="text-lg font-semibold tabular-nums leading-tight text-ink">{time}</p>
        <p className="text-[10px] tabular-nums text-ink-2">{record.stats.durationSec.toFixed(0)} s</p>
      </div>

      <div className="hidden h-10 w-px shrink-0 bg-black/[0.05] sm:block" />

      {/* 波形与概要 + 操作（移动端同一行，操作靠右） */}
      <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
        <MiniSpark series={record.series} className="hidden shrink-0 sm:block" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-x-2 gap-y-0.5 flex-wrap">
            <span className="text-base font-semibold tabular-nums text-ink">
              {record.stats.avgF0.toFixed(1)}
            </span>
            <span className="text-[11px] text-ink-2">Hz</span>
            <span className="text-[11px] font-semibold text-accent">{note.name}</span>
            <span className="flex items-center gap-1 text-[10px] font-semibold text-ink-2">
              <span className="size-1.5 rounded-full" style={{ background: BAND_COLORS[band] }} />
              {t(`band.${band}`)}
            </span>
            {record.mode && (
              <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-on-accent-soft">
                {t(`mode.${record.mode}`)}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-[11px] text-ink-2">
            {/* 移动端显示日期与时长（日期栏已隐藏），桌面端显示区间统计 */}
            <span className="sm:hidden">
              {date} {time} · {record.stats.durationSec.toFixed(0)} s · {record.stats.avgDb.toFixed(0)} dB
            </span>
            <span className="hidden sm:inline">
              {t('band.male')} {record.stats.malePct}% · {t('band.female')} {record.stats.femalePct}% · {record.stats.avgDb.toFixed(0)} dB
            </span>
          </p>
          {record.note && (
            <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-accent">
              <StickyNote size={11} className="shrink-0" />
              {record.note}
            </p>
          )}
        </div>

        {/* 操作 */}
        <div className="flex shrink-0 items-center gap-1">
          {selectionMode ? (
            <span
              className={cn(
                'grid size-6 place-items-center rounded-full border-2 transition-colors',
                selected ? 'border-accent bg-accent text-on-accent' : 'border-black/20',
              )}
              aria-hidden
            >
              {selected && <span className="text-[11px] font-bold leading-none">✓</span>}
            </span>
          ) : (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="grid size-8 place-items-center text-ink-2 opacity-100 transition hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100"
                aria-label={t('history.deleteAria')}
              >
                <Trash2 size={15} />
              </button>
              <ChevronRight size={17} className="text-ink-2" />
            </>
          )}
        </div>
      </div>

      {/* 基频曲线（移动端：信息行下方整行铺满，可在设置 → 外观关闭；桌面端内联在信息行左侧） */}
      {mobileSpark && <MiniSpark full series={record.series} className="sm:hidden" />}
    </motion.div>
  );
}

