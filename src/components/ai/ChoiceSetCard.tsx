/**
 * 一张卡片里分页展示多道选择题
 * 翻页交互复用分析页导出弹窗：圆点指示条 + 左右滑动 + 横向位移动画；
 * 用户答完后一次提交，选择结果统一追加为一条用户消息并自动续聊。
 */
import { useRef, useState } from 'react';
import { Check, HelpCircle } from 'lucide-react';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import type {
  ChoiceAnswer,
  ChoiceQuestion,
  ChoiceSetResult,
  PendingChoiceSet,
} from '@/lib/assistantChoice';
import { cn } from '@/lib/utils';

interface DraftAnswer {
  selected: Set<string>;
  custom: string;
}

function isEmpty(a: DraftAnswer | undefined): boolean {
  return !a || (a.selected.size === 0 && !a.custom.trim());
}

export function ChoiceSetCard({
  set,
  result,
  onResolve,
}: {
  set: PendingChoiceSet;
  result?: ChoiceSetResult;
  onResolve: (result: ChoiceSetResult) => void;
}) {
  useI18n();
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, DraftAnswer>>({});
  const swipeX = useRef<number | null>(null);
  const total = set.questions.length;
  const answeredCount = set.questions.filter((q) => !isEmpty(answers[q.id])).length;
  const allAnswered = answeredCount === total;

  if (result) {
    return (
      <div className="mt-3 flex w-full items-center gap-1.5 rounded-xl border border-line/60 bg-card/80 px-2.5 py-2 text-[10px] text-ink-2 sm:w-3/5">
        <Check size={11} className="shrink-0 text-accent" />
        <span className="shrink-0 font-medium text-ink">
          {result.skipped
            ? t('assistant.choiceSkipped')
            : t('assistant.choiceSetSubmitted', { n: result.answers.length })}
        </span>
      </div>
    );
  }

  const patch = (qid: string, next: DraftAnswer) => {
    setAnswers((prev) => ({ ...prev, [qid]: next }));
  };

  const toggle = (q: ChoiceQuestion, id: string) => {
    const base = answers[q.id] ?? { selected: new Set<string>(), custom: '' };
    const selected = new Set(base.selected);
    if (q.selection === 'multiple') {
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
    } else {
      selected.clear();
      selected.add(id);
    }
    patch(q.id, { selected, custom: q.selection === 'multiple' ? base.custom : '' });
  };

  const changeCustom = (q: ChoiceQuestion, value: string) => {
    const base = answers[q.id] ?? { selected: new Set<string>(), custom: '' };
    patch(q.id, { selected: q.selection === 'multiple' ? base.selected : new Set(), custom: value });
  };

  const submit = () => {
    if (!allAnswered) return;
    const list: ChoiceAnswer[] = set.questions.map((q) => {
      const a = answers[q.id];
      return {
        questionId: q.id,
        selectedIds: a ? [...a.selected] : [],
        ...(a?.custom.trim() ? { custom: a.custom.trim() } : {}),
      };
    });
    onResolve({ answers: list });
  };

  return (
    <div className="mt-3 w-full rounded-xl border border-line/60 bg-card/80 px-2.5 py-2 sm:w-3/5">
      {/* 分页指示条：与分析页导出弹窗同款 */}
      <div className="flex items-center justify-center gap-1.5">
        {set.questions.map((q, i) => (
          <button
            key={q.id}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={t('assistant.choiceSetPage', { n: i + 1 })}
            aria-current={i === index}
            className={cn(
              'h-1.5 rounded-full transition-all duration-200',
              i === index
                ? 'w-5 bg-accent'
                : !isEmpty(answers[q.id])
                  ? 'w-1.5 bg-accent/45'
                  : 'w-1.5 bg-ink-2/30 hover:bg-ink-2/50',
            )}
          />
        ))}
        <span className="ml-1 text-[8px] tabular-nums text-ink-2/70">
          {index + 1}/{total}
        </span>
      </div>

      <div
        className="mt-2 touch-pan-y overflow-hidden"
        onPointerDown={(e) => { swipeX.current = e.clientX; }}
        onPointerUp={(e) => {
          if (swipeX.current == null) return;
          const dx = e.clientX - swipeX.current;
          swipeX.current = null;
          if (Math.abs(dx) < 40) return;
          setIndex((i) => (dx < 0 ? Math.min(total - 1, i + 1) : Math.max(0, i - 1)));
        }}
      >
        <div
          className="flex items-start transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {set.questions.map((q) => {
            const current = answers[q.id];
            const multi = q.selection === 'multiple';
            return (
              <div key={q.id} className="w-full shrink-0">
                <div className="flex items-start gap-1.5">
                  <HelpCircle size={12} className="mt-0.5 shrink-0 text-accent" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold leading-[1.45] text-ink">{q.question}</p>
                    <p className="mt-0.5 text-[8.5px] leading-relaxed text-ink-2">
                      {multi ? t('assistant.choiceMultiHint') : t('assistant.choiceSingleHint')}
                    </p>
                  </div>
                </div>

                <div className="mt-2 space-y-1">
                  {q.options.map((option) => {
                    const checked = current?.selected.has(option.id) ?? false;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => toggle(q, option.id)}
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
                          <span className="block text-[10.5px] font-medium leading-[1.45] text-ink">
                            {option.label}
                          </span>
                          {option.description && (
                            <span className="mt-0.5 block text-[8.5px] leading-relaxed text-ink-2">
                              {option.description}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}

                  {q.allowOther && (
                    <div
                      className={cn(
                        'rounded-lg border px-2 py-1.5 transition-colors',
                        current?.custom.trim() ? 'border-accent/50 bg-accent-soft/40' : 'border-line/50',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'grid size-3 shrink-0 place-items-center border',
                            multi ? 'rounded-[3px]' : 'rounded-full',
                            current?.custom.trim() ? 'border-accent bg-accent text-on-accent' : 'border-ink-2/40',
                          )}
                        >
                          {current?.custom.trim() ? <Check size={8} /> : null}
                        </span>
                        <span className="shrink-0 text-[10.5px] font-medium text-ink">
                          {t('assistant.choiceOther')}
                        </span>
                      </div>
                      <input
                        value={current?.custom ?? ''}
                        onChange={(e) => changeCustom(q, e.target.value)}
                        aria-label={t('assistant.choiceOther')}
                        placeholder={t('assistant.choiceOtherPlaceholder')}
                        className="mt-1 w-full bg-transparent pl-5 text-[10px] leading-relaxed text-ink outline-none placeholder:text-ink-2/45"
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onResolve({ answers: [], skipped: true })}
          className="px-1 py-1 text-[9px] text-ink-2 transition-opacity hover:opacity-70"
        >
          {t('assistant.choiceSetSkipAll')}
        </button>
        <span className="text-[8.5px] tabular-nums text-ink-2/70">
          {answeredCount}/{total}
        </span>
        <button
          type="button"
          disabled={!allAnswered}
          onClick={submit}
          className="ml-auto rounded-full bg-accent px-3 py-1 text-[9.5px] font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {t('assistant.choiceSetSubmit')}
        </button>
      </div>
    </div>
  );
}
