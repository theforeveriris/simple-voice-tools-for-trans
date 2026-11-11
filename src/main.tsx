import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { NAV as TABS } from '@/components/settings/navItems'
import { applyTheme, prefersDark, presetSpec } from '@/lib/theme/monet'
import { applyCustomTheme, normalizeCustomTheme } from '@/lib/theme/customTheme'
import { loadBgImage } from '@/lib/theme/bgImage'
import { initPwaInstall } from '@/lib/pwa'
import { AppShortcuts, isNative, isTauri, syncNativeSystemBars } from '@/lib/platform'
import { useHistoryStore } from '@/store/useHistoryStore'
import { useStore } from '@/store/useStore'
import { runStartupSideEffects } from '@/store/startup'
import { initSecurity } from '@/lib/security/state'
import { setLocale, DEFAULT_LOCALE, LOCALES } from '@/i18n'
import { hydrateAiLocale } from '@/i18n/aiLocale'
import { getWallpaperHues } from '@/lib/theme/dynamic'
import type { Locale, ThemeMode, ViewType } from '@/types'

// 渲染前先应用持久化的主题色板与深浅模式，避免首帧闪烁
const saved = (() => {
  try {
    const raw = localStorage.getItem('svt:settings:v1');
    const parsed = raw ? (JSON.parse(raw) as { state?: { settings?: { hue?: number; accentHue?: number; darkHue?: number; theme?: ThemeMode; language?: string; huePreset?: string; prideFlag?: string; aiLanguage?: string; customTheme?: unknown } } }) : null;
    return parsed?.state?.settings ?? {};
  } catch {
    return {};
  }
})();
const dark = saved.theme === 'dark'
  || ((saved.theme ?? 'system') === 'system' && prefersDark());
// 首启判定必须在任何 updateSettings 之前（语言检测等会立即持久化设置）
const firstRun = !localStorage.getItem('svt:settings:v1');
// 旧版旗帜直接作为预设存储：收敛为 pride 预设（与 useStore 的迁移同一规则）
const LEGACY_FLAGS = ['transPride', 'nonbinary', 'genderfluid'];
const isLegacyFlag = LEGACY_FLAGS.includes(saved.huePreset ?? '');
const savedPreset = presetSpec(
  isLegacyFlag ? 'pride' : saved.huePreset,
  saved.hue ?? 15,
  isLegacyFlag ? saved.huePreset : saved.prideFlag,
  saved.accentHue ?? saved.hue ?? 15,
  saved.darkHue ?? saved.hue ?? 15,
);
applyTheme(savedPreset.hue, dark, savedPreset.accentHue, savedPreset.spec, savedPrideFlagOf(saved, isLegacyFlag))
applyCustomTheme(saved.huePreset === 'custom' ? normalizeCustomTheme(saved.customTheme) : null)
// 原生壳：状态栏/手势条底色对齐首帧主题（后续变化由 App 的主题 effect 接管）
if (isNative) syncNativeSystemBars()

// 原生壳首启：莫奈默认色相取自壁纸（Material You）——壁纸主/次/三色映射进
// 莫奈三滑条并持久化，此后配色归用户滑条接管，与手动调色无区别
if (isNative && firstRun) {
  void getWallpaperHues().then((hues) => {
    if (!hues) return
    useStore.getState().updateSettings({ hue: hues.hue, accentHue: hues.accentHue, darkHue: hues.darkHue })
    const flag = savedPrideFlagOf(saved, isLegacyFlag)
    const p = presetSpec('monet', hues.hue, flag, hues.accentHue, hues.darkHue)
    applyTheme(p.hue, dark, p.accentHue, p.spec, flag)
    syncNativeSystemBars()
  })
}

/** 迁移后的旗帜：旧预设值优先，其次已存的 prideFlag */
function savedPrideFlagOf(saved: { huePreset?: string; prideFlag?: string }, isLegacyFlag: boolean): string {
  return (isLegacyFlag ? saved.huePreset : saved.prideFlag) ?? 'transPride';
}

/** 首次启动：按浏览器语言匹配内置语言（匹配不上回退英文默认） */
function detectBrowserLocale(): Locale {
  const langs: readonly string[] = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const raw of langs) {
    const tag = raw.toLowerCase();
    if (tag === 'zh-cn' || tag === 'zh-hans') return 'zh-CN';
    if (tag === 'zh-tw' || tag === 'zh-hk' || tag === 'zh-mo' || tag === 'zh-hant') return 'zh-TW';
    if (tag.startsWith('ja')) return 'ja';
    if (tag.startsWith('es')) return 'es';
    if (tag.startsWith('fr')) return 'fr';
  }
  if (langs.some((l) => l.toLowerCase().startsWith('zh'))) return 'zh-CN';
  return DEFAULT_LOCALE;
}

// 首次启动（无保存设置）跟随浏览器语言；老用户与已显式选择的语言不受影响
if (!localStorage.getItem('svt:settings:v1')) {
  const detected = detectBrowserLocale();
  if (detected !== DEFAULT_LOCALE) {
    useStore.getState().updateSettings({ language: detected });
  }
  setLocale(detected);
} else if (saved.language === 'ai' && saved.aiLanguage && hydrateAiLocale(saved.aiLanguage)) {
  setLocale('ai')
} else {
  // 语言为 ai 但词典缺失 / 损坏（清空存储、配额回收、从别的设备导入设置），
  // 或保存的是已下线的语言（如旧版藏语 bo）：回退默认语言并写回设置，
  // 避免界面回退到基准文案但选择器里找不到对应项。
  const known = LOCALES.some((l) => l.id === saved.language);
  const fallback = known ? (saved.language as Locale) : DEFAULT_LOCALE;
  if (saved.language && !known) useStore.getState().updateSettings({ language: fallback });
  setLocale(fallback);
}

// PWA：捕获安装事件（原生/Tauri 壳内无 Web 安装流程，跳过）
if (!isNative && !isTauri) initPwaInstall()

// Service Worker：vite-plugin-pwa 的注入已在构建配置关闭（injectRegister: 'null'），
// 改为手动注册——原生壳内无 SW 支持，Tauri 自定义协议下 SW 不可靠，均跳过
if (!isNative && !isTauri) {
  void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }))
}

// 原生 app shortcuts：冷启动取暂存路由、热启动收事件，落到对应页签
// （与 PWA manifest shortcuts 同一套 #/hash 语义；setTab 会同步 location.hash）
if (isNative) {
  const applyShortcutRoute = (route: string | null | undefined) => {
    if (!route) return;
    const tab = route.replace(/^#\/?/, '') as ViewType;
    if (!TABS.includes(tab)) return;
    useStore.getState().setTab(tab);
  };
  void AppShortcuts.getInitialRoute()
    .then(({ route }) => applyShortcutRoute(route))
    .catch(() => {});
  void AppShortcuts.addListener('shortcutRoute', ({ route }) => applyShortcutRoute(route))
    .catch(() => {});
}

// 背景图片异步预加载：读取 IndexedDB 后经 opacity 过渡淡入，不阻塞首帧
void loadBgImage()

// 加载 IndexedDB 中的历史记录（含旧版 localStorage 迁移），完成后自动刷新界面
void useHistoryStore.getState().hydrate();

// 启动副作用：设置 → 模块单例同步（persist 恢复后）、API Key 的 IDB 恢复、
// v0.9.0 LLM 档案迁移。原在 useStore 模块顶层随 import 执行，现集中此处，
// 早于首帧渲染（保证画笔 / DSP 单例与设置一致），store 模块得以保持纯定义
runStartupSideEffects()

// 应用锁：异步读取 IDB 配置；LockGate 会在 ready 前显示纯色启动底
void initSecurity()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
