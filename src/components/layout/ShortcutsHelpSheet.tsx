/**
 * 键盘快捷键帮助浮层（? 呼出）
 * 纯展示面板：组合键名称不参与翻译，仅描述文案走 i18n。
 */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { MOTION } from '@/lib/motion';
import { Keyboard } from 'lucide-react';
import { t, type DictKey } from '@/i18n';

/** 分组：标题词条 + 行（组合键 + 说明词条）；组合键名称不参与翻译 */
const GROUPS: { titleKey: DictKey; rows: [string, DictKey][] }[] = [
  {
    titleKey: 'shortcuts.groupGlobal',
    rows: [
      ['1 – 5', 'shortcuts.tabs'],
      ['S', 'shortcuts.recordGlobal'],
      ['?', 'shortcuts.help'],
    ],
  },
  {
    titleKey: 'shortcuts.groupTest',
    rows: [
      ['Space', 'shortcuts.record'],
    ],
  },
  {
    titleKey: 'shortcuts.groupAnalysis',
    rows: [
      ['R', 'shortcuts.replay'],
    ],
  },
  {
    titleKey: 'shortcuts.groupHistory',
    rows: [
      ['/', 'shortcuts.search'],
      ['Enter / Space', 'shortcuts.openCard'],
      ['Ctrl / ⌘ + A', 'shortcuts.selectAll'],
      ['Del', 'shortcuts.deleteSelected'],
      ['Esc', 'shortcuts.exitSelect'],
    ],
  },
  {
    titleKey: 'shortcuts.groupChart',
    rows: [
      ['← / →', 'shortcuts.crosshair'],
      ['Shift + ← / →', 'shortcuts.crosshairFast'],
      ['Home / End', 'shortcuts.crosshairEdge'],
    ],
  },
];

export function ShortcutsHelpSheet({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[70] grid place-items-center px-5">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={MOTION.base}
        onClick={onClose}
        className="absolute inset-0 bg-ink/25 backdrop-blur-md"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={MOTION.page}
        role="dialog"
        aria-modal="true"
        aria-label={t('shortcuts.title')}
        className="relative max-h-[80dvh] w-full max-w-sm overflow-y-auto rounded-[24px] bg-card p-5 shadow-[0_20px_60px_-12px_rgba(28,25,45,0.35)]"
      >
        <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
          <Keyboard size={16} className="text-accent" />
          {t('shortcuts.title')}
        </p>
        <div className="flex flex-col gap-3.5">
          {GROUPS.map((g) => (
            <div key={g.titleKey}>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-2">
                {t(g.titleKey)}
              </p>
              <ul className="flex flex-col gap-1">
                {g.rows.map(([combo, descKey]) => (
                  <li key={combo} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-ink-2">{t(descKey)}</span>
                    <kbd className="shrink-0 rounded-lg bg-surface-hi px-2 py-1 font-mono text-[10px] font-medium text-ink">
                      {combo}
                    </kbd>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
