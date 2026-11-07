/**
 * 记忆（大模型配置 → 子页面，与提示词调节同级）
 * - 手动添加：事实 / 偏好 / 要求 / 注意
 * - 从最近对话提取：线索词匹配用户陈述，去重后存入，用户可再编辑
 * - 置顶：每轮都注入；其余条目按与当前问题的相关度选择
 * 记忆只存本机（kv `memory:items`），不参与设置导出。
 */

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Brain, SquarePen, Star, Trash2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  addMemories, addMemory, clearMemories, deleteMemory, extractMemoryCandidates,
  updateMemory, useMemories, MEMORY_KINDS, MEMORY_TEXT_MAX,
  type MemoryItem, type MemoryKind,
} from '@/lib/memory';
import { useChats } from '@/lib/llmChats';
import { t } from '@/i18n';
import type { DictKey } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Textarea } from '@/components/ui';
import { SettingsSection } from './rows';
import { InfoTip } from './InfoTip';

const KIND_KEY: Record<MemoryKind, DictKey> = {
  fact: 'settings.memoryKindFact',
  preference: 'settings.memoryKindPreference',
  requirement: 'settings.memoryKindRequirement',
  caution: 'settings.memoryKindCaution',
};

export function MemoryPage({ onBack }: { onBack: () => void }) {
  useI18n();
  const memories = useMemories();
  const chats = useChats();
  const [text, setText] = useState('');
  const [kind, setKind] = useState<MemoryKind>('fact');
  const [editing, setEditing] = useState<MemoryItem | null>(null);
  const [editText, setEditText] = useState('');
  const [editKind, setEditKind] = useState<MemoryKind>('fact');
  const [editPinned, setEditPinned] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [extracting, setExtracting] = useState(false);

  /** 置顶在前，其余按最近更新 */
  const list = useMemo(
    () => [...memories].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt),
    [memories],
  );

  const iconBtn =
    'grid size-9 place-items-center rounded-full bg-card text-ink shadow-[0_2px_14px_rgba(28,25,45,0.05),0_1px_3px_rgba(28,25,45,0.04)] transition-transform active:scale-90';

  const add = () => {
    const value = text.trim();
    if (!value) return;
    void addMemory({ text: value, kind }).then((item) => {
      if (item) {
        setText('');
        toast.success(t('settings.memoryAdded'));
      } else {
        toast.error(t('settings.memoryDuplicate'));
      }
    });
  };

  const extract = () => {
    if (extracting) return;
    const texts = (chats ?? [])
      .slice(0, 12)
      .flatMap((c) => c.messages.filter((m) => m.role === 'user').map((m) => m.content));
    const candidates = extractMemoryCandidates(texts, 30);
    setExtracting(true);
    void addMemories(candidates)
      .then((n) => {
        if (n > 0) toast.success(t('settings.memoryExtracted', { n }));
        else toast.message(t('settings.memoryExtractEmpty'));
      })
      .finally(() => setExtracting(false));
  };

  const openEdit = (m: MemoryItem) => {
    setEditing(m);
    setEditText(m.text);
    setEditKind(m.kind);
    setEditPinned(m.pinned);
  };

  const saveEdit = () => {
    if (!editing) return;
    const value = editText.trim();
    if (!value) return;
    void updateMemory(editing.id, { text: value, kind: editKind, pinned: editPinned }).then(() => {
      setEditing(null);
      toast.success(t('settings.memorySaved'));
    });
  };

  const clearAll = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    void clearMemories().then(() => toast.success(t('settings.memoryCleared')));
  };

  const kindChip = (k: MemoryKind, active: boolean, onClick: () => void) => (
    <button
      key={k}
      onClick={onClick}
      className={cn(
        'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
        active ? 'bg-accent text-on-accent' : 'bg-surface-hi text-ink-2 hover:text-ink',
      )}
    >
      {t(KIND_KEY[k])}
    </button>
  );

  return (
    <div className="flex flex-col gap-3.5 pb-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
        className="flex flex-col gap-3.5"
      >
        {/* 子页面头：返回 + 标题 + 条数 */}
        <div className="flex items-center gap-3">
          <button onClick={onBack} aria-label={t('common.back')} className={iconBtn}>
            <ArrowLeft size={18} />
          </button>
          <p className="text-base font-semibold text-ink">{t('settings.memoryTitle')}</p>
          <span className="ml-auto text-[11px] tabular-nums text-ink-2">
            {t('settings.memoryCount', { n: list.length })}
          </span>
        </div>

        {/* 添加 */}
        <SettingsSection
          icon={Brain}
          title={<InfoTip label={t('settings.memoryAddTitle')} text={t('settings.memoryIntro')} wide />}
        >
          <div className="flex flex-col gap-2 px-0.5">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              maxLength={MEMORY_TEXT_MAX}
              placeholder={t('settings.memoryPlaceholder')}
              className="min-h-0 resize-y rounded-xl border-black/10 bg-surface-hi text-xs leading-relaxed text-ink"
            />
            <div className="flex flex-wrap items-center gap-1.5">
              {MEMORY_KINDS.map((k) => kindChip(k, kind === k, () => setKind(k)))}
              <button
                onClick={add}
                disabled={!text.trim()}
                className="ml-auto rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-on-accent transition-transform active:scale-95 disabled:opacity-40"
              >
                {t('settings.memoryAdd')}
              </button>
            </div>
          </div>
        </SettingsSection>

        {/* 记忆列表 */}
        <SettingsSection icon={SquarePen} title={t('settings.memoryList')}>
          <div className="flex items-center gap-2 px-0.5 pb-1">
            <button
              onClick={extract}
              disabled={extracting || !chats || chats.length === 0}
              className="flex items-center gap-1.5 rounded-full bg-surface-hi px-3 py-1.5 text-[11px] font-medium text-ink transition-colors hover:text-accent disabled:opacity-40"
            >
              <Wand2 size={12} />
              {extracting ? t('settings.memoryExtracting') : t('settings.memoryExtract')}
            </button>
            {list.length > 0 && (
              <button
                onClick={clearAll}
                onBlur={() => setConfirmClear(false)}
                className={cn(
                  'ml-auto px-1 py-1 text-[11px] font-medium transition-opacity hover:opacity-70',
                  confirmClear ? 'text-[#B0532F]' : 'text-ink-2',
                )}
              >
                {confirmClear ? t('settings.memoryClearConfirm') : t('settings.memoryClear')}
              </button>
            )}
          </div>

          {list.length === 0 ? (
            <p className="px-0.5 pb-2 text-[11px] leading-relaxed text-ink-2">{t('settings.memoryEmpty')}</p>
          ) : (
            list.map((m) => (
              <div key={m.id} className="flex items-start gap-1.5 border-t border-black/[0.04] py-2.5 first:border-t-0">
                <button
                  onClick={() => void updateMemory(m.id, { pinned: !m.pinned })}
                  aria-label={t('settings.memoryPin')}
                  title={t('settings.memoryPin')}
                  className={cn(
                    'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full transition-colors',
                    m.pinned ? 'text-accent' : 'text-ink-2/60 hover:text-ink-2',
                  )}
                >
                  <Star size={13} className={m.pinned ? 'fill-accent' : undefined} />
                </button>
                <div className="min-w-0 flex-1">
                  <span className="rounded-full bg-surface-hi px-1.5 py-0.5 text-[9px] text-ink-2">
                    {t(KIND_KEY[m.kind])}
                  </span>
                  <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-ink">{m.text}</p>
                </div>
                <button
                  onClick={() => openEdit(m)}
                  aria-label={t('settings.memoryEditTitle')}
                  className="grid size-6 shrink-0 place-items-center rounded-full text-ink-2 transition-colors hover:text-ink"
                >
                  <SquarePen size={13} />
                </button>
                <button
                  onClick={() => void deleteMemory(m.id)}
                  aria-label={t('common.delete')}
                  className="grid size-6 shrink-0 place-items-center rounded-full text-ink-2 transition-colors hover:text-[#B0532F]"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}
        </SettingsSection>
      </motion.div>

      {/* 编辑弹窗 */}
      <Dialog open={editing != null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="rounded-3xl border-0 bg-card sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-ink">{t('settings.memoryEditTitle')}</DialogTitle>
          </DialogHeader>
          <Textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={4}
            maxLength={MEMORY_TEXT_MAX}
            className="min-h-0 resize-y rounded-2xl border-black/10 bg-surface-hi text-xs leading-relaxed text-ink"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            {MEMORY_KINDS.map((k) => kindChip(k, editKind === k, () => setEditKind(k)))}
            <button
              onClick={() => setEditPinned((v) => !v)}
              className={cn(
                'ml-auto flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                editPinned ? 'bg-accent/15 text-accent' : 'bg-surface-hi text-ink-2',
              )}
            >
              <Star size={11} className={editPinned ? 'fill-accent' : undefined} />
              {t('settings.memoryPin')}
            </button>
          </div>
          <DialogFooter className="gap-2">
            <button
              onClick={() => setEditing(null)}
              className="px-1 py-2 text-sm font-medium text-ink-2 transition-opacity hover:opacity-70"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={saveEdit}
              disabled={!editText.trim()}
              className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {t('common.save')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
