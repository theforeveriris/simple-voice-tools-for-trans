/**
 * 设置页面（组合外壳，各分区与子页面实现见 src/components/settings/）
 * 仿历史页：顶部「设置 / 关于」胶囊切换 + 搜索框。
 * - 设置标签：外观 / 语言 / 录音 / 训练 / 大模型 / 数据 / 应用 / 高级 入口卡片
 *   搜索时改为展示匹配的设置项索引，点击直达对应子页面
 * - 关于标签：开发者与贡献者、应用简介、文档（AboutTab）
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Cog, DatabaseBackup, Info, Languages, Mic, Palette, Settings2, Smartphone, Target, ChevronRight, Search, Sparkles, X } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { registerBackClose } from '@/lib/backNav';
import type { AppSettings } from '@/types';
import { AdvancedPage } from '@/components/settings/AdvancedPage';
import { RecordingPage } from '@/components/settings/RecordingPage';
import { TrainingPage } from '@/components/settings/TrainingPage';
import { DataPage } from '@/components/settings/DataPage';
import { AppearancePage } from '@/components/settings/AppearancePage';
import { LanguagePage } from '@/components/settings/LanguagePage';
import { AppPage } from '@/components/settings/AppPage';
import { LlmPage } from '@/components/settings/LlmPage';
import { AboutTab } from '@/components/settings/AboutTab';
import { cn } from '@/lib/utils';
import type { DictKey } from '@/i18n';

/** 设置项搜索索引：点击结果直达对应子页面 */
type SubPage = 'appearance' | 'language' | 'recording' | 'training' | 'app' | 'data' | 'advanced' | 'llm';
const SEARCH_INDEX: { page: SubPage; sectionKey: DictKey; labelKey: DictKey }[] = [
  // 外观（主题 / 氛围彩蛋 / 图表与显示 / 花园 / 主题分享）
  { page: 'appearance', sectionKey: 'settings.theme', labelKey: 'settings.theme' },
  { page: 'appearance', sectionKey: 'settings.theme', labelKey: 'settings.huePreset' },
  { page: 'appearance', sectionKey: 'settings.theme', labelKey: 'settings.hue' },
  { page: 'appearance', sectionKey: 'settings.theme', labelKey: 'settings.accentHue' },
  { page: 'appearance', sectionKey: 'settings.theme', labelKey: 'settings.darkHue' },
  { page: 'appearance', sectionKey: 'settings.theme', labelKey: 'settings.prideFlag' },
  { page: 'appearance', sectionKey: 'settings.theme', labelKey: 'settings.voiceTint' },
  { page: 'appearance', sectionKey: 'settings.theme', labelKey: 'settings.volumeBreath' },
  { page: 'appearance', sectionKey: 'settings.bgImage', labelKey: 'settings.bgImage' },
  { page: 'appearance', sectionKey: 'settings.bgImage', labelKey: 'settings.bgImageBlur' },
  { page: 'appearance', sectionKey: 'settings.navStyle', labelKey: 'settings.navStyleFloating' },
  { page: 'appearance', sectionKey: 'settings.navStyle', labelKey: 'settings.navStyleClassic' },
  { page: 'appearance', sectionKey: 'settings.navStyle', labelKey: 'settings.navStyleAi' },
  { page: 'appearance', sectionKey: 'settings.chartDisplay', labelKey: 'settings.showGrid' },
  { page: 'appearance', sectionKey: 'settings.chartDisplay', labelKey: 'settings.syncRange' },
  { page: 'appearance', sectionKey: 'settings.chartDisplay', labelKey: 'settings.mobileSpark' },
  { page: 'appearance', sectionKey: 'settings.chartDisplay', labelKey: 'settings.liveWindow' },
  { page: 'appearance', sectionKey: 'settings.chartDisplay', labelKey: 'settings.pitchSmoothing' },
  { page: 'appearance', sectionKey: 'settings.chartDisplay', labelKey: 'settings.pitchAxis' },
  { page: 'appearance', sectionKey: 'settings.chartDisplay', labelKey: 'settings.specColormap' },
  { page: 'appearance', sectionKey: 'settings.chartDisplay', labelKey: 'settings.playbackRateSel' },
  { page: 'appearance', sectionKey: 'settings.chartDisplay', labelKey: 'settings.diaryWeekStart' },
  { page: 'appearance', sectionKey: 'settings.gardenLayout', labelKey: 'garden.colsLabel' },
  { page: 'appearance', sectionKey: 'themeShare.title', labelKey: 'themeShare.title' },
  // 语言
  { page: 'language', sectionKey: 'settings.language', labelKey: 'settings.language' },
  { page: 'language', sectionKey: 'settings.aiTranslate', labelKey: 'settings.aiTranslate' },
  // 录音
  { page: 'recording', sectionKey: 'settings.recording', labelKey: 'settings.autoEnter' },
  { page: 'recording', sectionKey: 'settings.recording', labelKey: 'settings.audioSave' },
  { page: 'recording', sectionKey: 'settings.recording', labelKey: 'settings.silenceStop' },
  { page: 'recording', sectionKey: 'settings.recording', labelKey: 'settings.maxDuration' },
  { page: 'recording', sectionKey: 'settings.recording', labelKey: 'settings.audioBitrate' },
  { page: 'recording', sectionKey: 'settings.recording', labelKey: 'settings.micEnhance' },
  { page: 'recording', sectionKey: 'settings.recording', labelKey: 'settings.splOffset' },
  { page: 'recording', sectionKey: 'settings.recording', labelKey: 'settings.haptics' },
  { page: 'recording', sectionKey: 'settings.recording', labelKey: 'settings.autoReplay' },
  { page: 'recording', sectionKey: 'settings.recording', labelKey: 'settings.mic' },
  // 训练（画像 / 靶标 / 建议 / 音区边界 / 实时视图 / 提醒）
  { page: 'training', sectionKey: 'settings.profile', labelKey: 'settings.userGoal' },
  { page: 'training', sectionKey: 'settings.profile', labelKey: 'settings.ageGroup' },
  { page: 'training', sectionKey: 'settings.training', labelKey: 'settings.targetEnable' },
  { page: 'training', sectionKey: 'settings.training', labelKey: 'settings.targetRange' },
  { page: 'training', sectionKey: 'settings.training', labelKey: 'settings.baseline' },
  { page: 'training', sectionKey: 'settings.adviceSection', labelKey: 'settings.adviceMode' },
  { page: 'training', sectionKey: 'settings.adviceSection', labelKey: 'settings.adviceOnCompare' },
  { page: 'training', sectionKey: 'settings.bandCustom', labelKey: 'settings.bandBounds' },
  { page: 'training', sectionKey: 'settings.bandCustom', labelKey: 'settings.bandReset' },
  { page: 'training', sectionKey: 'labs.realtime', labelKey: 'vowelLive.title' },
  { page: 'training', sectionKey: 'settings.reminderSection', labelKey: 'settings.reminderEnable' },
  { page: 'training', sectionKey: 'settings.reminderSection', labelKey: 'settings.reminderTime' },
  // 大模型
  { page: 'llm', sectionKey: 'settings.llmPage', labelKey: 'settings.llmModelConfig' },
  { page: 'llm', sectionKey: 'settings.llmPage', labelKey: 'settings.llmProfiles' },
  { page: 'llm', sectionKey: 'settings.llmPage', labelKey: 'settings.llmPromptEntry' },
  { page: 'llm', sectionKey: 'settings.memoryTitle', labelKey: 'settings.llmMemoryEntry' },
  { page: 'llm', sectionKey: 'settings.llmPage', labelKey: 'assistant.entry' },
  // 数据
  { page: 'data', sectionKey: 'settings.storageUsage', labelKey: 'settings.storageUsage' },
  { page: 'data', sectionKey: 'settings.importAudio', labelKey: 'settings.importAudio' },
  { page: 'data', sectionKey: 'lanSync.title', labelKey: 'lanSync.title' },
  { page: 'data', sectionKey: 'privacy.title', labelKey: 'privacy.llmLogTitle' },
  { page: 'data', sectionKey: 'settings.backupRestore', labelKey: 'settings.zipBackup' },
  { page: 'data', sectionKey: 'settings.backupRestore', labelKey: 'settings.zipRestore' },
  { page: 'data', sectionKey: 'settings.backupRestore', labelKey: 'settings.autoBackup' },
  { page: 'data', sectionKey: 'settings.backupRestore', labelKey: 'settings.autoBackupFolder' },
  { page: 'data', sectionKey: 'settings.backupRestore', labelKey: 'settings.autoBackupNow' },
  { page: 'data', sectionKey: 'settings.webdav', labelKey: 'settings.webdavUser' },
  { page: 'data', sectionKey: 'settings.ghTitle', labelKey: 'settings.ghRepo' },
  { page: 'data', sectionKey: 'settings.ghTitle', labelKey: 'settings.ghPush' },
  { page: 'data', sectionKey: 'settings.ghTitle', labelKey: 'settings.ghPull' },
  { page: 'data', sectionKey: 'settings.dataOps', labelKey: 'settings.exportJson' },
  { page: 'data', sectionKey: 'settings.dataOps', labelKey: 'settings.importJson' },
  { page: 'data', sectionKey: 'settings.dataOps', labelKey: 'settings.exportCsv' },
  { page: 'data', sectionKey: 'settings.dataOps', labelKey: 'settings.exportSettings' },
  { page: 'data', sectionKey: 'settings.dataOps', labelKey: 'settings.importSettings' },
  { page: 'data', sectionKey: 'settings.dataOps', labelKey: 'settings.loadDemo' },
  { page: 'data', sectionKey: 'settings.dataOps', labelKey: 'settings.clearAll' },
  // 应用
  { page: 'app', sectionKey: 'settings.app', labelKey: 'settings.install' },
  { page: 'app', sectionKey: 'settings.app', labelKey: 'settings.startTab' },
  { page: 'app', sectionKey: 'settings.app', labelKey: 'settings.splashScreen' },
  { page: 'app', sectionKey: 'settings.updateSection', labelKey: 'settings.checkUpdate' },
  // 高级
  { page: 'advanced', sectionKey: 'settings.labsToggles', labelKey: 'settings.showSpec' },
  { page: 'advanced', sectionKey: 'settings.labsToggles', labelKey: 'settings.liveSpectrum' },
  { page: 'advanced', sectionKey: 'settings.labsToggles', labelKey: 'labs.pitchCompare' },
  { page: 'advanced', sectionKey: 'settings.algoParams', labelKey: 'settings.algoParams' },
  { page: 'advanced', sectionKey: 'settings.algoParams', labelKey: 'settings.algoYinThreshold' },
  { page: 'advanced', sectionKey: 'settings.algoParams', labelKey: 'settings.algoPitchRange' },
  { page: 'advanced', sectionKey: 'settings.algoParams', labelKey: 'settings.algoPreEmphasis' },
  { page: 'advanced', sectionKey: 'settings.algoParams', labelKey: 'settings.algoLpcOrder' },
  { page: 'advanced', sectionKey: 'settings.algoParams', labelKey: 'settings.algoF1Min' },
  { page: 'advanced', sectionKey: 'settings.algoParams', labelKey: 'settings.algoF2Max' },
  { page: 'advanced', sectionKey: 'settings.algoParams', labelKey: 'settings.algoVoicedGate' },
  { page: 'advanced', sectionKey: 'settings.algoParams', labelKey: 'settings.algoActiveGate' },
  { page: 'advanced', sectionKey: 'settings.algoParams', labelKey: 'settings.algoVqMinProb' },
  { page: 'advanced', sectionKey: 'settings.algoParams', labelKey: 'settings.algoVqMinPeriods' },
  { page: 'advanced', sectionKey: 'settings.algoParams', labelKey: 'settings.algoCppsF0Max' },
  { page: 'advanced', sectionKey: 'settings.algoParams', labelKey: 'settings.algoCppsSmooth' },
  { page: 'advanced', sectionKey: 'labs.scripts', labelKey: 'labs.scripts' },
];

export function SettingsPage() {
  useI18n();
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  // 主视图两个标签（仿历史页 列表/趋势 的胶囊切换）
  const [view, setView] = useState<'settings' | 'about'>('settings');
  const [query, setQuery] = useState('');
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [recordingOpen, setRecordingOpen] = useState(false);
  const [trainingOpen, setTrainingOpen] = useState(false);
  const [appOpen, setAppOpen] = useState(false);
  const [llmOpen, setLlmOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);

  const update = (patch: Partial<AppSettings>) => updateSettings(patch);

  // 子页面返回手势：任一子页打开时压入一条 history（系统返回 / 侧滑 → 关闭回主视图）；
  // 子页头的返回按钮调 history.back() 走同一链路。切页签卸载本组件时清理。
  const anySubOpen = appearanceOpen || languageOpen || recordingOpen || trainingOpen || appOpen
    || llmOpen || advancedOpen || dataOpen;
  useEffect(() => {
    if (!anySubOpen) return;
    return registerBackClose(() => {
      setAppearanceOpen(false);
      setLanguageOpen(false);
      setRecordingOpen(false);
      setTrainingOpen(false);
      setAppOpen(false);
      setLlmOpen(false);
      setAdvancedOpen(false);
      setDataOpen(false);
    });
  }, [anySubOpen]);

  /** 子页头的返回按钮：经 history.back() 消费返回手势栈（popstate 关闭子页） */
  const subBack = () => () => window.history.back();

  // 子页面（设置标签 → 单行卡片入口）；open 状态不持久化，切换页签即回主视图
  if (appearanceOpen) {
    return <AppearancePage settings={settings} update={update} onBack={subBack()} />;
  }
  if (languageOpen) {
    return <LanguagePage settings={settings} update={update} onBack={subBack()} />;
  }
  if (recordingOpen) {
    return <RecordingPage settings={settings} update={update} onBack={subBack()} />;
  }
  if (trainingOpen) {
    return <TrainingPage settings={settings} update={update} onBack={subBack()} />;
  }
  if (appOpen) {
    return <AppPage settings={settings} update={update} onBack={subBack()} />;
  }
  if (llmOpen) {
    return <LlmPage settings={settings} update={update} onBack={subBack()} />;
  }
  if (dataOpen) {
    return <DataPage settings={settings} update={update} onBack={subBack()} />;
  }
  if (advancedOpen) {
    return <AdvancedPage settings={settings} update={update} onBack={subBack()} />;
  }

  // 搜索结果（仅在设置标签且输入非空时展示；过滤开销极小，无需 memo——
  // 且不可用 hook：上方子页面分支会提前 return，hooks 必须无条件调用）
  const q = query.trim().toLowerCase();
  const results = q
    ? SEARCH_INDEX.filter((e) => {
        const label = t(e.labelKey).toLowerCase();
        const section = t(e.sectionKey).toLowerCase();
        return label.includes(q) || section.includes(q);
      })
    : [];
  const searching = view === 'settings' && q.length > 0;

  /** 子页面入口卡片（历史页同款圆角卡） */
  const entry = (label: string, icon: typeof Palette, onOpen: () => void) => (
    <button
      onClick={onOpen}
      className="flex w-full items-center justify-between card-surface px-5 py-4 text-left transition-transform active:scale-[0.99]"
      aria-label={label}
    >
      <span className="flex items-center gap-2 text-sm font-semibold text-ink">
        {(() => { const Icon = icon; return <Icon size={15} className="text-accent" />; })()}
        {label}
      </span>
      <ChevronRight size={15} className="text-ink-2" />
    </button>
  );

  return (
    <div className="flex flex-col gap-3.5 pb-4">
      {/* 设置 / 关于 切换（仿历史页 列表/趋势 胶囊） */}
      <div className="flex w-fit items-center gap-0.5 rounded-full bg-card p-1 shadow-[0_2px_14px_rgba(28,25,45,0.05)]">
        {(
          [
            { id: 'settings', label: t('settings.tabSettings'), icon: Settings2 },
            { id: 'about', label: t('settings.tabAbout'), icon: Info },
          ] as const
        ).map((tab) => {
          const active = view === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => {
                setView(tab.id);
                setQuery('');
              }}
              className="relative flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-medium"
              aria-label={t('history.viewAria', { name: tab.label })}
            >
              {active && (
                <motion.span layoutId="settings-view-pill" className="absolute inset-0 rounded-full bg-accent-soft" />
              )}
              <Icon size={13} className={cn('relative z-10', active ? 'text-accent' : 'text-ink-2')} />
              <span className={cn('relative z-10', active ? 'text-accent' : 'text-ink-2')}>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {view === 'about' ? (
        <AboutTab />
      ) : (
        <>
          {/* 搜索（仿历史页搜索框；非空时展示设置项索引结果）。
              移动端 16px：iOS 对 <16px 输入框聚焦时会自动放大页面，导致无法正常使用 */}
          <div className="flex items-center gap-2 rounded-full bg-card px-4 py-2.5 shadow-[0_2px_14px_rgba(28,25,45,0.05)]">
            <Search size={14} className="shrink-0 text-ink-2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('settings.searchPlaceholder')}
              className="min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-ink-2/70 sm:text-sm"
            />
            {query && (
              <button onClick={() => setQuery('')} className="text-ink-2 hover:text-ink" aria-label={t('common.reset')}>
                <X size={14} />
              </button>
            )}
          </div>

          {searching ? (
            /* 搜索结果：设置项索引，点击直达子页面 */
            results.length === 0 ? (
              <p className="card-surface px-5 py-6 text-center text-xs text-ink-2">
                {t('history.noMatch', { q: query.trim() })}
              </p>
            ) : (
              <div className="card-surface px-5">
                {results.map((e) => (
                  <button
                    key={`${e.page}.${e.labelKey}`}
                    onClick={() => {
                      setQuery('');
                      if (e.page === 'appearance') setAppearanceOpen(true);
                      else if (e.page === 'language') setLanguageOpen(true);
                      else if (e.page === 'recording') setRecordingOpen(true);
                      else if (e.page === 'training') setTrainingOpen(true);
                      else if (e.page === 'app') setAppOpen(true);
                      else if (e.page === 'llm') setLlmOpen(true);
                      else if (e.page === 'data') setDataOpen(true);
                      else setAdvancedOpen(true);
                    }}
                    className="flex w-full items-center justify-between gap-2 border-t border-black/[0.04] py-3 text-left first:border-t-0"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{t(e.labelKey)}</span>
                      <span className="block text-[11px] text-ink-2">{t(e.sectionKey)}</span>
                    </span>
                    <ChevronRight size={15} className="shrink-0 text-ink-2" />
                  </button>
                ))}
              </div>
            )
          ) : (
            <>
              {entry(t('settings.appearance'), Palette, () => setAppearanceOpen(true))}
              {entry(t('settings.language'), Languages, () => setLanguageOpen(true))}
              {entry(t('settings.recording'), Mic, () => setRecordingOpen(true))}
              {entry(t('settings.training'), Target, () => setTrainingOpen(true))}
              {entry(t('settings.llmPage'), Sparkles, () => setLlmOpen(true))}
              {entry(t('settings.data'), DatabaseBackup, () => setDataOpen(true))}
              {entry(t('settings.app'), Smartphone, () => setAppOpen(true))}
              {entry(t('settings.advanced'), Cog, () => setAdvancedOpen(true))}
            </>
          )}
        </>
      )}
    </div>
  );
}
