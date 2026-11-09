/**
 * 记忆（大模型配置 → 子页面，与提示词调节同级）
 * - 手动添加：事实 / 偏好 / 要求 / 注意
 * - 从最近对话提取：线索词匹配用户陈述，去重后存入，用户可再编辑
 * - 置顶：每轮都注入；其余条目按与当前问题的相关度选择
 * 记忆只存本机（kv `memory:items`），不参与设置导出。
 */

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Brain, Check, Layers, Search, SquarePen, Star, Trash2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  addMemories, clearMemories, deleteMemories, extractMemoryCandidates, restoreMemory, saveMemory,
  updateMemory, useMemories, MEMORY_KINDS, MEMORY_TEXT_MAX,
  type MemoryItem, type MemoryKind,
} from '@/lib/memory';
import { consolidateMemories } from '@/lib/memoryConsolidate';
import { useActiveLlmConfig } from '@/lib/llmProfiles';
import { useStore } from '@/store/useStore';
import { useChats } from '@/lib/llmChats';
import { t } from '@/i18n';
import type { DictKey } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Switch, Textarea } from '@/components/ui';
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
  const [consolidating, setConsolidating] = useState(false);
  const [query, setQuery] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const memoryAutoSave = useStore((s) => s.settings.memoryAutoSave);
  const activeProfileId = useStore((s) => s.settings.llmActiveProfileId);
  const auxProfileId = useStore((s) => s.settings.llmAuxProfileId);
  const mainCfg = useActiveLlmConfig(activeProfileId);
  const auxCfg = useActiveLlmConfig(auxProfileId);
  const cfg = auxCfg ?? mainCfg;
  const updateSettings = useStore((s) => s.updateSettings);

  /** 只展示 active；已合并 / 已过期进入历史区 */
  const history = useMemo(
    () => memories.filter((m) => (m.status ?? 'active') !== 'active'),
    [memories],
  );

  /** 置顶在前，其余按最近更新；搜索时按正文过滤 */
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...memories]
      .filter((m) => (m.status ?? 'active') === 'active')
      .filter((m) => !q || m.text.toLowerCase().includes(q) || (m.source?.quote ?? '').toLowerCase().includes(q))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  }, [memories, query]);

  const iconBtn =
    'grid size-9 place-items-center rounded-full bg-card text-ink shadow-[0_2px_14px_rgba(28,25,45,0.05),0_1px_3px_rgba(28,25,45,0.04)] transition-transform active:scale-90';

  const add = () => {
    const value = text.trim();
    if (!value) return;
    void saveMemory({ text: value, kind }).then((res) => {
      if (res && res.action !== 'duplicate') {
        setText('');
        toast.success(t('settings.memoryAdded'));
      } else {
        toast.error(t('settings.memoryDuplicate'));
      }
    });
  };

  const removeOne = (m: MemoryItem) => {
    void deleteMemories([m.id]).then((removed) => {
      if (removed.length === 0) return;
      toast.success(t('settings.memoryDeleted'), {
        action: {
          label: t('common.undo'),
          onClick: () => {
            for (const r of removed) void restoreMemory(r);
          },
        },
      });
    });
  };

  const consolidate = async () => {
    if (!cfg || consolidating) return;
    setConsolidating(true);
    try {
      const result = await consolidateMemories(cfg);
      if (result.merged > 0) {
        toast.success(t('settings.memoryConsolidated', { n: result.merged }));
      } else {
        toast.message(t('settings.memoryNoConsolidate'));
      }
    } catch {
      toast.error(t('settings.memoryConsolidateFailed'));
    } finally {
      setConsolidating(false);
    }
  };

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const removeSelected = () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    void deleteMemories(ids).then((removed) => {
      setSelected(new Set());
      if (removed.length === 0) return;
      toast.success(t('settings.memoryDeleted'), {
        action: {
          label: t('common.undo'),
          onClick: () => {
            for (const r of removed) void restoreMemory(r);
          },
        },
      });
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

        {/* 自动保存开关 */}
        <SettingsSection icon={Brain} title={t('settings.memoryAutoSave')}>
          <div className="flex items-start justify-between gap-3 px-0.5 py-1">
            <p className="max-w-[75%] text-[11px] leading-relaxed text-ink-2">
              {t('settings.memoryAutoSaveDesc')}
            </p>
            <Switch
              checked={memoryAutoSave !== 'off'}
              onCheckedChange={(v) => updateSettings({ memoryAutoSave: v ? 'auto' : 'off' })}
              aria-label={t('settings.memoryAutoSave')}
            />
          </div>
        </SettingsSection>

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
            <div className="relative flex-1">
              <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-2/60" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('settings.memorySearch')}
                aria-label={t('settings.memorySearch')}
                className="w-full rounded-full bg-surface-hi/70 py-1.5 pl-7 pr-2 text-[11px] text-ink outline-none placeholder:text-ink-2/60"
              />
            </div>
            {list.length > 0 && (
              <button
                onClick={() => {
                  setSelectMode((v) => !v);
                  setSelected(new Set());
                }}
                className={cn(
                  'px-1 py-1 text-[11px] font-medium transition-opacity hover:opacity-70',
                  selectMode ? 'text-accent' : 'text-ink-2',
                )}
              >
                {selectMode ? t('common.cancel') : t('settings.memorySelect')}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 px-0.5 pb-1">
            <button
              onClick={extract}
              disabled={extracting || !chats || chats.length === 0}
              className="flex items-center gap-1.5 rounded-full bg-surface-hi px-3 py-1.5 text-[11px] font-medium text-ink transition-colors hover:text-accent disabled:opacity-40"
            >
              <Wand2 size={12} />
              {extracting ? t('settings.memoryExtracting') : t('settings.memoryExtract')}
            </button>
            <button
              onClick={() => void consolidate()}
              disabled={!cfg || consolidating || list.length < 2}
              title={cfg ? t('settings.memoryConsolidate') : t('settings.memoryConsolidateNeedModel')}
              className="flex items-center gap-1.5 rounded-full bg-surface-hi px-3 py-1.5 text-[11px] font-medium text-ink transition-colors hover:text-accent disabled:opacity-40"
            >
              <Layers size={12} />
              {consolidating ? t('settings.memoryConsolidating') : t('settings.memoryConsolidate')}
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

          {selectMode && selected.size > 0 && (
            <div className="mb-1 flex items-center gap-2 rounded-xl bg-surface-hi/60 px-2 py-1.5">
              <span className="text-[11px] text-ink-2">
                {t('settings.memorySelected', { n: selected.size })}
              </span>
              <button
                onClick={removeSelected}
                className="ml-auto rounded-full bg-red-500/10 px-2.5 py-1 text-[11px] font-medium text-red-500"
              >
                {t('settings.memoryDeleteSelected')}
              </button>
            </div>
          )}

          {list.length === 0 ? (
            <p className="px-0.5 pb-2 text-[11px] leading-relaxed text-ink-2">{t('settings.memoryEmpty')}</p>
          ) : (
            list.map((m) => (
              <div key={m.id} className="flex items-start gap-1.5 border-t border-black/[0.04] py-2.5 first:border-t-0">
                {selectMode && (
                  <button
                    onClick={() => toggleSelected(m.id)}
                    aria-label={t('settings.memorySelect')}
                    aria-pressed={selected.has(m.id)}
                    className={cn(
                      'mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border transition-colors',
                      selected.has(m.id)
                        ? 'border-accent bg-accent text-on-accent'
                        : 'border-line text-transparent',
                    )}
                  >
                    <Check size={11} />
                  </button>
                )}
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
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] text-ink-2/70">
                    <span>{new Date(m.updatedAt).toLocaleDateString()}</span>
                    {m.source?.quote && (
                      <span className="min-w-0 truncate">
                        {t('settings.memorySource', { quote: m.source.quote })}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => openEdit(m)}
                  aria-label={t('settings.memoryEditTitle')}
                  className="grid size-6 shrink-0 place-items-center rounded-full text-ink-2 transition-colors hover:text-ink"
                >
                  <SquarePen size={13} />
                </button>
                <button
                  onClick={() => removeOne(m)}
                  aria-label={t('common.delete')}
                  className="grid size-6 shrink-0 place-items-center rounded-full text-ink-2 transition-colors hover:text-[#B0532F]"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}
          {history.length > 0 && (
            <div className="mt-2 border-t border-line/40 pt-2">
              <p className="px-0.5 pb-1 text-[10px] font-medium text-ink-2">
                {t('settings.memoryHistory', { n: history.length })}
              </p>
              <div className="space-y-1">
                {history.slice(0, 12).map((m) => (
                  <div key={m.id} className="flex items-start gap-2 rounded-lg bg-surface-hi/40 px-2 py-1.5">
                    <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-ink-2 line-through decoration-line">
                      {m.text}
                    </span>
                    <button
                      type="button"
                      onClick={() => { void restoreMemory(m); }}
                      className="shrink-0 rounded px-1 py-0.5 text-[10px] text-accent"
                    >
                      {t('common.restore')}
                    </button>
                  </div>
                ))}
              </div>
            </div>
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
