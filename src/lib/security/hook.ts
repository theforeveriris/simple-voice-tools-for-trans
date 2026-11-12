/**
 * React 绑定：读取锁状态 + 安装生命周期监听。
 */

import { useEffect, useSyncExternalStore } from 'react';
import { isNative } from '@/lib/platform';
import { AUTO_LOCK_MS } from './attempts';
import { hiddenSince } from './session';
import {
  getSecuritySnapshot,
  handleHidden,
  handleVisible,
  installNativeLifecycle,
  lockNow,
  subscribeSecurity,
} from './state';
import type { SecuritySnapshot } from './types';

export function useSecurity(): SecuritySnapshot {
  return useSyncExternalStore(subscribeSecurity, getSecuritySnapshot, getSecuritySnapshot);
}

export function useSecurityLifecycle(): void {
  const { enabled } = useSecurity();

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let nativeCleanup: (() => void) | null = null;

    // 冷启动/被系统丢弃后恢复：隐藏时间已超过阈值，直接锁
    const since = hiddenSince();
    if (since && Date.now() - since >= AUTO_LOCK_MS) lockNow();

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') handleHidden();
      else handleVisible();
    };
    const onBlur = () => handleHidden();
    const onFocus = () => handleVisible();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);

    if (isNative) {
      void installNativeLifecycle().then((cleanup) => {
        if (disposed) cleanup();
        else nativeCleanup = cleanup;
      });
    }

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      nativeCleanup?.();
    };
  }, [enabled]);
}
