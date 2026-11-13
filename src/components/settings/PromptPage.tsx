/**
 * 自定义提示词（实验性 → 大模型配置 子页面）
 * - 补充规则：逐条追加到内置分析标准之后，与标准冲突时以规则为准
 * - 覆写提示词：整体替换内置提示词（右上角覆写图标弹窗），留空即恢复默认
 * 规则与覆写仅存本地（随应用设置持久化）。
 */

import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Plus, SquarePen, X } from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import type { AppSettings } from '@/types';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Textarea } from '@/components/ui';
import { SettingsSection } from './rows';
import { MOTION } from '@/lib/motion';

export function PromptPage({
  settings,
  update,
  onBack,
}: {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  /** 返回实验性功能子页面 */
  onBack: () => void;
}) {
  useI18n();
  const rules = settings.llmExtraRules ?? [];
  const override = settings.llmPromptOverride?.trim() ?? '';
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState('');
  // 新增规则后聚焦对应输入框（ref 回调按索引触发一次）
  const focusIdx = useRef<number | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const setRules = (next: string[]) => {
    update({ llmExtraRules: next.length > 0 ? next : undefined });
  };

  const addRule = () => {
    focusIdx.current = rules.length;
    setRules([...rules, '']);
  };

  const openOverride = () => {
    setDraft(settings.llmPromptOverride ?? '');
    setDialogOpen(true);
  };

  const saveOverride = () => {
    update({ llmPromptOverride: draft.trim() || undefined });
    setDialogOpen(false);
    toast.success(t('toast.promptSaved'));
  };

  const resetOverride = () => {
    update({ llmPromptOverride: undefined });
    setDialogOpen(false);
    setDraft('');
    toast.success(t('toast.promptSaved'));
  };

  const inputCls =
    'min-w-0 flex-1 rounded-xl border border-black/10 bg-surface-hi px-3 py-2 text-xs text-ink outline-none placeholder:text-ink-2/50 focus:border-accent';
  const iconBtn =
    'grid size-9 place-items-center rounded-full bg-card text-ink shadow-[0_2px_14px_rgba(28,25,45,0.05),0_1px_3px_rgba(28,25,45,0.04)] transition-transform active:scale-90';

  return (
    <div className="flex flex-col gap-3.5 pb-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={MOTION.page}
        className="flex flex-col gap-3.5"
      >
        {/* 子页面头：返回 + 标题 + 右上角 加号 / 覆写 */}
        <div className="flex items-center gap-3">
          <button onClick={onBack} aria-label={t('common.back')} className={iconBtn}>
            <ArrowLeft size={18} />
          </button>
          <p className="text-base font-semibold text-ink">{t('settings.promptTitle')}</p>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={addRule}
              aria-label={t('settings.promptAddRule')}
              title={t('settings.promptAddRule')}
              className={iconBtn}
            >
              <Plus size={17} />
            </button>
            <button
              onClick={openOverride}
              aria-label={t('settings.promptOverrideAction')}
              title={t('settings.promptOverrideAction')}
              className={cn(iconBtn, override && 'text-accent')}
            >
              <SquarePen size={16} />
            </button>
          </div>
        </div>

        {/* 状态卡：覆写生效 / 内置标准 */}
        <div className="card-surface px-4 py-3">
          {override ? (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-ink">{t('settings.promptOverrideActive')}</p>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-ink-2">{override}</p>
              </div>
              <button
                onClick={resetOverride}
                className="shrink-0 text-xs font-medium text-accent transition-opacity hover:opacity-70"
              >
                {t('settings.promptReset')}
              </button>
            </div>
          ) : (
            <p className="text-xs leading-relaxed text-ink-2">{t('settings.promptDefault')}</p>
          )}
        </div>

        {/* 补充规则列表 */}
        <SettingsSection icon={SquarePen} title={t('settings.promptRules')}>
          <p className="px-0.5 pb-1 text-[11px] leading-relaxed text-ink-2">{t('settings.promptRulesDesc')}</p>
          {rules.length === 0 && (
            <p className="px-0.5 py-2 text-[11px] text-ink-2">{t('settings.promptEmpty')}</p>
          )}
          {rules.map((rule, i) => (
            <div
              key={i}
              className="flex items-center gap-2 border-t border-black/[0.04] py-2 first:border-t-0"
            >
              <span className="w-4 shrink-0 text-center text-[11px] tabular-nums text-ink-2">{i + 1}</span>
              <input
                ref={(el) => {
                  inputRefs.current[i] = el;
                  if (el && focusIdx.current === i) {
                    el.focus();
                    focusIdx.current = null;
                  }
                }}
                value={rule}
                onChange={(e) => setRules(rules.map((r, j) => (j === i ? e.target.value : r)))}
                placeholder={t('settings.promptRulePlaceholder')}
                spellCheck={false}
                className={inputCls}
              />
              <button
                onClick={() => setRules(rules.filter((_, j) => j !== i))}
                aria-label={t('common.delete')}
                className="grid size-7 shrink-0 place-items-center rounded-full text-ink-2 transition-colors hover:bg-surface-hi hover:text-ink"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </SettingsSection>
      </motion.div>

      {/* 覆写提示词弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="rounded-3xl border-0 bg-card sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-ink">{t('settings.promptOverrideTitle')}</DialogTitle>
          </DialogHeader>
          <p className="-mt-1 text-[11px] leading-relaxed text-ink-2">{t('settings.promptOverrideDesc')}</p>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('settings.promptOverridePlaceholder')}
            className="mono min-h-48 rounded-2xl border-black/10 bg-surface-hi text-xs leading-relaxed text-ink"
          />
          <DialogFooter className="gap-2">
            <button
              onClick={resetOverride}
              className="px-1 py-2 text-sm font-medium text-ink-2 transition-opacity hover:opacity-70"
            >
              {t('settings.promptReset')}
            </button>
            <button
              onClick={saveOverride}
              className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-on-accent transition-opacity hover:opacity-90"
            >
              {t('common.save')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
