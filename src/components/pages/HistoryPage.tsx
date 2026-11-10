/**
 * 历史页面
 * 顶部「列表 / 趋势」切换：
 *   列表 — 记录卡片（可搜索、长按进入多选，多选下支持批量删除与两两对比；
 *          删除可在 5 秒内撤销）——卡片与手势见 HistoryListItem.tsx
 *   趋势 — 跨记录趋势图（平均基频 + P10–P90 音域随日期变化），
 *          支持按测试模式过滤 —— 见 HistoryTrendView.tsx
 * 点击任意记录进入对应分析页。
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Trash2,
  Search, ListFilter, TrendingUp, GitCompareArrows, X, ListChecks, History, Flower2,
} from 'lucide-react';
import { useHistoryStore } from '@/store/useHistoryStore';
import { useStore } from '@/store/useStore';
import { createDemoRecord } from '@/lib/audio/demo';
import { envInsights } from '@/lib/envInsights';
import { WeeklyReportCard } from '@/components/history/WeeklyReportCard';
import { GardenView } from '@/components/flowers/GardenView';
import { CompareSheet } from './CompareSheet';
import { RecordCard } from './HistoryListItem';
import { removeWithUndo } from './historyActions';
import { HistoryTrendView } from './HistoryTrendView';
import { MAX_HISTORY } from '@/constants';
import { t, getI18nVersion } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { localeTag } from '@/i18n';
import type { AnalysisRecord } from '@/types';
import { cn } from '@/lib/utils';
import { EmptyHero, EMPTY_PRIMARY, EMPTY_SECONDARY } from '@/components/layout/EmptyHero';
import { useDeferredMount } from '@/hooks/useDeferredMount';
import { registerBackClose } from '@/lib/backNav';
import { isLuaFilter, luaFilterExpr, luaFilterRecords, recordView } from '@/lib/lua/filter';
import { buildLuaFilterCompletions, type LuaFilterCompletion } from '@/lib/lua/completions';

/** Lua 过滤器 hook：表达式（去 lua: 前缀后）→ 命中 id 集合 + 首条错误。
 *  空表达式不进 effect（渲染期短路返回全命中）；异步结果按表达式内容落定。 */
function useLuaFilter(expr: string, records: AnalysisRecord[]): [Set<string> | null, string | null] {
  const [state, setState] = useState<{ expr: string; hits: Set<string>; error: string | null } | null>(null);
  useEffect(() => {
    if (!expr) return;
    let alive = true;
    void luaFilterRecords(records, expr).then((res) => {
      if (alive) setState({ expr, hits: res.hits, error: res.error });
    });
    return () => { alive = false; };
  }, [expr, records]);
  if (!expr) return [null, null];
  // 结果尚未到达（或属于旧表达式）：视为零命中，UI 显示空列表而非闪烁旧结果
  return state && state.expr === expr ? [state.hits, state.error] : [new Set(), null];
}

/** 环境洞察横幅：扫描记录的 env 元数据，有显著差异才出现（最多 2 条） */
function EnvInsightsBanner({ records }: { records: AnalysisRecord[] }) {
  const insights = useMemo(() => envInsights(records), [records]);
  if (insights.length === 0) return null;
  return (
    <div className="card-surface p-4">
      <p className="mb-1.5 px-0.5 text-xs font-semibold text-ink">{t('envInsight.title')}</p>
      <ul className="flex flex-col gap-1">
        {insights.map((x) => (
          <li key={x.key} className="px-0.5 text-xs leading-relaxed text-ink-2">
            {t(x.key, x.params)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyHistory() {
  const setTab = useStore((s) => s.setTab);
  const setCurrentAnalysis = useStore((s) => s.setCurrentAnalysis);
  const addRecord = useHistoryStore((s) => s.addRecord);

  const loadDemo = () => {
    const demo = createDemoRecord();
    addRecord(demo);
    setCurrentAnalysis(demo);
  };

  return (
    <EmptyHero
      /* -mt 抵消上方「列表/趋势」切换胶囊 + 间距，使图标与分析页落在屏幕同一位置 */
      className="-mt-[50px]"
      icon={<History size={26} strokeWidth={1.5} />}
      title={t('history.emptyTitle')}
      desc={t('history.emptyDesc')}
      primary={
        <button onClick={() => setTab('test')} className={EMPTY_PRIMARY}>
          {t('common.goTest')}
        </button>
      }
      secondary={
        <button onClick={loadDemo} className={EMPTY_SECONDARY}>
          {t('common.loadDemo')}
        </button>
      }
    />
  );
}

export function HistoryPage() {
  useI18n();
  const records = useHistoryStore((s) => s.records);
  const totalCount = useHistoryStore((s) => s.totalCount);
  const removeRecord = useHistoryStore((s) => s.removeRecord);
  const addRecord = useHistoryStore((s) => s.addRecord);
  const getAudio = useHistoryStore((s) => s.getAudio);
  const setCurrentAnalysis = useStore((s) => s.setCurrentAnalysis);
  const setTab = useStore((s) => s.setTab);
  const showGarden = useStore((s) => s.settings.showGarden);

  const [view, setView] = useState<'list' | 'trend' | 'garden'>('list');
  /** 花园入口关闭时，即使 state 仍停在 garden，也回退到列表 */
  const effectiveView = view === 'garden' && !showGarden ? 'list' : view;
  const [query, setQuery] = useState('');
  /** Lua 补全菜单：焦点 / 选中项 / Esc 关闭 */
  const [searchFocused, setSearchFocused] = useState(false);
  const [luaCompletionIndex, setLuaCompletionIndex] = useState(0);
  const [luaCompletionDismissed, setLuaCompletionDismissed] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [comparePair, setComparePair] = useState<[AnalysisRecord, AnalysisRecord] | null>(null);
  const contentReady = useDeferredMount();

  // 对比浮层的返回手势：系统返回 / 侧滑关闭对比，浮层内返回按钮走 history.back()
  useEffect(() => {
    if (!comparePair) return;
    return registerBackClose(() => setComparePair(null));
  }, [comparePair]);
  const searchRef = useRef<HTMLInputElement>(null);

  const open = (record: AnalysisRecord) => {
    setCurrentAnalysis(record);
    setTab('analysis');
  };

  // 搜索命中串含本地化模式名与日期：语言切换（i18n 版本 bump）后重算
  const i18nVer = getI18nVersion();
  // lua: 前缀 → Lua 表达式过滤（异步）；否则普通子串搜索
  const luaMode = isLuaFilter(query);
  const [luaHits, luaError] = useLuaFilter(luaMode ? luaFilterExpr(query) : '', records);
  const filtered = useMemo(() => {
    if (luaMode) {
      return luaHits ? records.filter((r) => luaHits.has(r.id)) : [];
    }
    const q = query.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) => {
      const hay = [
        r.note ?? '',
        r.mode ? t(`mode.${r.mode}`) : '',
        new Date(r.createdAt).toLocaleString(localeTag()),
        r.stats.avgF0.toFixed(0),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- i18nVer 是有意依赖：语言切换后重算本地化搜索串
  }, [records, query, i18nVer, luaMode, luaHits]);

  /** Lua 过滤补全：字段示例值取当前列表第一条记录 */
  const luaCompletions = useMemo(
    () => buildLuaFilterCompletions(query, records[0] ? recordView(records[0]) : undefined),
    [query, records],
  );
  const showLuaCompletions = searchFocused && !luaCompletionDismissed && luaCompletions.length > 0;
  const luaListId = 'history-lua-completions';
  const activeLuaId = showLuaCompletions ? `history-lua-${luaCompletionIndex}` : undefined;

  const applyLuaCompletion = (item: LuaFilterCompletion) => {
    setQuery(item.insert);
    setLuaCompletionIndex(0);
    // 前缀补全后继续展示字段；选中字段 / 示例后收起，等下一次输入再打开
    setLuaCompletionDismissed(item.kind !== 'prefix');
    requestAnimationFrame(() => {
      const input = searchRef.current;
      input?.focus();
      input?.setSelectionRange(item.insert.length, item.insert.length);
    });
  };

  const onSearchKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!showLuaCompletions) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setLuaCompletionIndex((i) => (i + 1) % luaCompletions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setLuaCompletionIndex((i) => (i - 1 + luaCompletions.length) % luaCompletions.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      applyLuaCompletion(luaCompletions[luaCompletionIndex] ?? luaCompletions[0]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setLuaCompletionDismissed(true);
    }
  };

  const toggleSelect = (id: string) => {    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const enterSelection = (id?: string) => {
    setSelectionMode(true);
    setSelectedIds(new Set(id ? [id] : []));
  };

  const exitSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const remove = (record: AnalysisRecord) => {
    void removeWithUndo([record], { removeRecord, addRecord, getAudio });
  };

  const batchRemove = () => {
    const picked = records.filter((r) => selectedIds.has(r.id));
    exitSelection();
    void removeWithUndo(picked, { removeRecord, addRecord, getAudio });
  };

  const tryCompare = () => {
    const picked = records.filter((r) => selectedIds.has(r.id));
    if (picked.length !== 2) return;
    const [a, b] = [...picked].sort((x, y) => x.createdAt - y.createdAt);
    setComparePair([a, b]);
  };

  // 键盘操作（长按手势的等价操作 + 效率快捷键）：
  // / 聚焦搜索；多选模式下 Esc 退出、Ctrl/⌘+A 全选、Delete 批量删除（可撤销）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target
        && (target.tagName === 'INPUT'
          || target.tagName === 'TEXTAREA'
          || target.tagName === 'SELECT'
          || target.isContentEditable);
      if (e.key === '/' && !typing && effectiveView === 'list' && !selectionMode) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (!selectionMode || typing) return;
      if (e.key === 'Escape') {
        exitSelection();
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        setSelectedIds(new Set(filtered.map((r) => r.id)));
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        batchRemove();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selectionMode, filtered]);

  return (
    <div className="flex flex-col gap-3.5">
      {/* 列表 / 趋势 切换（列表视图右侧附可见的「多选」入口，桌面端长按手势的等价操作） */}
      <div className="flex w-full items-center justify-between gap-2">
        <div className="flex w-fit items-center gap-0.5 rounded-full bg-card p-1 shadow-[0_2px_14px_rgba(28,25,45,0.05)]">
        {(
          [
            { id: 'list', label: t('history.viewList'), icon: ListFilter },
            { id: 'trend', label: t('history.viewTrend'), icon: TrendingUp },
            ...(showGarden
              ? [{ id: 'garden' as const, label: t('garden.title'), icon: Flower2 }]
              : []),
          ] as const
        ).map((tab) => {
          const active = effectiveView === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => {
                setView(tab.id);
                exitSelection();
              }}
              className="relative flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-medium"
              aria-label={t('history.viewAria', { name: tab.label })}
            >
              {active && (
                <motion.span layoutId="history-view-pill" className="absolute inset-0 rounded-full bg-accent-soft" />
              )}
              <Icon size={13} className={cn('relative z-10', active ? 'text-accent' : 'text-ink-2')} />
              <span className={cn('relative z-10', active ? 'text-accent' : 'text-ink-2')}>{tab.label}</span>
            </button>
          );
        })}
        </div>
        {effectiveView === 'list' && !selectionMode && records.length > 0 && (
          <button
            onClick={() => enterSelection()}
            aria-label={t('history.selectAria')}
            className="grid size-9 place-items-center rounded-full bg-card text-ink-2 shadow-[0_2px_14px_rgba(28,25,45,0.05)] transition-colors hover:text-ink"
          >
            <ListChecks size={16} />
          </button>
        )}
      </div>

      {/* 重内容延迟两帧挂载：页面壳（列表/趋势切换）先随入场动画绘制，
          记录卡 / 热力图 / 趋势图的挂载开销不再把入场动画阻塞成闪动 */}
      {!contentReady ? (
        <div className="min-h-[55vh]" aria-hidden />
      ) : effectiveView === 'trend' ? (
        records.length === 0 ? (
          <EmptyHistory />
        ) : (
          <>
            <EnvInsightsBanner records={records} />
            <HistoryTrendView records={records} onOpen={open} />
            {/* AI 周报（实验性 · 大模型）：聚合近 7 天出总结 */}
            <WeeklyReportCard records={records} />
          </>
        )
      ) : effectiveView === 'garden' ? (
        records.length === 0 ? (
          <EmptyHistory />
        ) : (
          <GardenView records={records} totalCount={totalCount} onOpenAnalysis={open} />
        )
      ) : records.length === 0 ? (
        <EmptyHistory />
      ) : (
        <>
          {/* 搜索框 */}
          <div className="relative flex items-center gap-2 rounded-full bg-card px-4 py-2.5 shadow-[0_2px_14px_rgba(28,25,45,0.05)]">
            <Search size={14} className="shrink-0 text-ink-2" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLuaCompletionIndex(0);
                setLuaCompletionDismissed(false);
              }}
              onFocus={() => {
                setSearchFocused(true);
                setLuaCompletionDismissed(false);
              }}
              onBlur={() => setSearchFocused(false)}
              onKeyDown={onSearchKeyDown}
              placeholder={t('history.searchPlaceholder')}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={showLuaCompletions}
              aria-controls={showLuaCompletions ? luaListId : undefined}
              aria-activedescendant={activeLuaId}
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-ink-2/70 sm:text-sm"
            />
            {query && (
              <button
                onClick={() => {
                  setQuery('');
                  setLuaCompletionDismissed(true);
                }}
                className="text-ink-2 hover:text-ink"
                aria-label={t('common.reset')}
              >
                <X size={14} />
              </button>
            )}
            {showLuaCompletions && (
              <div
                id={luaListId}
                role="listbox"
                aria-label={t('history.luaCompletions')}
                className="no-scrollbar absolute left-0 right-0 top-full z-30 mt-2 max-h-64 overflow-y-auto overscroll-contain rounded-2xl bg-card p-1.5 shadow-[0_12px_32px_-12px_rgba(28,25,45,0.28)]"
              >
                {luaCompletions.map((c, i) => (
                  <button
                    key={c.key}
                    id={`history-lua-${i}`}
                    type="button"
                    role="option"
                    aria-selected={i === luaCompletionIndex}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setLuaCompletionIndex(i)}
                    onClick={() => applyLuaCompletion(c)}
                    className={cn(
                      'flex w-full items-start justify-between gap-3 rounded-xl px-2.5 py-2 text-left transition-colors',
                      i === luaCompletionIndex ? 'bg-accent/10' : 'hover:bg-surface-hi/60',
                    )}
                  >
                    <span
                      className={cn(
                        'min-w-0 flex-1 font-mono text-[11px] leading-snug',
                        c.kind === 'example' ? 'text-ink-2' : 'text-accent',
                      )}
                    >
                      {c.label}
                    </span>
                    {(c.kind === 'example' || c.detail) && (
                      <span className="shrink-0 text-[10px] text-ink-2/70">
                        {c.kind === 'example' ? t('history.luaExample') : c.detail}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {luaMode && luaError && (
            <p className="mx-1 mb-1 rounded-xl bg-[#D66E5B]/10 px-3 py-2 text-[11px] leading-relaxed text-[#B0532F] break-all">
              {luaError}
            </p>
          )}

          {filtered.length === 0 ? (
            <p className="py-12 text-center text-sm text-ink-2">{t('history.noMatch', { q: query })}</p>
          ) : (
            <div className="flex flex-col gap-2.5 pb-2">
              <AnimatePresence initial={false}>
                {filtered.map((record) => (
                  <RecordCard
                    key={record.id}
                    record={record}
                    selected={selectedIds.has(record.id)}
                    selectionMode={selectionMode}
                    onOpen={() => open(record)}
                    onToggleSelect={() => toggleSelect(record.id)}
                    onEnterSelection={() => enterSelection(record.id)}
                    onDelete={() => remove(record)}
                  />
                ))}
              </AnimatePresence>
              {/* 界面只渲染最近 MAX_HISTORY 条；完整数据在 IDB 中，导出/备份包含全部 */}
              {totalCount > records.length && (
                <p className="pt-1 text-center text-[10px] text-ink-2">
                  {t('history.truncated', { limit: MAX_HISTORY, total: totalCount })}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* 多选操作条 */}
      <AnimatePresence>
        {selectionMode && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            className="fixed inset-x-0 bottom-24 z-40 flex justify-center px-5"
          >
            <div className="flex items-center gap-1.5 rounded-full bg-ink py-1.5 pl-5 pr-1.5 text-card shadow-xl">
              <span className="text-xs font-medium tabular-nums">{t('history.selectedCount', { n: selectedIds.size })}</span>
              <button
                onClick={tryCompare}
                disabled={selectedIds.size !== 2}
                className={cn(
                  'ml-1 flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-opacity',
                  selectedIds.size === 2 ? 'bg-accent text-on-accent' : 'cursor-default opacity-40',
                )}
              >
                <GitCompareArrows size={13} />
                {t('history.compare')}
              </button>
              <button
                onClick={batchRemove}
                disabled={selectedIds.size === 0}
                className={cn(
                  'flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-opacity',
                  selectedIds.size > 0 ? 'bg-red-500 text-white' : 'cursor-default opacity-40',
                )}
              >
                <Trash2 size={13} />
                {t('common.delete')}
              </button>
              <button
                onClick={exitSelection}
                className="grid size-8 place-items-center rounded-full text-card/80 hover:text-card"
                aria-label={t('history.exitSelectionAria')}
              >
                <X size={15} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 对比浮层 */}
      <AnimatePresence>
        {comparePair && <CompareSheet pair={comparePair} onClose={() => window.history.back()} />}
      </AnimatePresence>
    </div>
  );
}
