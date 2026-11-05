/**
 * genui 组件渲染（AI 回复里的交互式 HTML 片段）
 *
 * 安全边界：sandbox="allow-scripts"（无 allow-same-origin / allow-forms /
 * allow-popups），CSP 禁止一切网络请求与外部资源；组件只能操作自己的 DOM，
 * 不能读应用 localStorage / IndexedDB，也不能把数据发出去。
 *
 * 美观约束：站点注入一套与主题同源的 CSS 变量 + 基础类（.svt-card / .svt-grid /
 * .svt-metric / .svt-badge 等），并对高度做自适应与上限裁剪。原始 HTML 随对话
 * 保存，重新打开时按当前主题重新套壳渲染。
 */

import { useEffect, useRef, useState } from 'react';
import { t } from '@/i18n';
import { useStore } from '@/store/useStore';

/** 单条组件 HTML 上限：超过就省略，避免把对话撑爆 */
const MAX_GENUI_CHARS = 48_000;
const MIN_HEIGHT = 120;
/** 高度完全跟随内容（不设可视上限，避免出现内部滚动条）；这个值只是防跑飞的保险 */
const MAX_HEIGHT = 6000;
const INITIAL_HEIGHT = 220;

const VAR_NAMES = [
  '--c-surface', '--c-surface-rgb',
  '--c-card', '--c-card-rgb',
  '--c-surface-hi', '--c-surface-hi-rgb',
  '--c-ink', '--c-ink-rgb',
  '--c-ink-2', '--c-ink-2-rgb',
  '--c-accent', '--c-accent-rgb',
  '--c-on-accent', '--c-on-accent-rgb',
  '--c-accent-soft', '--c-accent-soft-rgb',
  '--c-on-accent-soft', '--c-on-accent-soft-rgb',
  '--c-line', '--c-line-rgb',
] as const;

const FALLBACK_VARS: Record<string, string> = {
  '--c-surface': '#f7f4f2',
  '--c-surface-rgb': '247 244 242',
  '--c-card': '#fffdfc',
  '--c-card-rgb': '255 253 252',
  '--c-surface-hi': '#f2ecea',
  '--c-surface-hi-rgb': '242 236 234',
  '--c-ink': '#2a2324',
  '--c-ink-rgb': '42 35 36',
  '--c-ink-2': '#756465',
  '--c-ink-2-rgb': '117 100 101',
  '--c-accent': '#a93146',
  '--c-accent-rgb': '169 49 70',
  '--c-on-accent': '#fffafa',
  '--c-on-accent-rgb': '255 250 250',
  '--c-accent-soft': '#ffd2d4',
  '--c-accent-soft-rgb': '255 210 212',
  '--c-on-accent-soft': '#64262e',
  '--c-on-accent-soft-rgb': '100 38 46',
  '--c-line': '#ebe0e0',
  '--c-line-rgb': '235 224 224',
};

const BASE_CSS = `
* { box-sizing: border-box; min-width: 0; }
/* 组件内部永远不出现滚动条：高度由内容决定并由外层跟随（见 HEIGHT_SCRIPT），
   超宽元素一律收缩/换行，绝不横向溢出。 */
html, body {
  margin: 0; padding: 0; background: transparent; color: var(--c-ink);
  font-family: "Inter Tight", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif;
  font-size: 13px; line-height: 1.6;
  width: 100%; max-width: 100%; overflow: hidden !important;
  scrollbar-width: none; -ms-overflow-style: none;
}
* { scrollbar-width: none; -ms-overflow-style: none; }
*::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
img, svg, video, canvas { max-width: 100%; height: auto; }
pre, code { white-space: pre-wrap; overflow-wrap: anywhere; }
table { width: 100%; max-width: 100%; table-layout: fixed; }
th, td { overflow-wrap: anywhere; }
p, li, span, div, label, button { overflow-wrap: anywhere; }
h1, h2, h3, h4 { margin: 0 0 8px; font-size: 14px; font-weight: 600; line-height: 1.35; }
p { margin: 0 0 8px; }
p:last-child { margin-bottom: 0; }
ul, ol { margin: 0 0 8px; padding-left: 18px; }
a { color: var(--c-accent); }
button {
  font: inherit; color: var(--c-ink); border: 1px solid var(--c-line);
  background: var(--c-card); border-radius: 10px; padding: 6px 10px; cursor: pointer;
}
button:hover { border-color: var(--c-accent); }
input, select, textarea {
  font: inherit; color: var(--c-ink); background: var(--c-card);
  border: 1px solid var(--c-line); border-radius: 8px; padding: 6px 8px;
  max-width: 100%; margin: 0;
}
input[type="range"] { border: 0; padding: 0; margin: 0; background: transparent; accent-color: var(--c-accent); width: 100%; }
input[type="checkbox"], input[type="radio"] { accent-color: var(--c-accent); }
.svt-card { background: var(--c-surface-hi); border-radius: 14px; padding: 12px; }
.svt-title { font-size: 13px; font-weight: 600; }
.svt-muted { color: var(--c-ink-2); font-size: 11px; }
.svt-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(120px, 100%), 1fr)); gap: 8px; }
.svt-metric { background: var(--c-surface-hi); border-radius: 12px; padding: 10px; }
.svt-metric b { display: block; font-size: 18px; font-variant-numeric: tabular-nums; }
.svt-badge {
  display: inline-flex; align-items: center; gap: 4px; border-radius: 9999px;
  background: var(--c-accent-soft); color: var(--c-on-accent-soft);
  padding: 2px 8px; font-size: 10px; font-weight: 500;
}
.svt-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.svt-row-between { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.svt-bar { height: 8px; border-radius: 9999px; background: var(--c-line); overflow: hidden; }
.svt-bar > span { display: block; height: 100%; background: var(--c-accent); }
`;

const HEIGHT_SCRIPT = `
(() => {
  let last = 0;
  const send = () => {
    // 用 body 的内容高度，而不是 documentElement.scrollHeight：后者至少等于
    // iframe 当前视口高度，会把初始 220px 当成内容高度而无法收缩。
    const body = document.body;
    const h = Math.ceil(Math.max(body.scrollHeight, body.getBoundingClientRect().height));
    if (h > 0 && h !== last) {
      last = h;
      parent.postMessage({ type: 'svt-genui-height', height: h }, '*');
    }
  };
  window.addEventListener('load', send);
  if (window.ResizeObserver) new ResizeObserver(send).observe(document.body);
  setTimeout(send, 50);
})();
`;

function themeVars(): string {
  const cs = typeof window !== 'undefined' ? getComputedStyle(document.documentElement) : null;
  return VAR_NAMES.map((name) => {
    const value = cs?.getPropertyValue(name).trim() || FALLBACK_VARS[name] || '';
    return `${name}:${value};`;
  }).join('');
}

function buildGenUiDocument(html: string): string {
  // 让 iframe 内的原生控件（range / checkbox / select / 滚动条）跟随应用深浅模式
  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const colorScheme = dark ? 'dark' : 'light';
  const csp = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "script-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data:',
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "navigate-to 'none'",
  ].join('; ');
  return `<!doctype html><html><head><meta charset="utf-8">`
    + `<meta http-equiv="Content-Security-Policy" content="${csp}">`
    + `<style>:root{color-scheme:${colorScheme};${themeVars()}}${BASE_CSS}</style></head>`
    + `<body>${html}<script>${HEIGHT_SCRIPT}</script></body></html>`;
}

export function GenUiBlock({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(INITIAL_HEIGHT);
  const [doc, setDoc] = useState(() => buildGenUiDocument(html));
  // 主题变化时重新套壳，让组件配色跟随应用（不重新挂载 iframe 的交互状态）
  const themeKey = useStore((s) => [
    s.settings.theme, s.settings.huePreset, s.settings.hue,
    s.settings.accentHue, s.settings.darkHue, s.settings.prideFlag,
  ].join('|'));

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setDoc(buildGenUiDocument(html));
      setHeight(INITIAL_HEIGHT);
    });
    return () => cancelAnimationFrame(id);
  }, [html, themeKey]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const data = e.data as { type?: string; height?: unknown };
      if (data?.type !== 'svt-genui-height' || typeof data.height !== 'number') return;
      setHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.ceil(data.height))));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  if (html.length > MAX_GENUI_CHARS) {
    return (
      <div className="my-3 rounded-2xl bg-card px-3 py-2 text-[11px] text-ink-2">
        {t('assistant.genuiTooLarge')}
      </div>
    );
  }

  return (
    <div
      className="my-3 overflow-hidden rounded-2xl bg-card p-3 shadow-[0_2px_10px_rgba(28,25,45,0.05)]"
      onClick={(e) => e.stopPropagation()}
    >
      <iframe
        ref={iframeRef}
        title={t('assistant.genuiTitle')}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={doc}
        className="w-full border-0 bg-transparent"
        style={{ height }}
      />
    </div>
  );
}
