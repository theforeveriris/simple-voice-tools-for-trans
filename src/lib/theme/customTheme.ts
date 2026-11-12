/**
 * 自定义组件外观（配色系统）
 *
 * 在莫奈色板之上按「组件部位」覆盖样式：页面背景、卡片、顶栏、底栏、主按钮、
 * 输入框、弹层。未覆盖的属性继续继承当前主题；浅色 / 深色各存一套。
 *
 * 应用方式：生成一条 `#svt-custom-theme` 样式表，用 `!important` 覆盖
 * Tailwind 工具类；组件通过 `[data-theme-part]` 或现有稳定类名挂接。
 * 所有值经过 normalize（只接受 hex / 有限数值），避免导入的脏 JSON 注入 CSS。
 */
import type {
  CustomGradient, CustomPartStyle, CustomTheme, CustomThemePart,
} from '@/types';

export const CUSTOM_THEME_PARTS: { id: CustomThemePart; selector: string }[] = [
  { id: 'page', selector: '.app-root' },
  { id: 'card', selector: '.card-surface' },
  { id: 'topbar', selector: '[data-theme-part="topbar"]' },
  { id: 'bottombar', selector: '[data-theme-part="bottombar"]' },
  { id: 'primaryButton', selector: 'button.bg-accent' },
  { id: 'input', selector: 'input:not([type]), input[type="text"], input[type="search"], input[type="number"], input[type="email"], input[type="password"], input[type="url"], input[type="tel"], input[type="date"], input[type="time"], input[type="datetime-local"], input[type="month"], input[type="week"], textarea' },
  { id: 'dialog', selector: '[data-slot="dialog-content"], [data-slot="alert-dialog-content"]' },
];

export const CUSTOM_THEME_PART_IDS: CustomThemePart[] = CUSTOM_THEME_PARTS.map((p) => p.id);

/** 当前深浅模式下页面背景是否选择了自定义图片 */
export function hasPageImage(theme: CustomTheme | null | undefined, dark: boolean): boolean {
  return theme?.[dark ? 'dark' : 'light']?.page?.image === true;
}

const HEX = /^#[0-9a-f]{6}$/i;

function clampNumber(v: unknown, min: number, max: number): number | undefined {
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.max(min, Math.min(max, v))
    : undefined;
}

function cleanGradient(v: unknown): CustomGradient | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const from = typeof o.from === 'string' && HEX.test(o.from) ? o.from : null;
  const to = typeof o.to === 'string' && HEX.test(o.to) ? o.to : null;
  const angle = clampNumber(o.angle, 0, 360);
  if (!from || !to || angle == null) return undefined;
  return { from, to, angle };
}

function cleanStyle(v: unknown): CustomPartStyle | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const out: CustomPartStyle = {};
  if (typeof o.bg === 'string' && HEX.test(o.bg)) out.bg = o.bg;
  if (o.image === true) out.image = true;
  const gradient = cleanGradient(o.gradient);
  if (gradient) out.gradient = gradient;
  if (typeof o.text === 'string' && HEX.test(o.text)) out.text = o.text;
  if (typeof o.border === 'string' && HEX.test(o.border)) out.border = o.border;
  const borderWidth = clampNumber(o.borderWidth, 0, 8);
  if (borderWidth != null) out.borderWidth = borderWidth;
  const radius = clampNumber(o.radius, 0, 40);
  if (radius != null) out.radius = radius;
  const blur = clampNumber(o.blur, 0, 40);
  if (blur != null) out.blur = blur;
  const opacity = clampNumber(o.opacity, 0, 1);
  if (opacity != null) out.opacity = opacity;
  return Object.keys(out).length > 0 ? out : null;
}

function cleanMode(v: unknown): Partial<Record<CustomThemePart, CustomPartStyle>> {
  const out: Partial<Record<CustomThemePart, CustomPartStyle>> = {};
  if (!v || typeof v !== 'object') return out;
  const source = v as Record<string, unknown>;
  for (const id of CUSTOM_THEME_PART_IDS) {
    const style = cleanStyle(source[id]);
    if (!style) continue;
    // 图片背景只对页面开放；其他部位即使导入时带了 image 也丢弃
    if (id !== 'page') delete style.image;
    if (Object.keys(style).length > 0) out[id] = style;
  }
  return out;
}

/** 校验并裁剪外部输入（设置导入 / 主题分享 / localStorage 脏数据） */
export function normalizeCustomTheme(input: unknown): CustomTheme | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as { version?: unknown; light?: unknown; dark?: unknown };
  if (o.version !== 1) return null;
  const light = cleanMode(o.light);
  const dark = cleanMode(o.dark);
  if (Object.keys(light).length === 0 && Object.keys(dark).length === 0) return null;
  return { version: 1, light, dark };
}

/**
 * 解析「直接编辑配置」的 JSON 文本：
 * - 空文本 / null / 空配置 → null（清除全部覆盖）
 * - 合法配置 → normalize 后的 CustomTheme
 * - 格式错误或配置无效 → undefined
 */
export function parseCustomThemeJson(raw: string): CustomTheme | null | undefined {
  const text = raw.trim();
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (parsed === null) return null;
  if (typeof parsed === 'object') {
    const o = parsed as {
      version?: unknown;
      light?: Record<string, unknown>;
      dark?: Record<string, unknown>;
    };
    const empty = o.version === 1
      && Object.keys(o.light ?? {}).length === 0
      && Object.keys(o.dark ?? {}).length === 0;
    if (empty) return null;
  }
  return normalizeCustomTheme(parsed) ?? undefined;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hexToRgbTriplet(hex: string): string {
  return hexToRgb(hex).join(' ');
}

/** WCAG 相对亮度（0 黑 → 1 白） */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 混合两色：t = 第二色占比 */
function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const to = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `#${[to(ar, br), to(ag, bg), to(ab, bb)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * 背景未配文字色时推导一套可读的文字色：
 * 亮背景用近黑，暗背景用近白；次文字向背景混合 22%，保留层级但仍可读。
 * 渐变取两端平均亮度（极端跨度的渐变仍建议手动指定文字色）。
 */
function autoText(bg: string): { ink: string; ink2: string } {
  const ink = luminance(bg) > 0.45 ? '#1a1720' : '#f7f5fa';
  return { ink, ink2: mixHex(ink, bg, 0.22) };
}

/** 背景已设、文字色未设时的自动文字色（编辑器用于显示「自动」色块） */
export function autoTextColor(style: Pick<CustomPartStyle, 'bg' | 'gradient'>): string | undefined {
  if (style.bg) return autoText(style.bg).ink;
  if (style.gradient) return autoText(mixHex(style.gradient.from, style.gradient.to, 0.5)).ink;
  return undefined;
}

function styleCss(style: CustomPartStyle, part: CustomThemePart): string {
  const parts: string[] = [];
  if (style.gradient) {
    parts.push(`background: linear-gradient(${style.gradient.angle}deg, ${style.gradient.from}, ${style.gradient.to}) !important;`);
  } else if (style.bg) {
    parts.push(`background: ${style.bg} !important;`);
  } else if (style.image) {
    // 页面背景图由 body::before 铺设；本元素保持透明，让图片透出
    parts.push('background: transparent !important;');
  }

  // 文字色：显式设置优先；只改背景时按背景亮度自动推导，避免「白底白字」
  let text = style.text;
  if (!text && (style.bg || style.gradient)) {
    const base = style.bg
      ?? (style.gradient
        ? mixHex(style.gradient.from, style.gradient.to, 0.5)
        : '#ffffff');
    text = autoText(base).ink;
  }
  if (text) {
    const rgb = hexToRgbTriplet(text);
    const base = style.bg ?? (style.gradient ? mixHex(style.gradient.from, style.gradient.to, 0.5) : text);
    const secondary = style.text ? text : autoText(base).ink2;
    // 同时改写组件作用域内的文字令牌，让 text-ink / text-ink-2 等
    // Tailwind 类也跟着变；只设 color 会被子元素的工具类覆盖。
    parts.push(
      `color: ${text} !important;`,
      `--c-ink: ${text};`,
      `--c-ink-rgb: ${rgb};`,
      `--c-ink-2: ${secondary};`,
      `--c-ink-2-rgb: ${hexToRgbTriplet(secondary)};`,
    );
    // 卡片 / 弹层内常有 bg-surface-hi 的胶囊、标签与 bg-line 分隔线：
    // 背景被改成相反明度时，这些嵌套表面也要跟着换边，否则深底深字。
    if ((part === 'card' || part === 'dialog') && (style.bg || style.gradient)) {
      const hi = mixHex(base, text, 0.06);
      const line = mixHex(base, text, 0.14);
      parts.push(
        `--c-surface-hi: ${hi};`,
        `--c-surface-hi-rgb: ${hexToRgbTriplet(hi)};`,
        `--c-line: ${line};`,
        `--c-line-rgb: ${hexToRgbTriplet(line)};`,
      );
    }
    // 主按钮的文字通常走 on-accent；其自身背景被覆盖时同步推导，
    // 其他部位的 on-accent 保持主题值（否则会连带改坏强调按钮的对比）。
    if (part === 'primaryButton') {
      parts.push(
        `--c-on-accent: ${text};`,
        `--c-on-accent-rgb: ${rgb};`,
      );
    }
  }
  if (style.border != null || style.borderWidth != null) {
    const width = style.borderWidth ?? 1;
    const color = style.border ?? 'transparent';
    parts.push(`border: ${width}px solid ${color} !important;`);
    if (style.border) {
      const rgb = hexToRgbTriplet(style.border);
      parts.push(`--c-line: ${style.border};`, `--c-line-rgb: ${rgb};`);
    }
  }
  if (style.radius != null) parts.push(`border-radius: ${style.radius}px !important;`);
  if (style.blur != null && style.blur > 0) {
    parts.push(`backdrop-filter: blur(${style.blur}px) !important; -webkit-backdrop-filter: blur(${style.blur}px) !important;`);
  }
  if (style.opacity != null) parts.push(`opacity: ${style.opacity} !important;`);
  return parts.join('\n');
}

/** 生成完整样式表；空主题返回空串 */
export function buildCustomThemeCss(theme: CustomTheme | null | undefined): string {
  if (!theme) return '';
  const rules: string[] = [];
  for (const { id, selector } of CUSTOM_THEME_PARTS) {
    const light = theme.light?.[id];
    if (light && Object.keys(light).length > 0) {
      rules.push(`html:not(.dark) ${selector} {\n${styleCss(light, id)}\n}`);
    }
    const dark = theme.dark?.[id];
    if (dark && Object.keys(dark).length > 0) {
      rules.push(`html.dark ${selector} {\n${styleCss(dark, id)}\n}`);
    }
  }
  return rules.join('\n');
}

const STYLE_ID = 'svt-custom-theme';

/** 立即应用（空主题 / 非 custom 预设时移除覆盖） */
export function applyCustomTheme(theme: CustomTheme | null | undefined): void {
  if (typeof document === 'undefined') return;
  const css = buildCustomThemeCss(theme);
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!css) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = css;
}
