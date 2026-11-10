import { describe, it, expect } from 'vitest';
import { buildThemeExport, parseThemeFile, themeFileName } from './themeShare';
import { DEFAULT_SETTINGS } from '@/constants';
import type { AppSettings } from '@/types';

const themed: AppSettings = {
  ...DEFAULT_SETTINGS,
  huePreset: 'pride',
  prideFlag: 'nonbinary',
  prideGlow: 1.4,
  prideSaturation: 1.3,
  prideGlassBlur: 22,
  theme: 'dark',
  hue: 280,
  accentHue: 200,
  darkHue: 300,
};

describe('buildThemeExport', () => {
  it('收齐外观字段，不含非外观项（语言 / 麦克风 / LLM）', () => {
    const exp = buildThemeExport(themed, '夜霓虹');
    expect(exp.kind).toBe('theme');
    expect(exp.name).toBe('夜霓虹');
    expect(exp.theme.huePreset).toBe('pride');
    expect(exp.theme.hue).toBe(280);
    expect(exp.theme).not.toHaveProperty('language');
    expect(exp.theme).not.toHaveProperty('micDeviceId');
    expect(exp.theme).not.toHaveProperty('maxDurationSec');
  });

  it('空名回退 theme，长名截断 60', () => {
    expect(buildThemeExport(themed, '  ').name).toBe('theme');
    expect(buildThemeExport(themed, 'x'.repeat(80)).name.length).toBe(60);
  });
});

describe('parseThemeFile', () => {
  it('roundtrip：导出的文件解析回等价 patch', () => {
    const raw = JSON.stringify(buildThemeExport(themed, '夜霓虹'));
    const res = parseThemeFile(raw);
    expect(res).not.toBeNull();
    expect(res!.name).toBe('夜霓虹');
    expect(res!.patch.huePreset).toBe('pride');
    expect(res!.patch.prideFlag).toBe('nonbinary');
    expect(res!.patch.hue).toBe(280);
    expect(res!.patch.theme).toBe('dark');
  });

  it('坏 JSON → null；kind 不对 → null', () => {
    expect(parseThemeFile('oops')).toBeNull();
    expect(parseThemeFile(JSON.stringify({ kind: 'settings' }))).toBeNull();
  });

  it('非法枚举值被忽略，合法字段保留', () => {
    const raw = JSON.stringify({
      kind: 'theme', version: 1, name: 'x',
      theme: { huePreset: 'rainbow', theme: 'dark', hue: 100 },
    });
    const res = parseThemeFile(raw)!;
    expect(res.patch.huePreset).toBeUndefined();
    expect(res.patch.theme).toBe('dark');
    expect(res.patch.hue).toBe(100);
  });

  it('数值越界夹取，非数值忽略，布尔只收 boolean', () => {
    const raw = JSON.stringify({
      kind: 'theme', version: 1, name: 'x',
      theme: { hue: 9999, prideGlow: 'big', prideDrift: 'yes', showGrid: false, bgImageDim: 5 },
    });
    const res = parseThemeFile(raw)!;
    expect(res.patch.hue).toBe(360);
    expect(res.patch.prideGlow).toBeUndefined();
    expect(res.patch.prideDrift).toBeUndefined();
    expect(res.patch.showGrid).toBe(false);
    expect(res.patch.bgImageDim).toBe(0.6);
  });

  it('未知字段不进 patch', () => {
    const raw = JSON.stringify({
      kind: 'theme', version: 1, name: 'x',
      theme: { llmApiKey: 'steal', hue: 42 },
    });
    const res = parseThemeFile(raw)!;
    expect(res.patch).toEqual({ hue: 42 });
  });

  it('customTheme 随主题包往返并清洗', () => {
    const raw = JSON.stringify({
      kind: 'theme', version: 1, name: 'custom',
      theme: {
        huePreset: 'custom',
        customTheme: {
          version: 1,
          light: { page: { image: true }, dialog: { bg: '#101014', blur: 999 } },
          dark: {},
        },
      },
    });
    const res = parseThemeFile(raw)!;
    expect(res.patch.huePreset).toBe('custom');
    expect(res.patch.customTheme?.light.page?.image).toBe(true);
    expect(res.patch.customTheme?.light.dialog).toEqual({ bg: '#101014', blur: 40 });

    const bad = parseThemeFile(JSON.stringify({
      kind: 'theme', version: 1, name: 'bad',
      theme: { customTheme: { version: 1, light: { page: { bg: 'red' } }, dark: {} } },
    }))!;
    expect(bad.patch.customTheme).toBeUndefined();
  });
});

describe('themeFileName', () => {
  it('非法字符替换为下划线，保留中文名', () => {
    expect(themeFileName('夜霓虹/暗色')).toBe('夜霓虹_暗色.svt-theme.json');
    expect(themeFileName('')).toBe('theme.svt-theme.json');
  });
});
