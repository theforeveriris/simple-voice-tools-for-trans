import { afterEach, describe, expect, it, vi } from 'vitest';
import { smoothThemeChange } from './smooth';

type StartVT = (cb: () => void) => { finished: Promise<void> };

/** 视口 1280×800，无指针按压 → 圆心默认取视口中心 (640, 400) */
const CENTER = { x: '640px', y: '400px', r: '755px' };

/**
 * node 测试环境没有 DOM：按需注入最小桩，只覆盖 smooth.ts 读取的字段。
 * 用全局对象而不是 jsdom，避免为几个分支引入整套 DOM 模拟。
 */
function installDom(opts: {
  startViewTransition?: StartVT;
  reducedMotion?: boolean;
  hidden?: boolean;
} = {}) {
  const setProperty = vi.fn();
  const g = globalThis as Record<string, unknown>;
  g.window = {
    matchMedia: () => ({ matches: opts.reducedMotion ?? false }),
    innerWidth: 1280,
    innerHeight: 800,
  };
  g.document = {
    visibilityState: opts.hidden ? 'hidden' : 'visible',
    startViewTransition: opts.startViewTransition,
    activeElement: null,
    documentElement: { style: { setProperty } },
  };
  return { setProperty };
}

const workingStart: StartVT = (cb) => {
  cb();
  return { finished: Promise.resolve() };
};

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.window;
  delete g.document;
  delete g.HTMLElement;
  vi.restoreAllMocks();
});

describe('smoothThemeChange', () => {
  it('无 DOM（node / SSR）时直接执行', () => {
    const apply = vi.fn();
    smoothThemeChange(apply);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('浏览器不支持 View Transitions 时直接执行', () => {
    installDom();
    const apply = vi.fn();
    smoothThemeChange(apply);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('prefers-reduced-motion 下不启动过渡', () => {
    const start = vi.fn(workingStart);
    installDom({ startViewTransition: start, reducedMotion: true });
    const apply = vi.fn();
    smoothThemeChange(apply);
    expect(start).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('页面不可见时直接执行（不为隐藏页重拍快照）', () => {
    const start = vi.fn(workingStart);
    installDom({ startViewTransition: start, hidden: true });
    const apply = vi.fn();
    smoothThemeChange(apply);
    expect(start).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('支持时把 apply 交给 startViewTransition 执行', () => {
    const apply = vi.fn();
    const start = vi.fn(workingStart);
    installDom({ startViewTransition: start });
    smoothThemeChange(apply);
    expect(start).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('无指针 / 焦点时圆形揭示以视口中心为圆心', () => {
    const { setProperty } = installDom({ startViewTransition: workingStart });
    smoothThemeChange(vi.fn());
    expect(setProperty).toHaveBeenCalledWith('--vt-x', CENTER.x);
    expect(setProperty).toHaveBeenCalledWith('--vt-y', CENTER.y);
    expect(setProperty).toHaveBeenCalledWith('--vt-r', CENTER.r);
  });

  it('键盘操作时以焦点控件中心为圆心', () => {
    class FakeHTMLElement {
      getBoundingClientRect() {
        return { left: 100, top: 50, width: 40, height: 20 };
      }
    }
    const g = globalThis as Record<string, unknown>;
    g.HTMLElement = FakeHTMLElement;
    const { setProperty } = installDom({ startViewTransition: workingStart });
    (g.document as { activeElement: unknown }).activeElement = new FakeHTMLElement();
    smoothThemeChange(vi.fn());
    expect(setProperty).toHaveBeenCalledWith('--vt-x', '120px');
    expect(setProperty).toHaveBeenCalledWith('--vt-y', '60px');
    // hypot(max(120, 1160), max(60, 740)) ≈ 1376
    expect(setProperty).toHaveBeenCalledWith('--vt-r', '1376px');
  });

  it('过渡被连续切换打断（finished 拒绝）不抛出', () => {
    const start = vi.fn<StartVT>((cb) => {
      cb();
      return { finished: Promise.reject(new Error('AbortError')) };
    });
    installDom({ startViewTransition: start });
    expect(() => smoothThemeChange(vi.fn())).not.toThrow();
  });

  it('startViewTransition 同步抛错时降级为直接执行', () => {
    installDom({
      startViewTransition: () => {
        throw new Error('not ready');
      },
    });
    const apply = vi.fn();
    smoothThemeChange(apply);
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
