/**
 * Android 系统返回手势 / 返回键
 *
 * 应用内的导航全部走 WebView 的 history：
 *   - 页签切换：useStore.setTab 用 pushState 压一条 hash 条目
 *   - 全屏浮层：backNav.registerBackClose 压一条带 svtOverlay 标记的条目
 * 因此「返回」应当等价于 history.back()，由已有的 hashchange / popstate
 * 处理器完成实际的回退。
 *
 * 但 Web 端与 Android 壳的行为不同：
 *   - 浏览器 / PWA：返回键天然触发 history 回退，无需额外代码；
 *   - Android（Capacitor）：若不注册 backButton 监听，Capacitor 直接结束
 *     Activity —— 表现就是「返回手势一按就退出应用」。
 *
 * 这里补上原生监听。判断「还有没有地方可回」时同时参考：
 *   1) WebView 自身报告的 canGoBack；
 *   2) 我们自己压入的 history 深度（部分 WebView 版本对 pushState 条目不更新
 *      canGoBack，只看它会误判为「无路可退」而直接退出）。
 * 两者都没有时，回到根页面——此时最小化应用到后台，而不是杀掉进程。
 */
import { App } from '@capacitor/app';
import { isNative } from './platform';

/** 应用内压入的 history 深度（页签 + 浮层），popstate 时递减 */
let depth = 0;
let installed = false;

/** 挂钩 pushState 以统计深度；只装一次，重复调用无副作用 */
function trackHistoryDepth() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const push = window.history.pushState.bind(window.history);
  window.history.pushState = (...args: Parameters<History['pushState']>) => {
    depth += 1;
    return push(...args);
  };
  window.addEventListener('popstate', () => {
    if (depth > 0) depth -= 1;
  });
}

/** 注册 Android 返回手势处理；非原生环境（浏览器 / PWA / Tauri）直接跳过 */
export async function initAndroidBack() {
  if (!isNative) return;
  trackHistoryDepth();
  await App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack || depth > 0) {
      window.history.back();
    } else {
      // 已在根页面：退到后台，保留当前状态，下次进入无需重新加载
      void App.minimizeApp();
    }
  });
}
