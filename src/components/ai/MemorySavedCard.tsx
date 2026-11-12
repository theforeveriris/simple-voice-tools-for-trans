/**
 * AI 回答正文底部的「已记住」卡片
 * - 默认折叠成一行，点击展开明细
 * - 展开后可直接编辑 / 置顶 / 删除 / 整组撤销
 */
import { useState } from 'react';
import { Brain, ChevronDown, Pencil, Star, Trash2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { patchMessageContext } from '@/lib/llmChats';
import {
  deleteMemories,
  restoreMemory,
  undoMemoryWrite,
  updateMemory,
  useMemories,
  type MemoryItem,
  type MemoryWrite,
} from '@/lib/memory';
import { cn } from '@/lib/utils';

function actionLabel(action: MemoryWrite['action']): string | null {
  if (action === 'updated') return t('assistant.memoryChipUpdated');
  if (action === 'replaced') return t('assistant.memoryChipReplaced');
  return null;
}

export function MemorySavedCard({
  chatId,
  messageIndex,
  writes,
}: {
  chatId?: string;
  messageIndex: number;
  writes: MemoryWrite[];
}) {
  useI18n();
  const memories = useMemories();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const byId = new Map(memories.map((m) => [m.id, m]));
  const active = writes.filter((w) => w.action !== 'duplicate');
  if (active.length === 0) return null;

  const patchWrites = (next: MemoryWrite[]) => {
    if (chatId) patchMessageContext(chatId, messageIndex, { memoryWrites: next });
  };

  const removeOne = (item: MemoryItem, write: MemoryWrite) => {
    const next = active.filter((w) => w.id !== write.id);
    patchWrites(next);
    void deleteMemories([item.id]).then((removed) => {
      if (removed.length === 0) return;
      toast.success(t('assistant.memoryDeleted'), {
        action: {
          label: t('common.undo'),
          onClick: () => {
            for (const r of removed) void restoreMemory(r);
            patchWrites(active);
          },
        },
      });
    });
  };

  const togglePin = (item: MemoryItem) => {
    void updateMemory(item.id, { pinned: !item.pinned });
  };

  const beginEdit = (item: MemoryItem) => {
    setEditingId(item.id);
    setDraft(item.text);
  };

  const saveEdit = (item: MemoryItem) => {
    const text = draft.trim();
    if (!text) return;
    void updateMemory(item.id, { text }).then(() => setEditingId(null));
  };

  const undoAll = () => {
    for (const write of active) void undoMemoryWrite(write);
    patchWrites([]);
    setOpen(false);
  };

  return (
    <div className="mt-3 w-full rounded-xl border border-line/60 bg-card/80 sm:w-3/5" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-2.5 py-2 text-left"
      >
        <Brain size={10} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-ink-2">
          {t('assistant.memoryChip', { n: active.length })}
        </span>
        <ChevronDown
          size={11}
          className={cn('shrink-0 text-ink-2/60 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="border-t border-line/50 px-2.5 py-1.5">
          <div className="space-y-1">
            {active.map((write) => {
              const item = byId.get(write.id);
              const label = actionLabel(write.action);
              if (!item) {
                return (
                  <p key={write.id} className="px-0.5 text-[9px] text-ink-2/60">
                    {t('assistant.memoryChipDeleted')}
                  </p>
                );
              }
              return (
                <div key={item.id} className="py-0.5">
                  {editingId === item.id ? (
                    <div className="flex flex-col gap-1">
                      <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={2}
                        className="w-full resize-y rounded-lg border border-line bg-card px-1.5 py-1 text-[10px] leading-relaxed text-ink outline-none focus:border-accent"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="px-1 text-[9px] text-ink-2"
                        >
                          {t('common.cancel')}
                        </button>
                        <button
                          type="button"
                          onClick={() => saveEdit(item)}
                          className="rounded-full bg-accent px-2 py-0.5 text-[9px] font-medium text-on-accent"
                        >
                          {t('common.save')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-[10px] leading-[1.5] text-ink">{item.text}</p>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        {label && <span className="text-[8px] text-accent">{label}</span>}
                        <span className="text-[8px] text-ink-2/70">
                          {new Date(item.updatedAt).toLocaleDateString()}
                        </span>
                        {item.source?.quote && (
                          <span className="min-w-0 flex-1 truncate text-[8px] text-ink-2/60">
                            {t('assistant.memoryChipSource', { quote: item.source.quote })}
                          </span>
                        )}
                        <span className="ml-auto flex items-center gap-0.5 opacity-70">
                          <button
                            type="button"
                            onClick={() => togglePin(item)}
                            aria-label={t('settings.memoryPin')}
                            className={cn('grid size-5 place-items-center rounded-full text-ink-2 hover:bg-surface-hi', item.pinned && 'text-accent')}
                          >
                            <Star size={10} className={item.pinned ? 'fill-accent' : undefined} />
                          </button>
                          <button
                            type="button"
                            onClick={() => beginEdit(item)}
                            aria-label={t('common.edit')}
                            className="grid size-5 place-items-center rounded-full text-ink-2 hover:bg-surface-hi"
                          >
                            <Pencil size={10} />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeOne(item, write)}
                            aria-label={t('common.delete')}
                            className="grid size-5 place-items-center rounded-full text-ink-2 hover:bg-surface-hi hover:text-red-500"
                          >
                            <Trash2 size={10} />
                          </button>
                        </span>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex justify-end">
            <button
              type="button"
              onClick={undoAll}
              className="inline-flex items-center gap-0.5 rounded-full px-1 py-0.5 text-[8px] font-medium text-ink-2 transition-colors hover:bg-surface-hi"
            >
              <Undo2 size={9} />
              {t('assistant.memoryChipUndo')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
