/**
 * 空态英雄区（分析页 / 历史列表共用）
 * 极简构成：柔光圆底图标 + 标题 + 副题 + 主次胶囊按钮，整体居中悬浮。
 * 不引入任何装饰性插画——质感来自层级与留白，而非元素数量。
 */

import { motion } from 'framer-motion';
import { MOTION } from '@/lib/motion';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** 主按钮（实心胶囊）：与录音/开始按钮同一色板语言 */
export const EMPTY_PRIMARY =
  'rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-on-accent shadow-[0_2px_12px_rgba(28,25,45,0.10)] transition-transform active:scale-95';

/** 次按钮（描边胶囊）：与卡片同族的浅底细边框 */
export const EMPTY_SECONDARY =
  'rounded-full border border-black/10 bg-card px-5 py-2.5 text-sm font-medium text-ink-2 transition-colors hover:text-ink';

export function EmptyHero({
  icon,
  title,
  desc,
  primary,
  secondary,
  className,
}: {
  /** 主体图标（lucide 元素，颜色交由本组件控制） */
  icon: ReactNode;
  title: string;
  desc: string;
  /** 主操作按钮（已含样式类） */
  primary: ReactNode;
  /** 次操作按钮（已含样式类） */
  secondary: ReactNode;
  /** 根容器附加类（如历史页用负 margin 抵消上方切换控件，保证两页图标同屏对齐） */
  className?: string;
}) {
  return (
    <div className={cn('grid min-h-[62vh] place-items-center px-6', className)}>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={MOTION.emphasis}
        className="flex flex-col items-center text-center"
      >
        {/* 图标：柔光晕 + 浅色圆底 */}
        <div className="relative grid size-[72px] place-items-center">
          <div aria-hidden className="absolute inset-1 rounded-full bg-accent/15 blur-xl" />
          <div className="relative grid size-16 place-items-center rounded-full bg-accent-soft/70 text-accent ring-1 ring-accent/15">
            {icon}
          </div>
        </div>
        <p className="mt-5 text-[15px] font-semibold tracking-tight text-ink">{title}</p>
        <p className="mt-1.5 max-w-[24rem] text-[13px] leading-relaxed text-ink-2">{desc}</p>
        <div className="mt-6 flex items-center gap-2.5">
          {primary}
          {secondary}
        </div>
      </motion.div>
    </div>
  );
}
