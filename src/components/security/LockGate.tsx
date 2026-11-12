/**
 * 应用锁根 Gate：锁定时完全不挂载主界面，避免内容出现在截图/读屏里。
 * 初始化完成前显示纯色启动底，不闪出任何应用内容。
 */

import { useEffect, type ReactNode } from 'react';
import { useSecurity, useSecurityLifecycle } from '@/lib/security/hook';
import { stopLocalApi } from '@/lib/desktop/localApi';
import { LockScreen } from './LockScreen';
import { DecoyApp } from './DecoyApp';

/** 切后台时的全屏遮罩；不渲染任何内容，只挡住最近任务预览 */
function PrivacyMask() {
  return <div className="fixed inset-0 z-[250] bg-surface" aria-hidden />;
}

export function LockGate({ children }: { children: ReactNode }) {
  const security = useSecurity();
  useSecurityLifecycle();

  // 锁定或进入诱饵库时停掉桌面本地 API，避免只读服务继续把真实快照暴露在本机端口上
  useEffect(() => {
    if (security.locked || security.decoy) void stopLocalApi();
  }, [security.locked, security.decoy]);

  if (!security.ready) {
    return <div className="fixed inset-0 bg-surface" aria-hidden />;
  }
  if (security.locked) {
    return <LockScreen />;
  }
  // 第二 PIN：只渲染独立的空演示界面，不挂载主应用页面 / store
  if (security.decoy) {
    return <DecoyApp />;
  }
  return (
    <>
      {children}
      {security.masked && <PrivacyMask />}
    </>
  );
}
