/**
 * 「本次注入」面板：列出这条回答实际带进提示词的记录与内置文档。
 * 现在并入「思考过程」的展开区域，不再单独占一行 chip。
 * 数据来自生成时写入消息的 ChatContextMeta，不重新计算提示词。
 */

import { useMemo, useState } from 'react';
import { Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import type { ChatContextMeta } from '@/lib/llmChats';
import type { AnalysisRecord } from '@/types';
import { useHistoryStore } from '@/store/useHistoryStore';
import { useStore } from '@/store/useStore';
import { deleteMemory, updateMemory, useMemories } from '@/lib/memory';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';

/** 面板里最多逐条列出多少条记录（其余只给计数） */
const MAX_ROWS = 8;

const KIND_KEY = {
  fact: 'settings.memoryKindFact',
  preference: 'settings.memoryKindPreference',
  requirement: 'settings.memoryKindRequirement',
  caution: 'settings.memoryKindCaution',
} as const;

function recordLabel(r: AnalysisRecord): string {
  const d = new Date(r.createdAt);
  const mode = t(`mode.${r.mode ?? 'reading'}`);
  return `${d.getMonth() + 1}/${d.getDate()} · ${mode}`;
}

/** 合并固定记录与明细记录，去重 */
function contextIds(meta: ChatContextMeta): string[] {
  const pinned = Array.isArray(meta.pinnedIds) ? meta.pinnedIds : [];
  const detail = Array.isArray(meta.recordIds) ? meta.recordIds : [];
  return [...new Set([...pinned, ...detail])];
}

export function ContextPanel({ meta }: { meta: ChatContextMeta }) {
  useI18n();
  const records = useHistoryStore((s) => s.records);
  const setCurrentAnalysis = useStore((s) => s.setCurrentAnalysis);
  const setTab = useStore((s) => s.setTab);

  const ids = useMemo(() => contextIds(meta), [meta]);
  const docs = Array.isArray(meta.docs) ? meta.docs : [];
  const memories = meta.memories ?? 0;
  const memoryQuery = meta.memoryQuery?.trim();
  const allMemories = useMemories();
  const memoryItems = useMemo(() => {
    const byId = new Map(allMemories.map((memory) => [memory.id, memory]));
    return [...new Set(meta.memoryIds ?? [])]
      .map((id) => byId.get(id))
      .filter((memory): memory is NonNullable<typeof memory> => !!memory);
  }, [allMemories, meta.memoryIds]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const toolCalls = meta.toolCalls ?? [];
  const numericCheck = meta.numericCheck;
  const byId = useMemo(() => new Map(records.map((r) => [r.id, r])), [records]);
  const hidden = Math.max(0, (meta.totalRecords ?? 0) - ids.length);

  if (
    ids.length === 0
    && docs.length === 0
    && memories === 0
    && memoryItems.length === 0
    && !memoryQuery
    && toolCalls.length === 0
    && !numericCheck
  ) return null;

  return (
    <div onClick={(e) => e.stopPropagation()}>
      {ids.slice(0, MAX_ROWS).map((id) => {
        const r = byId.get(id);
        if (!r) {
          return (
            <p key={id} className="py-1 text-[11px] text-ink-2/60">
              {t('assistant.ctx.deleted')}
            </p>
          );
        }
        return (
          <button
            key={id}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setCurrentAnalysis(r);
              setTab('analysis');
            }}
            aria-label={t('assistant.ctx.openRecord')}
            className="flex w-full items-center gap-1.5 rounded-lg px-0 py-1 text-left text-[11px] transition-colors hover:bg-surface-hi/60"
          >
            <span className="shrink-0 rounded bg-accent-soft/60 px-1 py-0.5 text-[9px] text-on-accent-soft">
              {t('assistant.ctx.recordTag')}
            </span>
            <span className="min-w-0 flex-1 truncate text-ink">{recordLabel(r)}</span>
            <span className="shrink-0 tabular-nums text-ink-2">
              {Math.round(r.stats.avgF0)} Hz · {Math.round(r.durationSec)}s
            </span>
          </button>
        );
      })}

      {docs.map((d, i) => (
        <p key={`${d.title}-${i}`} className="flex items-center gap-1.5 px-0 py-1 text-[11px]">
          <span className="shrink-0 rounded bg-surface-hi px-1 py-0.5 text-[9px] text-ink-2">
            {t('assistant.ctx.docTag')}
          </span>
          <span className="min-w-0 flex-1 truncate text-ink">{d.title}</span>
          <span className="shrink-0 tabular-nums text-ink-2">{t('assistant.ctx.chars', { n: d.chars })}</span>
        </p>
      ))}

      {(memoryItems.length > 0 || memories > 0 || memoryQuery) && (
        <div className="px-0 py-1 text-[11px]">
          {memoryItems.length > 0 ? (
            <div className="space-y-1">
              {memoryItems.map((memory) => (
                <div key={memory.id} className="rounded-lg border border-line/40 px-2 py-1.5">
                  <div className="flex items-start gap-1.5">
                    <span className="shrink-0 rounded bg-surface-hi px-1 py-0.5 text-[9px] text-ink-2">
                      {t('assistant.ctx.memoryTag')}
                    </span>
                    {editingId === memory.id ? (
                      <input
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        aria-label={t('settings.memoryEditTitle')}
                        className="min-w-0 flex-1 rounded border border-line/60 bg-transparent px-1 py-0.5 text-[11px] text-ink outline-none"
                      />
                    ) : (
                      <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-ink">{memory.text}</span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-1 pl-1">
                    <span className="text-[9px] text-ink-2/70">
                      {t(KIND_KEY[memory.kind])}
                      {memory.pinned ? ` · ${t('settings.memoryPin')}` : ''}
                    </span>
                    {editingId === memory.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            void updateMemory(memory.id, { text: editText });
                            setEditingId(null);
                          }}
                          className="ml-auto rounded px-1.5 py-0.5 text-[9px] text-accent"
                        >
                          {t('common.save')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="rounded px-1.5 py-0.5 text-[9px] text-ink-2"
                        >
                          {t('common.cancel')}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          aria-label={memory.pinned ? t('settings.memoryUnpin') : t('settings.memoryPin')}
                          title={memory.pinned ? t('settings.memoryUnpin') : t('settings.memoryPin')}
                          onClick={() => { void updateMemory(memory.id, { pinned: !memory.pinned }); }}
                          className="ml-auto rounded p-0.5 text-ink-2 transition-colors hover:text-accent"
                        >
                          {memory.pinned ? <PinOff size={11} /> : <Pin size={11} />}
                        </button>
                        <button
                          type="button"
                          aria-label={t('settings.memoryEditTitle')}
                          title={t('settings.memoryEditTitle')}
                          onClick={() => { setEditingId(memory.id); setEditText(memory.text); }}
                          className="rounded p-0.5 text-ink-2 transition-colors hover:text-accent"
                        >
                          <Pencil size={11} />
                        </button>
                        <button
                          type="button"
                          aria-label={t('common.delete')}
                          title={t('common.delete')}
                          onClick={() => { void deleteMemory(memory.id); }}
                          className="rounded p-0.5 text-ink-2 transition-colors hover:text-error"
                        >
                          <Trash2 size={11} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="flex items-center gap-1.5">
              <span className="shrink-0 rounded bg-surface-hi px-1 py-0.5 text-[9px] text-ink-2">
                {t('assistant.ctx.memoryTag')}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink">
                {memories > 0
                  ? t('assistant.ctx.memoryCount', { n: memories })
                  : t('assistant.ctx.memoryNone')}
              </span>
            </p>
          )}
          {memoryQuery && (
            <p className="mt-0.5 pl-1 text-[10px] leading-relaxed text-ink-2/70">
              {t('assistant.ctx.memoryQuery', { q: memoryQuery })}
            </p>
          )}
        </div>
      )}

      {toolCalls.length > 0 && (
        <div className="px-0 py-1">
          {toolCalls.map((tool, i) => (
            <p key={`${tool.name}-${i}`} className="flex items-center gap-1.5 py-1 text-[11px]">
              <span className="shrink-0 rounded bg-surface-hi px-1 py-0.5 font-mono text-[9px] text-ink-2">
                {tool.name}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink">{tool.summary}</span>
              {!tool.ok && (
                <span className="shrink-0 text-[9px] text-red-500">{t('assistant.ctx.toolFailed')}</span>
              )}
              <span className="shrink-0 tabular-nums text-ink-2">{tool.ms}ms</span>
            </p>
          ))}
        </div>
      )}

      {numericCheck && (
        <p className="flex items-center gap-1.5 px-0 py-1 text-[11px]">
          <span className="shrink-0 rounded bg-surface-hi px-1 py-0.5 text-[9px] text-ink-2">
            {t('assistant.ctx.numberTag')}
          </span>
          <span className="min-w-0 flex-1 text-ink">
            {t(numericCheck === 'repaired' ? 'assistant.numericRepaired' : 'assistant.numericUnverified')}
          </span>
        </p>
      )}

      {ids.length > MAX_ROWS && (
        <p className="px-0 pt-1 text-[10px] text-ink-2/70">
          {t('assistant.ctx.more', { n: ids.length - MAX_ROWS })}
        </p>
      )}
      {hidden > 0 && (
        <p className="px-0 pt-1 text-[10px] text-ink-2/70">
          {t('assistant.ctx.aggregateOnly', { n: hidden })}
        </p>
      )}
    </div>
  );
}
