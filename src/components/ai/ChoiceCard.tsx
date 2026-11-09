/**
 * 阻塞式选择器卡片
 * 模型通过 ask_choice 提交结构化问题和选项，用户在这里选择后自动续聊。
 * 单选 / 多选共用一套壳，额外支持「其他」自定义输入。
 */
import { useState } from 'react';
import { Check, HelpCircle } from 'lucide-react';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import {
  choiceResultLabel,
  type ChoiceResult,
  type PendingChoice,
} from '@/lib/assistantChoice';
import { cn } from '@/lib/utils';

export function ChoiceCard({
  choice,
  result,
  onResolve,
}: {
  choice: PendingChoice;
  result?: ChoiceResult;
  onResolve: (result: ChoiceResult) => void;
}) {
  useI18n();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [custom, setCustom] = useState('');
  const multi = choice.selection === 'multiple';
  const customText = custom.trim();
  const count = selected.size + (customText ? 1 : 0);
  const canSubmit = count > 0;

  if (result) {
    const label = choiceResultLabel(choice, result);
    return (
      <div className="mt-3 flex w-full items-center gap-1.5 rounded-xl border border-line/60 bg-card/80 px-2.5 py-2 text-[10px] text-ink-2 sm:w-3/5">
        <Check size={11} className="shrink-0 text-accent" />
        <span className="shrink-0 font-medium text-ink">
          {result.skipped ? t('assistant.choiceSkipped') : t('assistant.choiceSubmitted')}
        </span>
        {!result.skipped && <span className="min-w-0 truncate">{label}</span>}
      </div>
    );
  }

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (!multi) return new Set([id]);
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!multi) setCustom('');
  };

  const changeCustom = (value: string) => {
    setCustom(value);
    if (!multi) setSelected(new Set());
  };

  const submit = () => {
    if (!canSubmit) return;
    onResolve({
      selectedIds: [...selected],
      ...(customText ? { custom: customText } : {}),
    });
  };

  return (
    <div className="mt-3 w-full rounded-xl border border-line/60 bg-card/80 px-2.5 py-2 sm:w-3/5">
      <div className="flex items-start gap-1.5">
        <HelpCircle size={12} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold leading-[1.45] text-ink">{choice.question}</p>
          <p className="mt-0.5 text-[8.5px] leading-relaxed text-ink-2">
            {multi ? t('assistant.choiceMultiHint') : t('assistant.choiceSingleHint')}
          </p>
        </div>
      </div>

      <div className="mt-2 space-y-1">
        {choice.options.map((option) => {
          const checked = selected.has(option.id);
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => toggle(option.id)}
              className={cn(
                'flex w-full items-start gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors',
                checked
                  ? 'border-accent/50 bg-accent-soft/40'
                  : 'border-line/50 hover:bg-surface-hi/50',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 grid size-3 shrink-0 place-items-center border',
                  multi ? 'rounded-[3px]' : 'rounded-full',
                  checked ? 'border-accent bg-accent text-on-accent' : 'border-ink-2/40',
                )}
              >
                {checked && <Check size={8} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[10.5px] font-medium leading-[1.45] text-ink">{option.label}</span>
                {option.description && (
                  <span className="mt-0.5 block text-[8.5px] leading-relaxed text-ink-2">
                    {option.description}
                  </span>
                )}
              </span>
            </button>
          );
        })}

        {choice.allowOther && (
          <div
            className={cn(
              'rounded-lg border px-2 py-1.5 transition-colors',
              customText ? 'border-accent/50 bg-accent-soft/40' : 'border-line/50',
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'grid size-3 shrink-0 place-items-center border',
                  multi ? 'rounded-[3px]' : 'rounded-full',
                  customText ? 'border-accent bg-accent text-on-accent' : 'border-ink-2/40',
                )}
              >
                {customText && <Check size={8} />}
              </span>
              <span className="shrink-0 text-[10.5px] font-medium text-ink">{t('assistant.choiceOther')}</span>
            </div>
            <input
              value={custom}
              onChange={(e) => changeCustom(e.target.value)}
              aria-label={t('assistant.choiceOther')}
              placeholder={t('assistant.choiceOtherPlaceholder')}
              className="mt-1 w-full bg-transparent pl-5 text-[10px] leading-relaxed text-ink outline-none placeholder:text-ink-2/45"
            />
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onResolve({ selectedIds: [], skipped: true })}
          className="px-1 py-1 text-[9px] font-medium text-ink-2 transition-opacity hover:opacity-70"
        >
          {t('assistant.choiceSkip')}
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          className="ml-auto rounded-full bg-accent px-3 py-1 text-[9.5px] font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {count > 1 ? t('assistant.choiceContinueN', { n: count }) : t('assistant.choiceContinue')}
        </button>
      </div>
    </div>
  );
}
