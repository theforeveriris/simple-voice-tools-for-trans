/**
 * 设置页共享原语：子页外壳、分区卡片、单行设置项、控件皮肤、字节格式化
 * （设置主视图与全部子页面共用）
 */

import type { ElementType, ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { t } from '@/i18n';

/**
 * 设置子页共享外壳：返回按钮 + 标题 + 入场动画 + 卡片流容器
 * 所有设置子页面（外观 / 语言 / 录音 / 训练 / 应用 / 大模型 / 数据 / 高级）共用，
 * 保证页头与动画完全一致；内容各页自持。
 */

export function SettingsSubPage({
  title,
  onBack,
  children,
}: {
  title: string;
  /** 返回设置主视图 */
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3.5 pb-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
        className="flex flex-col gap-3.5"
      >
        <div className="flex items-center gap-3" data-theme-part="topbar">
          <button
            onClick={onBack}
            aria-label={t('common.back')}
            className="grid size-10 place-items-center rounded-full bg-card text-ink shadow-[0_2px_14px_rgba(28,25,45,0.05),0_1px_3px_rgba(28,25,45,0.04)] transition-transform active:scale-90"
          >
            <ArrowLeft size={18} />
          </button>
          <p className="text-base font-semibold text-ink">{title}</p>
        </div>
        {children}
      </motion.div>
    </div>
  );
}

export function SettingsSection({
  icon: Icon,
  title,
  children,
}: {
  icon: ElementType;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="card-surface p-5">
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
        <Icon size={15} className="text-accent" />
        {title}
      </p>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

export function SettingRow({
  label,
  desc,
  children,
  stacked,
}: {
  /** 通常为字符串；也可传节点（如「备份文件夹」标签 + 信息图标） */
  label: ReactNode;
  desc?: string;
  children?: ReactNode;
  stacked?: boolean;
}) {
  if (stacked) {
    return (
      <div className="py-2">
        <p className="text-sm font-medium text-ink">{label}</p>
        {desc && <p className="mt-0.5 text-[11px] text-ink-2">{desc}</p>}
        <div className="mt-2">{children}</div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-black/[0.04] py-2 first:border-t-0">
      {/* 左列可压缩（min-w-0）：长描述在列内换行。控件列 shrink-0 + ml-auto：
          放得下时留在本行右侧，放不下换行时仍贴右缘（不再左对齐外溢） */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{label}</p>
        {desc && <p className="mt-0.5 text-[11px] leading-relaxed text-ink-2">{desc}</p>}
      </div>
      {/* 控件列：贴右缘（ml-auto），宽度不足时在列内换行而不是横向溢出 */}
      {children != null && (
        <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * 设置行内下拉控件的统一皮肤（值右对齐、箭头紧随、无固定宽度）
 * 每处不再各写 w-24 / w-36 / w-52——右侧一律「值 + 箭头」贴齐容器右缘，
 * 与开关的右缘对齐；长内容（麦克风名）可用 withTruncateMaxWidth 追加限宽。
 */
export const SELECT_TRIGGER_CLASS =
  'h-6 w-fit justify-end gap-1.5 border-0 bg-transparent pl-2 pr-0 text-sm font-medium text-ink shadow-none '
  + '[&_[data-slot=select-value]]:flex-none data-[placeholder]:text-ink-2';

/** 长文本选项（设备名等）：限宽 + 省略号，仍保持右对齐 */
export const SELECT_TRIGGER_TRUNCATE = 'max-w-[11rem] [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:truncate';

/** 设置行内数值输入框的统一皮肤（右对齐、同一高度与字重） */
export const NUMBER_INPUT_CLASS =
  'w-14 rounded-xl border border-black/10 bg-surface-hi px-2 py-1.5 text-right text-sm tabular-nums '
  + 'text-ink outline-none focus:border-accent';

// eslint-disable-next-line react-refresh/only-export-components
export function fmtBytes(n: number): string {
  if (!isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[u]}`;
}
