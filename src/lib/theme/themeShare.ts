/**
 * 主题预设分享文件（.svt-theme）
 * 把外观设置的整体打包成一个 JSON 分享：Monet 色相三滑条 + 深浅模式、pride 旗帜与
 * 渐变/毛玻璃参数、自定义背景图参数（不含图片本体——图片是用户私人数据，主题包只带参数）、
 * 语谱图配色、图表网格开关。导入走设置导入同款的「白名单 + 类型 + 范围校验」，
 * 坏数据逐字段忽略，绝不污染现有设置。
 * 与「Lua 脚本 / 导出模板」构成零后端 UGC 三件套。
 */

import type { AppSettings } from '@/types';
import { APP_ID } from '@/lib/appId';

export interface ThemeExport {
  app: typeof APP_ID;
  kind: 'theme';
  version: 1;
  name: string;
  /** 主题字段（白名单内的键值对） */
  theme: Partial<AppSettings>;
}

/** 收进主题包的字段白名单（不含语言、麦克风、LLM 等非外观项） */
const THEME_KEYS = [
  'theme', 'huePreset', 'hue', 'accentHue', 'darkHue',
  'prideFlag', 'prideGlow', 'prideSaturation', 'prideGlassBlur', 'prideDrift',
  'bgImageFocus', 'bgImageBlur', 'bgImageDim', 'bgImageSaturation', 'bgImageOpacity', 'bgImageDrift',
  'specColormap', 'showGrid',
] as const satisfies readonly (keyof AppSettings)[];

type ThemeKey = (typeof THEME_KEYS)[number];

const MAX_NAME = 60;

/** 从设置中提取主题包（name 由调用方给，如「我的配色」） */
export function buildThemeExport(settings: AppSettings, name: string): ThemeExport {
  const theme: Record<string, unknown> = {};
  for (const k of THEME_KEYS) theme[k] = settings[k];
  return {
    app: APP_ID,
    kind: 'theme',
    version: 1,
    name: (name.trim() || 'theme').slice(0, MAX_NAME),
    theme: theme as Partial<AppSettings>,
  };
}

/* ------------------------------ 校验（与 settings.ts 同口径） ------------------------------ */

const STRING_ENUMS: Partial<Record<ThemeKey, readonly string[]>> = {
  theme: ['light', 'dark', 'system'],
  huePreset: ['monet', 'pride', 'image'],
  prideFlag: ['transPride', 'nonbinary', 'genderfluid'],
  bgImageFocus: ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'],
  specColormap: ['magma', 'gray', 'accent'],
};

const BOOL_KEYS: readonly ThemeKey[] = ['prideDrift', 'bgImageDrift', 'showGrid'];

const NUMBER_RANGE: Partial<Record<ThemeKey, [number, number]>> = {
  hue: [0, 360],
  accentHue: [0, 360],
  darkHue: [0, 360],
  prideGlow: [0.2, 3],
  prideSaturation: [0.4, 3],
  prideGlassBlur: [0, 40],
  bgImageBlur: [0, 80],
  bgImageDim: [0, 0.6],
  bgImageSaturation: [0, 3],
  bgImageOpacity: [0, 1],
};

/** 解析主题包文件：合法字段收进 patch（导入方 update(patch) 直接可用），坏字段忽略 */
export function parseThemeFile(raw: string): { name: string; patch: Partial<AppSettings> } | null {
  let parsed: Partial<ThemeExport>;
  try {
    parsed = JSON.parse(raw) as Partial<ThemeExport>;
  } catch {
    return null;
  }
  if (parsed?.kind !== 'theme' || !parsed.theme || typeof parsed.theme !== 'object') return null;
  const patch: Record<string, unknown> = {};
  const src = parsed.theme as Record<string, unknown>;
  for (const key of THEME_KEYS) {
    const v = src[key];
    if (v === undefined || v === null) continue;
    if (STRING_ENUMS[key]) {
      if (typeof v === 'string' && (STRING_ENUMS[key] as readonly string[]).includes(v)) patch[key] = v;
    } else if (BOOL_KEYS.includes(key)) {
      if (typeof v === 'boolean') patch[key] = v;
    } else if (NUMBER_RANGE[key]) {
      if (typeof v === 'number' && isFinite(v)) {
        const [lo, hi] = NUMBER_RANGE[key]!;
        patch[key] = Math.max(lo, Math.min(hi, v)); // 越界夹取（同 settings 导入口径）
      }
    }
  }
  const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : 'theme';
  return { name: name.slice(0, MAX_NAME), patch: patch as Partial<AppSettings> };
}

/** 主题包文件名（下载用） */
export function themeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex -- 控制字符正是要过滤的目标
  const safe = name.replace(/[/\\:*?"<>|\x00-\x1f]/g, '_').trim() || 'theme';
  return `${safe.slice(0, 40)}.svt-theme.json`;
}
