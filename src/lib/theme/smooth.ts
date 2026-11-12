/**
 * 主题切换的整页过渡（View Transitions API）
 *
 * 把一次 applyTheme 调用包进 document.startViewTransition：浏览器先给旧页面
 * 拍快照，回调里换完令牌后再拍新快照，新快照以按压点为圆心扩散覆盖旧页面
 * （圆形揭示）——渐变背景、Canvas、原生滚动条都被快照覆盖，避免所有颜色
 * 在同一帧硬切。
 *
 * 圆心优先级：
 *   1. 1 秒内的指针按压位置（鼠标 / 触摸 / 笔）
 *   2. 焦点控件中心（键盘操作、程序化触发）
 *   3. 视口中心（系统深浅翻转等无来源切换）
 * 半径取圆心到视口最远角的距离，保证动画结束时新页面完全盖满。
 *
 * 仅用于用户可感知的「结构性」切换（深浅模式 / 预设 / 旗帜 / 系统深浅翻转）。
 * 氛围引擎（voiceTint）每 50ms 的裸 applyTheme 不能走这里：每次调用都会重拍
 * 整页快照，连续调用会直接卡顿，且染色本就需要即时响应。
 *
 * 不支持 API / 减少动态效果 / 页面不可见时直接执行，降级为原来的即时切换。
 */

/** 最近一次指针按压位置（圆形揭示的圆心来源） */
let lastPointer: { x: number; y: number; at: number } | null = null;

if (typeof window !== 'undefined') {
  // capture：任何元素上的按压都记录，包括 Radix 弹层里的选项
  window.addEventListener('pointerdown', (e) => {
    lastPointer = { x: e.clientX, y: e.clientY, at: performance.now() };
  }, { capture: true, passive: true });
}

/** 解析圆形揭示的圆心与半径（视口坐标系，半径覆盖到最远角） */
function revealOrigin(): { x: number; y: number; r: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let x = vw / 2;
  let y = vh / 2;

  // 指针按压后 1 秒内视为本次切换的来源；更早的指针位置不可信
  if (lastPointer !== null && performance.now() - lastPointer.at < 1000) {
    x = lastPointer.x;
    y = lastPointer.y;
  } else {
    const el = document.activeElement;
    if (
      typeof HTMLElement !== 'undefined'
      && el instanceof HTMLElement
      && el !== document.body
      && el !== document.documentElement
    ) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        x = rect.left + rect.width / 2;
        y = rect.top + rect.height / 2;
      }
    }
  }

  const r = Math.hypot(Math.max(x, vw - x), Math.max(y, vh - y));
  return { x, y, r };
}

export function smoothThemeChange(apply: () => void): void {
  if (
    typeof document === 'undefined'
    || typeof window === 'undefined'
    || document.visibilityState !== 'visible'
    || typeof document.startViewTransition !== 'function'
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    apply();
    return;
  }
  try {
    // 圆心 / 半径通过自定义属性交给 CSS 的 clip-path 关键帧
    const { x, y, r } = revealOrigin();
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--vt-x', `${Math.round(x)}px`);
    rootStyle.setProperty('--vt-y', `${Math.round(y)}px`);
    rootStyle.setProperty('--vt-r', `${Math.ceil(r)}px`);

    // 快速连点时，上一段过渡会被下一次调用打断并以 AbortError 拒绝；
    // 吞掉拒绝以免 unhandledrejection（新过渡会从当前视觉状态重新开始）。
    void document.startViewTransition(apply).finished.catch(() => {});
  } catch {
    // 过渡机制自身异常（如快照不可用）：退回即时切换，保证主题一定生效
    apply();
  }
}
