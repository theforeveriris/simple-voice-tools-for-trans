/**
 * 原生壳启动页（与安装 PWA 的系统启动画面同款观感：底色 + 居中圆角图标）。
 *
 * 仅原生壳挂载（App 渲染 isNative 分支）——浏览器 / PWA 由 Chrome 依据 manifest
 * 生成启动画面，Tauri 桌面无此需求。显示与否在挂载瞬间从 store 读取一次
 * （zustand persist 对 localStorage 是同步恢复，首帧即正确）：关闭则整段不
 * 渲染；会话中途切换设置不影响本次，下次启动生效。最短驻留后淡出移除。
 */
import { useEffect, useState } from 'react';
import { useStore } from '@/store/useStore';
import { readDiscreetHint } from '@/lib/security/store';

/** 最短驻留：保证品牌页可见（系统启动画面同样有最短展示） */
const MIN_DISPLAY_MS = 900;
const FADE_MS = 300;

export function SplashScreen() {
  const [show] = useState(() => useStore.getState().settings.splashScreen);
  const [discreet] = useState(() => readDiscreetHint() !== 'normal');
  const [phase, setPhase] = useState<'show' | 'fade' | 'gone'>(show ? 'show' : 'gone');

  useEffect(() => {
    if (!show) return;
    const hide = setTimeout(() => setPhase('fade'), MIN_DISPLAY_MS);
    const gone = setTimeout(() => setPhase('gone'), MIN_DISPLAY_MS + FADE_MS);
    return () => {
      clearTimeout(hide);
      clearTimeout(gone);
    };
  }, [show]);

  if (phase === 'gone') return null;
  return (
    <div
      aria-hidden
      className="fixed inset-0 z-[200] grid place-items-center bg-surface"
      style={{ opacity: phase === 'fade' ? 0 : 1, transition: `opacity ${FADE_MS}ms ease-out` }}
    >
      {discreet ? (
        <div className="grid size-[min(46vmin,240px)] place-items-center rounded-[22%] bg-[#394150] shadow-[0_10px_44px_rgba(28,25,45,0.18)]">
          <svg viewBox="0 0 24 24" className="w-[46%]" aria-hidden>
            <path
              d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </div>
      ) : (
        <img
          src="icon-512.png"
          alt=""
          className="w-[min(58vmin,320px)] rounded-[18%] shadow-[0_10px_44px_rgba(96,78,168,0.16),0_2px_12px_rgba(96,78,168,0.08)]"
        />
      )}
    </div>
  );
}
