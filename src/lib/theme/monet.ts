/**
 * 莫奈取色主题系统
 * 参考 Google Material 3 / Monet 动态取色思路：
 * 由一个种子色相（hue）在 OKLCH 色彩空间中生成一套色调和谐、
 * 明度分层（surface / container / on-color）完整的色板，支持浅色 / 深色两套。
 *
 * 每个色板颜色写入两个 CSS 变量：
 *   --c-x      完整 oklch 颜色字符串（Canvas / color-mix 使用）
 *   --c-x-rgb  "r g b" 三元组（Tailwind 颜色 / 透明度修饰符使用）
 * 同时派生 shadcn/radix 组件消费的传统 HSL 语义变量（--background 等），
 * 使深色模式下基础组件自动跟随。
 */

/** 生成一个 oklch 颜色字符串 */
const ok = (l: number, c: number, h: number) =>
  `oklch(${l} ${c} ${((h % 360) + 360) % 360})`;

/**
 * OKLCH → sRGB（0-255 三元组字符串）
 * 标准 Björn Ottosson 转换矩阵
 */
export function oklchToRgbTriplet(l: number, c: number, h: number): string {
  const hr = ((h % 360) + 360) % 360 * (Math.PI / 180);
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const lo = l_ ** 3, mo = m_ ** 3, so = s_ ** 3;

  let r = 4.0767416621 * lo - 3.3077115913 * mo + 0.2309699292 * so;
  let g = -1.2684380046 * lo + 2.6097574011 * mo - 0.3413193965 * so;
  let bl = -0.0041960863 * lo - 0.7034186147 * mo + 1.707614701 * so;

  const gamma = (x: number) =>
    x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  const to8 = (x: number) => Math.round(Math.max(0, Math.min(1, gamma(x))) * 255);

  r = to8(r); g = to8(g); bl = to8(bl);
  return `${r} ${g} ${bl}`;
}

/** OKLCH → RGB（0-255 数值数组） */
function oklchToRgb(l: number, c: number, h: number): [number, number, number] {
  const parts = oklchToRgbTriplet(l, c, h).split(' ').map(Number);
  return [parts[0], parts[1], parts[2]];
}

/** RGB（0-255）→ "H S% L%" HSL 三元组字符串（shadcn 语义变量格式） */
function rgbToHslTriplet(r: number, g: number, b: number): string {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return `0 0% ${Math.round(l * 100)}%`;
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let hue: number;
  if (max === rn) hue = ((gn - bn) / d + (gn < bn ? 6 : 0));
  else if (max === gn) hue = (bn - rn) / d + 2;
  else hue = (rn - gn) / d + 4;
  hue *= 60;
  return `${Math.round(hue)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** 色板令牌：[oklch 字符串, rgb 三元组] */
function token(l: number, c: number, h: number): [string, string] {
  return [ok(l, c, h), oklchToRgbTriplet(l, c, h)];
}

/** 深浅两套明度/饱和度参数：[light(l,c), dark(l,c)]。as const 使 pick 的键检查可穷举 */
const SCALE = {
  // 页面背景与容器（微色差分层）
  'surface': [[0.968, 0.010], [0.165, 0.012]],
  'card': [[0.995, 0.005], [0.205, 0.014]],
  'surface-hi': [[0.945, 0.016], [0.250, 0.018]],
  // 文字
  'ink': [[0.27, 0.025], [0.92, 0.012]],
  'ink-2': [[0.52, 0.022], [0.70, 0.014]],
  // 主强调色（深色模式提亮以保证对比度）
  'accent': [[0.50, 0.155], [0.74, 0.13]],
  'on-accent': [[0.99, 0.008], [0.16, 0.02]],
  'accent-soft': [[0.905, 0.055], [0.30, 0.055]],
  'on-accent-soft': [[0.36, 0.09], [0.90, 0.045]],
  // 分隔线（极淡）
  'line': [[0.915, 0.012], [0.28, 0.012]],
} as const;

type ScaleKey = keyof typeof SCALE;

/** 预设配色规格：固定色相 + 令牌级明度/彩度覆盖（省略的令牌沿用莫奈标度） */
export interface ThemePresetSpec {
  hue: number;
  accentHue: number;
  /** 渐变背景 + 毛玻璃的主题类名（index.css 按 <html> 上的该类生效） */
  themeClass?: string;
  /** 深色模式的表面着色色相（浅黄等高明度色相在暗色下会读作土棕，可单独换） */
  darkHue?: number;
  overrides?: Partial<Record<string, { light: [number, number]; dark: [number, number] }>>;
}

/**
 * 预设配色
 * pride 系列（跨性别 / 非二元 / 性别流体）：
 * - 背景：按旗帜配色的氤氲渐变 + 组件毛玻璃（index.css 的 .theme-pride 规则，
 *   渐变按 <html data-pride-flag> 选择，浓度/饱和度/模糊/流动为用户可调参数）；
 * - 各自的强调色与表面铺底不同，见各 spec
 */
export const THEME_PRESETS: Record<'monet', null> & Record<string, ThemePresetSpec | null> = {
  monet: null,
  transPride: {
    hue: 230,
    accentHue: 12,
    themeClass: 'theme-pride',
    overrides: {
      'surface': { light: [0.972, 0.020], dark: [0.168, 0.022] },
      'card': { light: [0.995, 0.012], dark: [0.205, 0.024] },
      'surface-hi': { light: [0.948, 0.030], dark: [0.252, 0.032] },
      'line': { light: [0.915, 0.020], dark: [0.28, 0.024] },
      'ink': { light: [0.30, 0.030], dark: [0.92, 0.018] },
      'ink-2': { light: [0.52, 0.026], dark: [0.70, 0.020] },
      'accent': { light: [0.78, 0.085], dark: [0.845, 0.075] },
      'on-accent': { light: [0.30, 0.060], dark: [0.22, 0.050] },
      'accent-soft': { light: [0.925, 0.050], dark: [0.34, 0.055] },
      'on-accent-soft': { light: [0.44, 0.115], dark: [0.92, 0.050] },
    },
  },
  /**
   * nonbinary（非二元骄傲旗：黄 / 白 / 紫 / 黑）：
   * - 背景：氤氲黄紫白渐变 + 毛玻璃（黑条由深色底承担）；
   * - 强调色：淡紫（色相 300，高明度低彩度），选中文字反转为深紫墨色；
   * - 表面用极淡的暖黄调铺底（色相 88），深色换紫黑（黄相在近黑会读作土棕）
   */
  nonbinary: {
    hue: 88,
    accentHue: 300,
    themeClass: 'theme-pride',
    darkHue: 300,
    overrides: {
      'surface': { light: [0.972, 0.018], dark: [0.168, 0.020] },
      'card': { light: [0.995, 0.012], dark: [0.205, 0.022] },
      'surface-hi': { light: [0.948, 0.028], dark: [0.252, 0.030] },
      'line': { light: [0.915, 0.018], dark: [0.28, 0.022] },
      'ink': { light: [0.295, 0.030], dark: [0.92, 0.016] },
      'ink-2': { light: [0.52, 0.026], dark: [0.70, 0.018] },
      'accent': { light: [0.73, 0.105], dark: [0.82, 0.090] },
      'on-accent': { light: [0.30, 0.070], dark: [0.22, 0.055] },
      'accent-soft': { light: [0.928, 0.045], dark: [0.34, 0.050] },
      'on-accent-soft': { light: [0.40, 0.105], dark: [0.92, 0.045] },
    },
  },
  /**
   * genderfluid（性别流体骄傲旗：粉 / 白 / 紫 / 黑 / 蓝）：
   * - 背景：氤氲粉蓝渐变 + 紫色过渡斑（黑条由深色底承担）；
   * - 强调色：兰紫（色相 310，比 nonbinary 的紫更偏品红、略提彩度），选中文字反转为深墨紫；
   * - 表面用偏蓝的冷白铺底（色相 200，呼应蓝条），深色换靛紫黑
   */
  genderfluid: {
    hue: 200,
    accentHue: 310,
    themeClass: 'theme-pride',
    darkHue: 285,
    overrides: {
      'surface': { light: [0.972, 0.018], dark: [0.168, 0.022] },
      'card': { light: [0.995, 0.012], dark: [0.205, 0.024] },
      'surface-hi': { light: [0.948, 0.026], dark: [0.252, 0.030] },
      'line': { light: [0.915, 0.018], dark: [0.28, 0.024] },
      'ink': { light: [0.295, 0.030], dark: [0.92, 0.016] },
      'ink-2': { light: [0.52, 0.026], dark: [0.70, 0.018] },
      'accent': { light: [0.72, 0.115], dark: [0.82, 0.095] },
      'on-accent': { light: [0.30, 0.075], dark: [0.22, 0.055] },
      'accent-soft': { light: [0.925, 0.048], dark: [0.34, 0.052] },
      'on-accent-soft': { light: [0.40, 0.110], dark: [0.92, 0.045] },
    },
  },
  /**
   * 彩蛋「粉团子」：首次通关「喵喵练声」解锁
   * - 浅色：暖奶油底 + 玫瑰粉强调 + 金色次强调；
   * - 深色：靛梅夜色底 + 粉月/奶白爪印（CSS theme-cat 背景）；
   * - 色相固定（滑条隐藏），跟随浅/深模式。
   */
  cat: {
    hue: 15,
    accentHue: 15,
    darkHue: 310,
    themeClass: 'theme-cat',
    overrides: {
      'surface': { light: [0.965, 0.008], dark: [0.17, 0.015] },
      'card': { light: [0.985, 0.006], dark: [0.205, 0.020] },
      'surface-hi': { light: [0.945, 0.014], dark: [0.250, 0.025] },
      'ink': { light: [0.30, 0.030], dark: [0.93, 0.015] },
      'ink-2': { light: [0.53, 0.025], dark: [0.72, 0.020] },
      'accent': { light: [0.64, 0.120], dark: [0.78, 0.110] },
      'on-accent': { light: [0.99, 0.008], dark: [0.18, 0.020] },
      'accent-soft': { light: [0.92, 0.050], dark: [0.33, 0.060] },
      'on-accent-soft': { light: [0.42, 0.100], dark: [0.92, 0.050] },
      'line': { light: [0.91, 0.015], dark: [0.285, 0.025] },
    },
  },
};

/** 两色相之间最短弧的中点（预设配色的次强调色用，如蓝×粉 → 紫） */
function midpointHue(a: number, b: number): number {
  const d = (((b - a) % 360) + 360) % 360;
  return a + d / 2;
}

const ACCENT_KEYS: ReadonlySet<string> = new Set(['accent', 'on-accent', 'accent-soft', 'on-accent-soft']);

/**
 * 由种子色相生成全套色板令牌（含浅色/深色两组语义）
 * @param accentHue 强调色色相（默认与种子一致；预设配色可单独指定）
 * @param spec 预设规格（提供令牌级明度/彩度覆盖时使用）
 */
export function buildTokens(
  hue: number,
  dark = false,
  accentHue: number = hue,
  spec: ThemePresetSpec | null = null,
): Record<string, string> {
  // 次强调色相：强调色与表面色相之间的最短弧中点（单色相时即 hue+70，保持原行为）；
  // 按浅色 hue 计算，保证次强调色在深浅两模式下色相一致（图表曲线不跨模式跳变）
  const h2 = accentHue === hue ? hue + 70 : midpointHue(hue, accentHue);
  // 深色模式的表面着色色相（预设可用 darkHue 单独指定）
  const baseHue = dark ? (spec?.darkHue ?? hue) : hue;
  const out: Record<string, string> = {};
  const pick = (name: ScaleKey): readonly [number, number] => {
    const [light, darkV] = SCALE[name];
    return dark ? darkV : light;
  };
  const set = (name: string, [o, rgb]: [string, string]) => {
    out[`--c-${name}`] = o;
    out[`--c-${name}-rgb`] = rgb;
  };

  // 表面 / 文字 / 线条用（深色可不同的）底色色相着色，强调色系用 accentHue；预设覆盖明度/彩度
  for (const name of ['surface', 'card', 'surface-hi', 'ink', 'ink-2', 'line', 'accent', 'on-accent', 'accent-soft', 'on-accent-soft'] as const) {
    const ov = spec?.overrides?.[name];
    const [l, c] = ov ? (dark ? ov.dark : ov.light) : pick(name);
    set(name, token(l, c, ACCENT_KEYS.has(name) ? accentHue : baseHue));
  }
  // 次强调色
  set('accent2', token(dark ? 0.77 : 0.55, dark ? 0.11 : 0.13, h2));
  set('accent2-soft', token(dark ? 0.31 : 0.91, dark ? 0.05 : 0.05, h2));
  set('on-accent2-soft', token(dark ? 0.90 : 0.36, dark ? 0.04 : 0.08, h2));

  // 派生 shadcn/radix 传统语义变量（HSL 三元组），基础组件跟随深浅模式
  const hslOf = (name: ScaleKey, useAccent = false) => {
    const ov = spec?.overrides?.[name];
    const [l, c] = ov ? (dark ? ov.dark : ov.light) : pick(name);
    return rgbToHslTriplet(...oklchToRgb(l, c, useAccent ? accentHue : baseHue));
  };
  const cardHsl = hslOf('card');
  const inkHsl = hslOf('ink');
  const surfaceHsl = hslOf('surface');
  const surfaceHiHsl = hslOf('surface-hi');
  const ink2Hsl = hslOf('ink-2');
  out['--background'] = surfaceHsl;
  out['--foreground'] = inkHsl;
  out['--card'] = cardHsl;
  out['--card-foreground'] = inkHsl;
  out['--popover'] = cardHsl;
  out['--popover-foreground'] = inkHsl;
  out['--primary'] = inkHsl;
  out['--primary-foreground'] = cardHsl;
  out['--secondary'] = surfaceHiHsl;
  out['--secondary-foreground'] = inkHsl;
  out['--muted'] = surfaceHiHsl;
  out['--muted-foreground'] = ink2Hsl;
  out['--accent'] = surfaceHiHsl;
  out['--accent-foreground'] = inkHsl;
  out['--destructive'] = '0 72% 51%';
  out['--destructive-foreground'] = '0 0% 100%';
  out['--border'] = hslOf('line');
  out['--input'] = hslOf('line');
  out['--ring'] = inkHsl;
  return out;
}

/** 是否跟随系统深色（供 main.tsx 首帧判断） */
export function prefersDark(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * 预设配色的色相与规格
 * monet：用户主题色相（莫奈取色，无覆盖）；pride：按所选旗帜取规格。
 * 用户自定义的强调色相 / 深色色相（与主题色相不同时）经合成 spec 下发——
 * buildTokens 只消费 darkHue，overrides / themeClass 均为空，其余令牌与原行为一致
 * @param userAccentHue 强调色相（与 userHue 相同 = 单色，默认）
 * @param userDarkHue 深色模式表面色相（与 userHue 相同 = 跟随，默认）
 */
export function presetSpec(
  preset: string | undefined | null,
  userHue: number,
  prideFlag: string = 'transPride',
  userAccentHue: number = userHue,
  userDarkHue: number = userHue,
): { hue: number; accentHue: number; spec: ThemePresetSpec | null } {
  const spec = preset === 'pride'
    ? THEME_PRESETS[prideFlag] ?? THEME_PRESETS.transPride
    : (preset && preset !== 'pride' ? THEME_PRESETS[preset] : null) ?? null;
  if (spec) {
    return { hue: spec.hue, accentHue: spec.accentHue, spec };
  }
  if (userAccentHue !== userHue || userDarkHue !== userHue) {
    return {
      hue: userHue,
      accentHue: userAccentHue,
      spec: {
        hue: userHue,
        accentHue: userAccentHue,
        ...(userDarkHue !== userHue ? { darkHue: userDarkHue } : {}),
      },
    };
  }
  return { hue: userHue, accentHue: userAccentHue, spec: null };
}

/**
 * 将色板应用到文档根元素
 * @param hue 种子色相 0-360（表面 / 文字着色）
 * @param dark 深色模式
 * @param accentHue 强调色色相（缺省与 hue 相同；预设配色可单独指定）
 * @param spec 预设规格（令牌级明度/彩度覆盖）
 * @param prideFlag 骄傲旗旗帜（spec 为骄傲旗规格时写入 data-pride-flag 供渐变选择）
 */
export function applyTheme(
  hue: number,
  dark = false,
  accentHue: number = hue,
  spec: ThemePresetSpec | null = null,
  prideFlag: string = 'transPride',
): void {
  const style = document.documentElement.style;
  const tokens = buildTokens(hue, dark, accentHue, spec);
  for (const [key, value] of Object.entries(tokens)) {
    style.setProperty(key, value);
  }
  // 原生控件 / 滚动条跟随深浅
  style.colorScheme = dark ? 'dark' : 'light';
  // 深浅类：激活 shadcn 组件的 dark: 变体；
  // 骄傲旗类：启用渐变背景 + 毛玻璃，旗帜经 data-pride-flag 交给 CSS 选渐变
  document.documentElement.classList.toggle('dark', dark);
  const isPride = spec?.themeClass === 'theme-pride';
  const isCat = spec?.themeClass === 'theme-cat';
  document.documentElement.classList.toggle('theme-pride', isPride);
  document.documentElement.classList.toggle('theme-cat', isCat);
  if (isPride) {
    document.documentElement.setAttribute('data-pride-flag', prideFlag);
  } else {
    document.documentElement.removeAttribute('data-pride-flag');
  }
  // 浏览器地址栏 / 状态栏颜色同步
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const rgb = tokens['--c-surface-rgb'];
    meta.setAttribute('content', `rgb(${rgb.split(' ').join(',')})`);
  }
  // 通知 Canvas 图表刷新调色板缓存
  window.dispatchEvent(new CustomEvent('app:themechange'));
}

/**
 * 同步骄傲旗主题的可调参数到 CSS 变量（设置变化时由 store 订阅调用）
 * @param glow 渐变浓度（光斑层不透明度倍率）
 * @param saturation 渐变饱和度（saturate 倍率）
 * @param glassBlur 毛玻璃模糊半径 px（0 = 关闭模糊）
 * @param drift 背景流动动画开关
 */
export function applyPrideParams(glow: number, saturation: number, glassBlur: number, drift: boolean): void {
  const style = document.documentElement.style;
  style.setProperty('--pride-glow', String(glow));
  style.setProperty('--pride-saturation', String(saturation));
  style.setProperty('--pride-glass-blur', `${Math.round(glassBlur)}px`);
  document.documentElement.classList.toggle('theme-pride-static', !drift);
}
