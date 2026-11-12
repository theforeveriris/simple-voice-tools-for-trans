/**
 * 会话级解锁标记。
 *
 * 目标：刷新页面保持解锁，但新标签 / 冷启动必须重新锁。
 * - sessionStorage 只在当前标签页生命周期内存在；
 * - 用 navigation type 区分「刷新」与「新开/复制标签」；
 * - 后台超过 5 分钟由 lifecycle 锁，不依赖这里。
 */

import { AUTO_LOCK_MS } from './attempts';

const UNLOCK_KEY = 'svt:security:unlockedAt';
const HIDDEN_KEY = 'svt:security:hiddenAt';

function navigationType(): string {
  try {
    const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return entry?.type ?? 'navigate';
  } catch {
    return 'navigate';
  }
}

export function markUnlocked(now = Date.now()): void {
  try {
    sessionStorage.setItem(UNLOCK_KEY, String(now));
    sessionStorage.removeItem(HIDDEN_KEY);
  } catch {
    /* private mode / storage disabled */
  }
}

export function clearUnlocked(): void {
  try {
    sessionStorage.removeItem(UNLOCK_KEY);
    sessionStorage.removeItem(HIDDEN_KEY);
  } catch {
    /* ignore */
  }
}

/** 仅刷新时恢复；新标签、冷启动、复制标签都重新锁 */
export function canResumeSession(now = Date.now()): boolean {
  try {
    const at = Number(sessionStorage.getItem(UNLOCK_KEY) ?? 0);
    if (!at || !Number.isFinite(at)) return false;
    if (now - at > AUTO_LOCK_MS) return false;
    return navigationType() === 'reload';
  } catch {
    return false;
  }
}

export function markHidden(now = Date.now()): void {
  try {
    sessionStorage.setItem(HIDDEN_KEY, String(now));
  } catch {
    /* ignore */
  }
}

export function hiddenSince(): number {
  try {
    return Number(sessionStorage.getItem(HIDDEN_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

export function clearHidden(): void {
  try {
    sessionStorage.removeItem(HIDDEN_KEY);
  } catch {
    /* ignore */
  }
}
