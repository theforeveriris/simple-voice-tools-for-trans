/**
 * 编辑词条浮层（语言子页 → 编辑词条）
 * 搜索任意界面文案，为当前语言保存自定义译文；覆盖层优先于内置与 AI
 * 词典（i18n 的 override 层），仅保存在本机。 Escape 或点击遮罩关闭。
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { MOTION } from '@/lib/motion';
import { Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { getAiLocaleLabel, getLocale, getOverride, LOCALES, setOverride, t } from '@/i18n';
import type { DictKey } from '@/i18n';
import { zhCN } from '@/i18n/zh-CN';
import { useI18n } from '@/i18n/hook';

/** 基准词条（键 + 简中原文） */
const BASE = Object.entries(zhCN as unknown as Record<string, string>) as [DictKey, string][];

export function EditStringsSheet({ onClose }: { onClose: () => void }) {
  useI18n();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<DictKey | null>(null);
  const [draft, setDraft] = useState('');

  // Escape 关闭：编辑器打开时先退回列表，否则关整个浮层（与头注释承诺一致）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (editing) setEditing(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, onClose]);

  /** 当前语言显示名（选择器同款） */
  const langLabel = getLocale() === 'ai'
    ? getAiLocaleLabel() ?? 'AI'
    : LOCALES.find((l) => l.id === getLocale())?.label ?? getLocale();

  /** 列表渲染依赖词典版本（getI18nVersion）：保存/恢复覆盖后 bump，立即反映新译文 */
  const results = (() => {
    const q = query.trim().toLowerCase();
    const all = BASE.map(([key, zh]) => {
      const current = t(key);
      const overridden = getOverride(key) != null;
      return { key, zh, current, overridden };
    });
    if (!q) return all.slice(0, 80);
    return all
      .filter((r) => r.key.toLowerCase().includes(q) || r.zh.toLowerCase().includes(q) || r.current.toLowerCase().includes(q))
      .slice(0, 80);
  })();

  const openEditor = (key: DictKey) => {
    setEditing(key);
    setDraft(getOverride(key) ?? t(key));
  };

  const save = () => {
    if (!editing) return;
    setOverride(editing, draft.trim() || null);
    toast.success(t('toast.editSaved'));
    setEditing(null);
  };

  const reset = () => {
    if (!editing) return;
    setOverride(editing, null);
    toast.success(t('toast.editResetDone'));
    setEditing(null);
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] grid place-items-center px-5">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={MOTION.base}
        onClick={onClose}
        className="absolute inset-0 bg-ink/25 backdrop-blur-md"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={MOTION.base}
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.aiEditStrings')}
        className="relative flex max-h-[80dvh] w-full max-w-md flex-col rounded-[24px] bg-card p-5 shadow-[0_20px_60px_-12px_rgba(28,25,45,0.35)]"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-ink">
            {t('settings.aiEditStrings')} · <span className="text-ink-2">{langLabel}</span>
          </p>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="grid size-8 place-items-center rounded-full text-ink-2 transition-colors hover:bg-surface-hi hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>

        {/* 搜索 */}
        <div className="mb-2 flex items-center gap-2 rounded-full bg-surface-hi px-3.5 py-2">
          <Search size={13} className="shrink-0 text-ink-2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('settings.editSearchPlaceholder')}
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-2/70"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label={t('common.reset')} className="text-ink-2 hover:text-ink">
              <X size={13} />
            </button>
          )}
        </div>

        {/* 编辑器（选中词条时替换列表） */}
        {editing ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2.5 pt-1">
            <p className="font-mono text-[10px] text-ink-2">{editing}</p>
            <p className="text-xs leading-relaxed text-ink-2">{t('settings.editZhRef')}：{BASE.find(([k]) => k === editing)?.[1]}</p>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-xl border border-black/10 bg-surface-hi px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={reset}
                className="px-1 py-1.5 text-xs font-medium text-ink-2 transition-opacity hover:opacity-70"
              >
                {t('common.reset')}
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEditing(null)}
                  className="rounded-full bg-surface-hi px-4 py-1.5 text-xs font-medium text-ink transition-opacity hover:opacity-70"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={save}
                  className="rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-on-accent transition-opacity hover:opacity-90"
                >
                  {t('common.save')}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pt-1">
            {results.length === 0 && (
              <p className="py-10 text-center text-xs text-ink-2">{t('settings.editNoMatch')}</p>
            )}
            {results.map((r) => (
              <button
                key={r.key}
                onClick={() => openEditor(r.key)}
                className="flex flex-col gap-0.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-surface-hi"
              >
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-mono text-[10px] text-ink-2/70">{r.key}</span>
                  {r.overridden && (
                    <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-[9px] font-medium text-on-accent-soft">
                      {t('settings.editOverridden')}
                    </span>
                  )}
                </span>
                <span className="truncate text-xs text-ink">{r.current}</span>
              </button>
            ))}
          </div>
        )}
      </motion.div>
    </div>,
    document.body,
  );
}
