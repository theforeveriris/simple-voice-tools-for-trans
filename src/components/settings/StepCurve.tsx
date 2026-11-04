/**
 * 引导页顶部的进度曲线
 *
 * 用一条连续的 F0 轨迹表示「进度」：已走过的部分是实线 + 光晕，未走的部分是
 * 灰线；线的末端有光斑和下引线，四个节点依次点亮。
 *
 * 设计约束（改样式时请保持）：
 * - 曲线必须一笔画完，不做分段/断点，否则又变回装饰性的折线；
 * - 四个节点必须落在波峰上（MILESTONES 的下标即为此挑选），圆点停在斜边或
 *   谷底都会像渲染错误；
 * - 右侧留 LABEL_GUTTER 给 Hz 刻度，线不贴边；
 * - 光晕用两层半透明圆，不用 feGaussianBlur——Android WebView 上会糊且掉帧。
 *
 * F0 是一段朗读降采样后的基频（Hz），只用于绘制，不参与任何音频计算。
 */

import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';

/** 一段朗读的 F0 采样（Hz），29 点，末尾收在同一条区间带里 */
const F0 = [
  118, 127, 135, 140, 132, 128, 136, 148, 162, 172,
  180, 173, 167, 175, 188, 200, 210, 216, 220, 213,
  207, 215, 228, 240, 247, 252, 258, 255, 252,
];

/** 四个里程碑在采样点上的下标——刻意选在局部波峰 */
const MILESTONES = [3, 10, 18, 25];

/** 目标基频区间与纵轴刻度（Hz） */
const BAND_LO = 165;
const BAND_HI = 255;
const F_MIN = 100;
const F_MAX = 300;

const PAD_TOP = 26;
const PAD_BOTTOM = 30;
/** 右侧留给 255 / 165 Hz 刻度的宽度 */
const LABEL_GUTTER = 34;
const DEFAULT_HEIGHT = 186;

type Pt = [number, number];

/** Catmull-Rom → 三次贝塞尔（张力 1/6）：连续、不过冲 */
function smoothPath(pts: Pt[]): string {
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

/** 折线长度——用来把「走到第几个采样点」换算成 pathLength 的 0~1 */
function polylineLength(pts: Pt[]): number {
  let sum = 0;
  for (let i = 1; i < pts.length; i += 1) {
    sum += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return sum;
}

export function StepCurve({
  step,
  total,
  className,
}: {
  /** 当前步骤，0 起 */
  step: number;
  /** 总步骤数，用于无障碍文案 */
  total: number;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 360, height: DEFAULT_HEIGHT });
  const reduceMotion = useReducedMotion();
  useI18n();

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      setSize({
        width: Math.round(entry.contentRect.width),
        height: Math.round(entry.contentRect.height),
      });
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  const { width, height } = size;
  const compact = height < 150;
  const padTop = compact ? 16 : PAD_TOP;
  const padBottom = compact ? 18 : PAD_BOTTOM;
  const plotRight = Math.max(width - LABEL_GUTTER, 120);
  const x = (i: number) => 2 + (i / (F0.length - 1)) * (plotRight - 2);
  const y = (f: number) =>
    padTop + (1 - (f - F_MIN) / (F_MAX - F_MIN)) * (height - padTop - padBottom);

  const pts: Pt[] = F0.map((f, i) => [x(i), y(f)]);
  const fullPath = smoothPath(pts);

  const headIndex = MILESTONES[Math.min(Math.max(step, 0), MILESTONES.length - 1)];
  const head = pts[headIndex];
  const totalLen = polylineLength(pts);
  const progress = totalLen > 0 ? polylineLength(pts.slice(0, headIndex + 1)) / totalLen : 0;

  const bandTop = y(BAND_HI);
  const bandBottom = y(BAND_LO);

  return (
    <div
      ref={hostRef}
      className={cn('shrink-0', className)}
      role="img"
      aria-label={t('onboard.stepOf', { n: step + 1, total })}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        fill="none"
        aria-hidden="true"
      >
        {/* 目标区间：让曲线有纵轴含义，而不只是装饰 */}
        <rect
          x={0}
          y={bandTop}
          width={width}
          height={bandBottom - bandTop}
          fill="rgb(var(--c-accent-rgb) / 0.05)"
        />
        <line
          x1={0}
          y1={bandTop}
          x2={width}
          y2={bandTop}
          stroke="rgb(var(--c-accent-rgb) / 0.20)"
          strokeWidth={1}
          strokeDasharray="3 4"
        />
        <line
          x1={0}
          y1={bandBottom}
          x2={width}
          y2={bandBottom}
          stroke="rgb(var(--c-accent-rgb) / 0.20)"
          strokeWidth={1}
          strokeDasharray="3 4"
        />
        <text
          x={width}
          y={bandTop - 6}
          textAnchor="end"
          fontSize={8}
          fill="rgb(var(--c-ink-2-rgb) / 0.75)"
        >
          255
        </text>
        <text
          x={width}
          y={bandBottom + 11}
          textAnchor="end"
          fontSize={8}
          fill="rgb(var(--c-ink-2-rgb) / 0.75)"
        >
          165 Hz
        </text>
        <text
          className="onboarding-band-label"
          x={2}
          y={(bandTop + bandBottom) / 2 + 3}
          fontSize={8}
          fill="rgb(var(--c-ink-2-rgb) / 0.85)"
        >
          {t('onboard.curveBand')}
        </text>

        {/* 未完成段：整条曲线的灰底，保留「还有多远」 */}
        <path
          d={fullPath}
          stroke="rgb(var(--c-ink-rgb) / 0.16)"
          strokeWidth={1.8}
          strokeLinecap="round"
        />

        {/* 已完成段：同一路径 + pathLength 生长，d 不变，切换步骤只推长度 */}
        <motion.path
          d={fullPath}
          stroke="rgb(var(--c-accent-rgb))"
          strokeWidth={6}
          strokeOpacity={0.09}
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: progress }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.32, ease: 'easeOut' }}
        />
        <motion.path
          d={fullPath}
          stroke="rgb(var(--c-accent-rgb))"
          strokeWidth={2.2}
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: progress }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.32, ease: 'easeOut' }}
        />

        {/* 头部光斑 + 下引线 */}
        <circle cx={head[0]} cy={head[1]} r={14} fill="rgb(var(--c-accent-rgb) / 0.10)" />
        <circle cx={head[0]} cy={head[1]} r={9} fill="rgb(var(--c-accent-rgb) / 0.16)" />
        <line
          x1={head[0]}
          y1={head[1] + 10}
          x2={head[0]}
          y2={height - padBottom}
          stroke="rgb(var(--c-accent-rgb) / 0.25)"
          strokeWidth={1}
          strokeDasharray="2 3"
        />

        {/* 里程碑：序号在圆点里，不压线 */}
        {MILESTONES.map((index, i) => {
          const done = i <= step;
          const cx = x(index);
          const cy = y(F0[index]);
          const r = done ? 7 : 5.5;
          return (
            <g key={index}>
              <circle cx={cx} cy={cy} r={r + 2} fill="rgb(var(--c-surface-rgb))" />
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill={done ? 'rgb(var(--c-accent-rgb))' : 'rgb(var(--c-card-rgb))'}
                stroke={done ? 'rgb(var(--c-accent-rgb))' : 'rgb(var(--c-ink-rgb) / 0.22)'}
                strokeWidth={1.2}
              />
              <text
                x={cx}
                y={cy + 2.6}
                textAnchor="middle"
                fontSize={7.5}
                fontWeight={600}
                fill={done ? 'rgb(var(--c-on-accent-rgb))' : 'rgb(var(--c-ink-2-rgb) / 0.8)'}
              >
                {i + 1}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
