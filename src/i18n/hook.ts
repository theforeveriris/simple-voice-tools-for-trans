/**
 * useI18n：React 订阅语言设置的钩子
 * 订阅 settings.language，语言变化时触发组件重渲染；
 * AI 翻译词典的注册 / 更新（不走 settings）经词典版本号同步触发；
 * 核心模块（图表画笔等非 React 代码）直接 import { t } 即可。
 *
 * 统一约定：本 hook 仅作订阅用，返回 void；
 * 组件内一律从 '@/i18n' 导入模块级 t 取词（全项目 1400+ 处的既有惯用法）。
 */

import { useEffect, useSyncExternalStore } from 'react';
import { useStore } from '@/store/useStore';
import { getI18nVersion, getLocale, setLocale, subscribeI18n } from './index';

export function useI18n(): void {
  const language = useStore((s) => s.settings.language);
  // 渲染期同步模块级 locale（幂等）：保证本次渲染就用上新词典，
  // effect 仅兜底外部直改设置的场景
  if (getLocale() !== language) setLocale(language);
  useEffect(() => {
    setLocale(language);
  }, [language]);
  // AI 词典注册 / 重新生成（语言值不变）时同样重渲染
  useSyncExternalStore(subscribeI18n, getI18nVersion);
}
