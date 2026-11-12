/**
 * 信息浮窗：标签文本右侧的 Info 图标，点击后在其下方弹出说明浮层
 * （无边缘线条、微阴影；再点图标或点击外部关闭）
 * 供数据管理 / 实验性功能等子页面的长说明行使用
 * wide：长说明用更宽的浮层（默认 w-64 会把长段落挤成很多行）
 */

import { useEffect, useId, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Info } from 'lucide-react';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';

export function InfoTip({ label, text, wide = false }: { label: string; text: string; wide?: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  // 打开时点击外部（图标与浮层本身除外）即关闭
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('[data-info-tip]')) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <span className="relative flex items-center gap-1.5" data-info-tip>
      {label}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={t('common.help')}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        className={cn(
          'transition-opacity hover:opacity-70',
          open ? 'text-accent' : 'text-ink-2/70',
        )}
      >
        <Info size={13} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.span
            id={id}
            role="tooltip"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className={cn(
              'absolute left-0 top-6 z-20 block whitespace-pre-line rounded-2xl bg-card px-3.5 py-2.5 text-left text-[11px] font-normal leading-relaxed text-ink-2 shadow-[0_6px_24px_rgba(28,25,45,0.10),0_2px_6px_rgba(28,25,45,0.06)]',
              wide ? 'w-80 max-w-[80vw]' : 'w-64',
            )}
          >
            {text}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
