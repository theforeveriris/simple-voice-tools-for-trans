/**
 * 表单里的 6 位 PIN 输入（设置/重置流程使用；锁屏用自绘键盘）。
 */

import { useId } from 'react';
import { cn } from '@/lib/utils';

export function PinInput({
  value,
  onChange,
  label,
  autoFocus,
  disabled,
  onEnter,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  autoFocus?: boolean;
  disabled?: boolean;
  onEnter?: () => void;
  className?: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-xs font-medium text-ink-2">{label}</span>
      <input
        id={id}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        pattern="[0-9]*"
        maxLength={6}
        value={value}
        autoFocus={autoFocus}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onEnter?.();
        }}
        className="w-full rounded-2xl border border-line bg-card px-4 py-3 text-center text-2xl tracking-[0.45em] text-ink outline-none focus:border-accent disabled:opacity-50"
      />
    </label>
  );
}
