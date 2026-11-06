/**
 * 空会话的快捷提问：根据本地历史记录生成 4 个问题。
 * 版式：胶囊（最轻，一眼扫完）；点一下只填入输入框，不自动发送。
 * 后续接入 AI 生成时，问题长度需限制在 ~20 字以内以保持单行。
 */

import { useMemo } from 'react';
import { buildQuickPrompts } from '@/lib/assistantSuggestions';
import { useHistoryStore } from '@/store/useHistoryStore';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';

export function QuickPrompts({ onPick }: { onPick: (text: string) => void }) {
  useI18n();
  const records = useHistoryStore((s) => s.records);
  const items = useMemo(() => buildQuickPrompts(records, t), [records]);

  return (
    <div className="flex w-full max-w-sm flex-wrap justify-center gap-2">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onPick(item.text)}
          className="max-w-full rounded-full border border-line/70 bg-ink/[0.04] px-3.5 py-1.5 text-left text-[11px] leading-snug text-ink transition-colors hover:border-line hover:bg-ink/[0.07] active:scale-[0.98]"
        >
          {item.text}
        </button>
      ))}
    </div>
  );
}
