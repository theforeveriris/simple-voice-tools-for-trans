import { describe, expect, it } from 'vitest';
import { CUSTOM_THEME_PARTS, buildCustomThemeCss, hasPageImage, normalizeCustomTheme, parseCustomThemeJson } from './customTheme';

describe('normalizeCustomTheme', () => {
  it('拒绝错误版本 / 空对象', () => {
    expect(normalizeCustomTheme(null)).toBeNull();
    expect(normalizeCustomTheme({ version: 2, light: {}, dark: {} })).toBeNull();
    expect(normalizeCustomTheme({ version: 1, light: {}, dark: {} })).toBeNull();
  });

  it('只接受 hex 颜色并夹取数值范围', () => {
    const t = normalizeCustomTheme({
      version: 1,
      light: {
        card: { bg: 'red', text: '#112233', borderWidth: 99, radius: -5, opacity: 2, blur: 999 },
      },
      dark: {},
    });
    expect(t?.light.card).toEqual({
      text: '#112233', borderWidth: 8, radius: 0, opacity: 1, blur: 40,
    });
  });

  it('保留完整渐变并拒绝坏的色标', () => {
    const t = normalizeCustomTheme({
      version: 1,
      light: {
        page: { gradient: { angle: 500, from: '#ffffff', to: '#000000' } },
        card: { gradient: { angle: 45, from: 'nope', to: '#000000' } },
      },
      dark: {},
    });
    expect(t?.light.page?.gradient).toEqual({ angle: 360, from: '#ffffff', to: '#000000' });
    expect(t?.light.card?.gradient).toBeUndefined();
  });

  it('页面图片标记只接受 true', () => {
    const t = normalizeCustomTheme({
      version: 1,
      light: { page: { image: true }, card: { image: true } },
      dark: { page: { image: 'yes' } },
    });
    expect(t?.light.page?.image).toBe(true);
    expect(t?.light.card).toBeUndefined();
    expect(t?.dark.page?.image).toBeUndefined();
  });
});

describe('parseCustomThemeJson', () => {
  it('空文本 / null / 空配置 → 清除全部覆盖', () => {
    expect(parseCustomThemeJson('')).toBeNull();
    expect(parseCustomThemeJson('null')).toBeNull();
    expect(parseCustomThemeJson('{"version":1,"light":{},"dark":{}}')).toBeNull();
  });

  it('合法配置返回 normalize 后的主题', () => {
    const theme = parseCustomThemeJson(
      '{"version":1,"light":{"card":{"bg":"#ffffff","radius":99}},"dark":{}}',
    );
    expect(theme?.light.card).toEqual({ bg: '#ffffff', radius: 40 });
  });

  it('坏 JSON / 错误版本 / 只有坏字段 → undefined', () => {
    expect(parseCustomThemeJson('{bad')).toBeUndefined();
    expect(parseCustomThemeJson('{"version":2,"light":{},"dark":{}}')).toBeUndefined();
    expect(parseCustomThemeJson('{"version":1,"light":{"card":{"bg":"red"}},"dark":{}}')).toBeUndefined();
  });
});

describe('buildCustomThemeCss', () => {
  const theme = normalizeCustomTheme({
    version: 1,
    light: {
      page: { bg: '#faf7f8' },
      card: { gradient: { angle: 135, from: '#ffffff', to: '#9a6bff' }, radius: 20, blur: 12 },
      primaryButton: { bg: '#d14b8f', text: '#ffffff' },
    },
    dark: {
      page: { bg: '#16121a' },
      card: { bg: '#221c26' },
    },
  })!;

  it('生成浅色 / 深色两套规则并覆盖目标选择器', () => {
    const css = buildCustomThemeCss(theme);
    expect(css).toContain('html:not(.dark) .app-root');
    expect(css).toContain('html.dark .app-root');
    expect(css).toContain('.card-surface');
    expect(css).toContain('linear-gradient(135deg, #ffffff, #9a6bff)');
    expect(css).toContain('backdrop-filter: blur(12px)');
    expect(css).toContain('button.bg-accent');
  });

  it('输入框选择器只命中文本类控件，不碰滑条 / 取色器 / 文件选择', () => {
    const input = CUSTOM_THEME_PARTS.find((p) => p.id === 'input')!.selector;
    expect(input).toContain('input:not([type])');
    expect(input).toContain('textarea');
    // 白名单只列文本类，range / color / file / checkbox 不在其中
    expect(input).not.toContain('type="range"');
    expect(input).not.toContain('type="color"');
    expect(input).not.toContain('type="file"');
  });

  it('空主题返回空串', () => {
    expect(buildCustomThemeCss(null)).toBe('');
    expect(buildCustomThemeCss({ version: 1, light: {}, dark: {} })).toBe('');
  });

  it('只设背景时自动推导对比文字色', () => {
    const lightTheme = normalizeCustomTheme({
      version: 1,
      light: { card: { bg: '#ffffff' }, page: { bg: '#101014' } },
      dark: {},
    })!;
    const css = buildCustomThemeCss(lightTheme);
    // 白底 → 近黑文字；深底 → 近白文字
    expect(css).toContain('--c-ink: #1a1720;');
    expect(css).toContain('--c-ink: #f7f5fa;');
    // 次文字向背景混合，保留层级
    expect(css).toContain('--c-ink-2: #4c4a51;');
    expect(css).toContain('--c-ink-2: #c4c3c7;');
    // 卡片内的胶囊 / 分隔线随背景换边
    expect(css).toContain('--c-surface-hi: #f1f1f2;');
    expect(css).toContain('--c-line: #dfdfe0;');
  });

  it('主按钮推导 on-accent，其他部位不动 on-accent', () => {
    const t = normalizeCustomTheme({
      version: 1,
      light: { primaryButton: { bg: '#fff2a8' }, card: { bg: '#ffffff' } },
      dark: {},
    })!;
    const css = buildCustomThemeCss(t);
    expect(css).toContain('--c-on-accent: #1a1720;');
    expect(css.match(/--c-on-accent:/g)).toHaveLength(1);
  });

  it('显式文字色优先，并覆盖 ink / ink-2', () => {
    const t = normalizeCustomTheme({
      version: 1,
      light: { card: { bg: '#ffffff', text: '#334455' } },
      dark: {},
    })!;
    const css = buildCustomThemeCss(t);
    expect(css).toContain('color: #334455 !important;');
    expect(css).toContain('--c-ink: #334455;');
    expect(css).toContain('--c-ink-2: #334455;');
  });

  it('页面图片背景让出底色，并按深浅模式判定是否启用', () => {
    const t = normalizeCustomTheme({
      version: 1,
      light: { page: { image: true } },
      dark: {},
    })!;
    expect(buildCustomThemeCss(t)).toContain('background: transparent !important;');
    expect(hasPageImage(t, false)).toBe(true);
    expect(hasPageImage(t, true)).toBe(false);
    expect(hasPageImage(null, false)).toBe(false);
  });
});
