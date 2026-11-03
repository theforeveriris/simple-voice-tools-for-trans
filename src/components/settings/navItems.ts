/**
 * 页签清单唯一来源（含顺序）：底部导航、App 深链校验（#/hash）、
 * manifest / 原生 app shortcuts、设置页「启动默认页签」下拉共用这一份。
 */

import type { ViewType } from '@/types';

export const NAV: ViewType[] = ['test', 'analysis', 'history', 'assistant', 'settings'];

export const navLabelKey: Record<ViewType, 'nav.test' | 'nav.analysis' | 'nav.history' | 'nav.assistant' | 'nav.settings'> = {
  test: 'nav.test',
  analysis: 'nav.analysis',
  history: 'nav.history',
  assistant: 'nav.assistant',
  settings: 'nav.settings',
};
