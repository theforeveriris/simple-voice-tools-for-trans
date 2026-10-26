/**
 * 应用主组件
 * 页面切换（带过渡动画）+ 底部悬浮导航栏
 */

import { useEffect, useLayoutEffect, useRef, useState, startTransition, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Toaster, toast } from 'sonner';
import { Capacitor } from '@capacitor/core';
import { BottomBar } from '@/components/layout/BottomBar';
import { RecordingMiniView } from '@/components/layout/RecordingMiniView';
import { PageErrorBoundary } from '@/components/layout/ErrorBoundary';
import { ShortcutsHelpSheet } from '@/components/layout/ShortcutsHelpSheet';
import { SplashScreen } from '@/components/layout/SplashScreen';
import { OnboardingSheet } from '@/components/settings/OnboardingSheet';
import { TestPage } from '@/components/pages/TestPage';
import { AnalysisPage } from '@/components/pages/AnalysisPage';
import { HistoryPage } from '@/components/pages/HistoryPage';
import { SettingsPage } from '@/components/pages/SettingsPage';
import { useStore } from '@/store/useStore';
import { useHistoryStore } from '@/store/useHistoryStore';
import { applyTheme, presetSpec } from '@/lib/theme/monet';
import { startAmbientLoop, watchAuroraHours } from '@/lib/theme/ambient';
import { createDemoRecord } from '@/lib/audio/demo';
import { analyzeAudioFile, takeSharedFile, importErrorKey } from '@/lib/audio/importAudio';
import { maybeAutoBackup } from '@/lib/backup/local';
import { isNative, ShareTarget, syncNativeSystemBars, type ShareTargetBatch } from '@/lib/platform';
import { missingKeys } from '@/i18n/aiLocale';
import { useI18n } from '@/i18n/hook';
import { t } from '@/i18n';
import { checkPracticeReminder } from '@/lib/reminder';
// 页签清单（含顺序）：同时供 manifest shortcuts / 原生 app shortcuts 的深链校验使用，
// 与底部导航 / 启动默认页签共用同一份（navItems.ts）
import { NAV as TABS } from '@/components/settings/navItems';
import type { ViewType } from '@/types';

/** 由 location.hash 解析页签（#/history 形式），未知或缺失时回退测试页 */
function tabFromHash(): ViewType {
  const h = window.location.hash.replace(/^#\/?/, '');
  return (TABS as string[]).includes(h) ? (h as ViewType) : 'test';
}

// 首帧前同步一次：深链接（#/history 等）直接落到对应页签，不闪测试页；
// 无 hash 时按设置里的启动默认页签落位
{
  const initial = tabFromHash();
  if (window.location.hash) {
    if (useStore.getState().currentTab !== initial) {
      useStore.setState({ currentTab: initial });
    }
  } else {
    const start = useStore.getState().settings.startTab;
    if (start && useStore.getState().currentTab !== start) {
      useStore.setState({ currentTab: start });
    }
  }
}

// 氛围彩蛋：声音染色 / 音量呼吸的心跳引擎 + 凌晨极光（3–5 点）时段监视，
// 模块级启动一次，随应用存活
startAmbientLoop();
watchAuroraHours();

function App() {
  const currentTab = useStore((s) => s.currentTab);
  const hue = useStore((s) => s.settings.hue);
  const accentHue = useStore((s) => s.settings.accentHue);
  const darkHue = useStore((s) => s.settings.darkHue);
  const huePreset = useStore((s) => s.settings.huePreset);
  const prideFlag = useStore((s) => s.settings.prideFlag);
  const theme = useStore((s) => s.settings.theme);
  const addRecord = useHistoryStore((s) => s.addRecord);
  const setCurrentAnalysis = useStore((s) => s.setCurrentAnalysis);
  const setTab = useStore((s) => s.setTab);

  // 语言切换（同步 <html lang> 与词典）
  useI18n();

  /* ---- 两阶段页面切换 ----
   * currentTab（急迫）：底栏胶囊 / 圆球立即动画；
   * displayedTab（startTransition 低优先级）：页面内容挂载，期间保留旧页——
   * 长列表（历史 200 张卡）这类重挂载不再阻塞入场动画造成白屏闪动。
   * 新页提交瞬间（layoutEffect，首帧绘制前）瞬时回顶：
   * 滚动位置若被保留，新页高度不同会被浏览器钳制跳变；instant 覆盖
   * CSS 的 scroll-behavior:smooth，避免与入场动画叠加出二次位移。 */
  const [displayedTab, setDisplayedTab] = useState<ViewType>(currentTab);
  useEffect(() => {
    if (currentTab === displayedTab) return;
    startTransition(() => setDisplayedTab(currentTab));
  }, [currentTab, displayedTab]);
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [displayedTab]);

  /* ---- 移动端左右滑动切页 ----
   * 触摸手势（桌面鼠标不受影响）：横向位移 > 56px 且为纵向 2 倍以上判定，
   * 主导纵向即放弃（不干扰滚动）。canvas / 滑块 / 输入控件上的横向拖动是
   * 图表交互，经 data-noswipe 与元素选择器排除。 */
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    let sx = 0;
    let sy = 0;
    let lastDx = 0;
    let decided: 'h' | 'v' | null = null;
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        decided = 'v';
        return;
      }
      decided = null;
      lastDx = 0;
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
    };
    const move = (e: TouchEvent) => {
      if (decided === 'v' || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - sx;
      const dy = e.touches[0].clientY - sy;
      lastDx = dx;
      if (decided === 'h') {
        e.preventDefault(); // 已判定为翻页手势：抑制纵向滚动抖动
        return;
      }
      if ((e.target as HTMLElement).closest?.('canvas, input, textarea, select, [role="slider"], [data-noswipe]')) {
        decided = 'v';
        return;
      }
      if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 2) {
        decided = 'h';
        e.preventDefault();
      } else if (Math.abs(dy) > 24) {
        decided = 'v';
      }
    };
    const end = () => {
      if (decided !== 'h' || Math.abs(lastDx) < 56) return;
      const i = TABS.indexOf(useStore.getState().currentTab);
      const next = TABS[Math.max(0, Math.min(TABS.length - 1, i + (lastDx < 0 ? 1 : -1)))];
      if (next !== useStore.getState().currentTab) {
        navigator.vibrate?.(8);
        useStore.getState().setTab(next);
      }
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end, { passive: true });
    el.addEventListener('touchcancel', start, { passive: true });
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', start);
    };
  }, []);

  // 浏览器返回/前进键在页签间导航（页签切换的写入方向在 useStore.setTab 里同步 hash）
  useEffect(() => {
    const onHashChange = () => {
      const tab = tabFromHash();
      if (useStore.getState().currentTab !== tab) {
        useStore.getState().setTab(tab);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // 全局快捷键：1–4 切换页签；? 呼出/关闭快捷键帮助。
  // 输入控件聚焦时不接管；Space / M / Esc 等页面级按键由对应页面组件处理
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target
        && (target.tagName === 'INPUT'
          || target.tagName === 'TEXTAREA'
          || target.tagName === 'SELECT'
          || target.isContentEditable)
      ) return;
      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }
      if (shortcutsOpen) {
        // 帮助面板打开时只允许 Esc（面板自身处理）与 ?（上方已切换），屏蔽页签跳转
        if (/^[1-4]$/.test(e.key)) e.preventDefault();
        return;
      }
      if (/^[1-4]$/.test(e.key)) {
        e.preventDefault();
        useStore.getState().setTab(TABS[Number(e.key) - 1]);
        return;
      }
      // 弹窗（分享卡 / 文档 / 设置子页等）打开时 S 不触发录音
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      // S = 开始 / 停止录音（任意页签；与测试页 Space 等价的全局键位，
      // 输入控件聚焦的豁免已在函数头部统一处理）
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        const { isRecording, startRecording, stopRecording } = useStore.getState();
        if (isRecording) void stopRecording();
        else void startRecording().catch(() => toast.error(t('toast.micError')));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcutsOpen]);

  const isDark = theme === 'dark'
    || (theme === 'system'
      && typeof window !== 'undefined'
      && window.matchMedia('(prefers-color-scheme: dark)').matches);

  // 应用莫奈主题色（含深浅模式；system 下监听系统切换；预设配色改写色相来源；
  // 莫奈预设下 accentHue / darkHue 与 hue 不同时走合成 spec 生成双色调 / 独立深色铺底）
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const preset = presetSpec(huePreset, hue, prideFlag, accentHue, darkHue);
      applyTheme(preset.hue, theme === 'dark' || (theme === 'system' && mq.matches), preset.accentHue, preset.spec, prideFlag);
      // 原生壳：系统栏（状态栏/手势条）底色跟随主题（含深浅切换与自定义色相）
      syncNativeSystemBars();
    };
    apply();
    if (theme === 'system') {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [hue, accentHue, darkHue, huePreset, prideFlag, theme]);

  // 每日练习提醒：每分钟 + 回到前台时检查（到点且当天无录音 → 本地通知）
  const reminderEnabled = useStore((s) => s.settings.practiceReminderEnabled);
  const reminderTime = useStore((s) => s.settings.practiceReminderTime);
  useEffect(() => {
    if (!reminderEnabled) return;
    checkPracticeReminder(true, reminderTime);
    const timer = setInterval(() => checkPracticeReminder(true, reminderTime), 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkPracticeReminder(true, reminderTime);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reminderEnabled, reminderTime]);

  // 开发辅助：?demo=1 生成一条示例记录，便于无麦克风环境体验
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('demo') !== '1') return;
    if (useHistoryStore.getState().records.length > 0) return;
    const demo = createDemoRecord();
    addRecord(demo);
    setCurrentAnalysis(demo);
    setTab('analysis');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // AI 语言词典缺失提示：应用升级新增界面词条后，缓存词典会落后于基准，
  // 新词条回退中文——启动时提醒一次去语言子页补全
  useEffect(() => {
    const s = useStore.getState().settings;
    if (s.language !== 'ai' || !s.aiLanguage) return;
    const n = missingKeys(s.aiLanguage).length;
    if (n > 0) toast.info(t('toast.aiMissingHint', { n }));
  }, []);

  // 版本更新提示：检测到的版本号与上次见过的不一致（升级而非首装）时提示一次；
  // 更新内容卡片在 设置 → 应用 中展示（独立标记，点「知道了」清除）
  useEffect(() => {
    const seen = localStorage.getItem('svt:update-seen');
    if (seen && seen !== __APP_VERSION__) {
      toast.info(t('toast.updatedTo', { version: __APP_VERSION__ }), { duration: 8000 });
      localStorage.setItem('svt:update-notes-open', '1');
    }
    localStorage.setItem('svt:update-seen', __APP_VERSION__);
  }, []);

  // 实验性：本地自动备份的每周兜底（距上次 ≥7 天才写，未配置文件夹时为空操作）
  useEffect(() => {
    void maybeAutoBackup('launch');
  }, []);

  // 系统分享的音频文件 → 离线分析管线 → 落库并跳到分析页。
  // Web 走 PWA share target（SW 暂存），原生走 ShareTarget 插件，共用本函数
  const importSharedFile = useCallback(async (file: File) => {
    const loading = toast.loading(t('importAudio.processing'));
    try {
      const { record, audio, truncated } = await analyzeAudioFile(file);
      toast.dismiss(loading);
      useHistoryStore.getState().addRecord(record, audio ?? undefined);
      setCurrentAnalysis(record);
      setTab('analysis');
      void maybeAutoBackup('record');
      toast.success(truncated ? t('toast.importAudioTruncated') : t('toast.importAudioDone'));
    } catch (err) {
      toast.dismiss(loading);
      toast.error(t(importErrorKey(err)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PWA Share Target：系统「分享到 Simple Voice Tool for Trans」的音频文件
  // 由 Service Worker 暂存并 303 重定向回来，这里取走并走离线分析管线
  useEffect(() => {
    if (isNative || !new URLSearchParams(window.location.search).has('share-target')) return;
    // 立即清掉查询参数，刷新/回退不会重复处理
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    void (async () => {
      const file = await takeSharedFile();
      if (file) await importSharedFile(file);
    })();
  }, [importSharedFile]);

  // 原生壳的「分享到」：MainActivity 把 SEND/SEND_MULTIPLE 音频交给 ShareTarget
  // 插件（无 SW 可用）；consume() 取走应用未启动期间的积压，listener 接后续分享
  useEffect(() => {
    if (!isNative) return;
    let handle: { remove: () => Promise<void> } | null = null;
    const importNativeFile = async (path: string, name: string) => {
      try {
        const res = await fetch(Capacitor.convertFileSrc(path));
        const blob = await res.blob();
        await importSharedFile(new File([blob], name, { type: blob.type }));
      } catch {
        toast.error(t('toast.importAudioDecodeFail'));
      }
    };
    const handleBatch = async (batch: ShareTargetBatch) => {
      for (const f of batch.files) await importNativeFile(f.path, f.name);
    };
    void (async () => {
      handle = await ShareTarget.addListener('shareTargetReceived', (batch) => void handleBatch(batch));
      const { batches } = await ShareTarget.start();
      for (const b of batches) await handleBatch(b);
    })();
    return () => {
      void handle?.remove();
    };
  }, [importSharedFile]);

  return (
      <div className="app-root min-h-dvh bg-surface text-ink">
      <Toaster
        position="top-center"
        richColors
        theme={isDark ? 'dark' : 'light'}
        toastOptions={{ style: { borderRadius: '8px' } }}
      />

      {/* 原生壳启动页：浏览器/PWA 的启动画面由系统按 manifest 生成，这里只补壳内 */}
      {isNative && <SplashScreen />}

      {/* 首次打开引导：未完成时（localStorage svt:onboarded 缺失）显示一次，
          训练方向 / 年龄段 / 语言 / 主题 全部完成后标记，可手动从「跳过」关闭。
          z 高于启动页 / 底部导航，避免与启动动画叠加闪动 */}
      <OnboardingSheet />

      <main ref={mainRef} className="mx-auto w-full max-w-5xl px-5 pt-7 pb-36">
        {/*
          页面切换策略：两阶段切换（见上方注释）。旧页保留至新页就绪，
          新页仅入场动画（不做退场动画），displayedTab 为 key 触发重挂载。
        */}
        <motion.div
          key={displayedTab}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
        >
          <PageErrorBoundary pageKey={displayedTab}>
            {displayedTab === 'test' && <TestPage />}
            {displayedTab === 'analysis' && <AnalysisPage />}
            {displayedTab === 'history' && <HistoryPage />}
            {displayedTab === 'settings' && <SettingsPage />}
          </PageErrorBoundary>
        </motion.div>
      </main>

      <BottomBar />

      {/* 录音浮窗：录音中离开测试页时的全局迷你预览（计时 + 迷你音高图 + 停止） */}
      <RecordingMiniView />

      {/* 快捷键帮助（? 呼出）。面板自身渲染到 body portal，因此不用 AnimatePresence 包裹：
          关闭时直接卸载（入场动画保留），不依赖 portal 内退出动画的上报 */}
      {shortcutsOpen && <ShortcutsHelpSheet onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}

export default App;
