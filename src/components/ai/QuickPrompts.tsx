/**
 * 空会话的快捷提问：根据本地历史记录生成 4 个问题。
 * 点一下只把问题填进输入框（不自动发送），用户可以改完再发。
 * 设计取向：单卡片内分隔行，长度可随 AI 生成的问题变化。
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
    <div className="w-full max-w-sm">
      <div className="grid grid-cols-2 gap-2">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onPick(item.text)}
            className="flex min-h-[3.6rem] flex-col items-start gap-1 rounded-2xl bg-card px-3 py-2 text-left text-[11px] leading-snug text-ink shadow-[0_2px_10px_rgba(28,25,45,0.04)] transition-transform active:scale-[0.98]"
          >
            <span>{item.text}</span>
            <span className="text-[9px] leading-snug text-ink-2">{item.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
