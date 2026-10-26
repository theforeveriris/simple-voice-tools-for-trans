/**
 * 设置（配置）导出 / 导入（JSON）
 * 与记录备份同风格：app 标识 + 独立版本号 + 显式版本校验。
 * 导入只接受白名单内且类型匹配的字段，未知/类型不符的字段静默忽略，
 * 避免脏文件污染设置。
 */

import { t } from '@/i18n';
import { DEFAULT_SETTINGS } from '@/constants';
import { APP_ID } from '@/lib/appId';
import type { AppSettings } from '@/types';

/** 设置文件的当前格式版本（独立于记录备份的版本号演进） */
export const SETTINGS_FORMAT_VERSION = 1;

export interface SettingsPayload {
  app: string;
  kind: 'settings';
  version: number;
  exportedAt: string;
  settings: Partial<AppSettings>;
}

/** 绝不导出的敏感字段（大模型 API Key 存 IDB kv，且内存态也不落导出文件） */
const SECRET_KEYS = ['llmApiKey'] as const;

/** 组装设置导出 JSON（敏感字段剔除：导出文件可能被分享，key 不应随文件扩散） */
export function buildSettingsPayload(settings: AppSettings): SettingsPayload {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(settings)) {
    if ((SECRET_KEYS as readonly string[]).includes(k)) continue;
    out[k] = v;
  }
  return {
    app: APP_ID,
    kind: 'settings',
    version: SETTINGS_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    settings: out as Partial<AppSettings>,
  };
}

/** 可选字符串字段（不在 DEFAULT_SETTINGS 中，单独白名单） */
const OPTIONAL_STRING_KEYS = [
  'githubClientId', 'githubRepo', 'baselineRecordId', 'aiLanguage', 'aiGlossary',
  'llmBaseUrl', 'llmModelId', 'llmPromptOverride', 'llmActiveProfileId',
] as const;

/** 可选数值字段（不在 DEFAULT_SETTINGS 中）：键 → 允许范围（越界拒绝，防脏文件写入极端值） */
const OPTIONAL_NUMBER_KEYS: Partial<Record<keyof AppSettings, [number, number]>> = {
  llmPriceIn: [0, 1_000_000],
  llmPriceOut: [0, 1_000_000],
  // SPL 校准偏移：与 RecordingSection 的输入夹取范围一致（否则导出后导不回来）
  splOffsetDb: [0, 160],
};

/** 枚举字符串字段：导入时校验取值，非法值忽略（保持当前设置） */
const STRING_ENUMS: Partial<Record<keyof AppSettings, readonly string[]>> = {
  theme: ['light', 'dark', 'system'],
  huePreset: ['monet', 'pride', 'image'],
  prideFlag: ['transPride', 'nonbinary', 'genderfluid'],
  language: ['zh-CN', 'zh-TW', 'en', 'ja', 'lzh', 'es', 'fr', 'bo', 'ai'],
  specColormap: ['magma', 'gray', 'accent'],
  startTab: ['test', 'analysis', 'history', 'settings'],
  bgImageFocus: ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'],
  userGoal: ['mtf', 'ftm', 'other'],
  ageGroup: ['child', 'adolescent', 'adult', 'senior'],
};

/** 对象字段校验：analysisCards 五个布尔齐全才接受 */
function validAnalysisCards(v: unknown): boolean {
  const o = v as Record<string, unknown> | null;
  return !!o && typeof o === 'object'
    && ['pitch', 'formant', 'energy', 'spec', 'vrp'].every((k) => typeof o[k] === 'boolean');
}

/** 数值字段允许范围（越界夹取，防止脏文件写入极端值） */
const NUMBER_RANGE: Partial<Record<keyof AppSettings, [number, number]>> = {
  hue: [0, 360],
  accentHue: [0, 360],
  darkHue: [0, 360],
  maxDurationSec: [0, 300],
  diaryWeekStart: [0, 1],
  targetF0Min: [50, 500],
  targetF0Max: [50, 500],
  pitchAxisMin: [30, 200],
  pitchAxisMax: [300, 2000],
  playbackRate: [0.5, 1.5],
  silenceStopSec: [0.5, 2],
  liveWindowSec: [6, 20],
  audioBitrateKbps: [96, 256],
  formantTargetF1: [200, 1100],
  formantTargetF2: [500, 3400],
  formantTargetRadius: [50, 800],
  algoYinThreshold: [0.05, 0.4],
  algoPitchMinHz: [40, 200],
  algoPitchMaxHz: [300, 1200],
  algoPreEmphasis: [0, 0.98],
  algoLpcOrder: [0, 30],
  algoF1MinHz: [80, 400],
  algoF2MaxHz: [2000, 5000],
  algoVoicedGateDb: [-70, -40],
  algoActiveGateDb: [-70, -30],
  algoVqMinProb: [0.3, 0.9],
  algoVqMinPeriods: [4, 16],
  algoCppsF0Max: [250, 1000],
  algoCppsSmoothFrames: [1, 15],
  prideGlow: [0.2, 1.6],
  prideSaturation: [0.3, 2],
  prideGlassBlur: [0, 32],
  bgImageBlur: [0, 60],
  bgImageDim: [0, 0.6],
  bgImageSaturation: [0.3, 2],
  bgImageOpacity: [0, 1],
};

/**
 * 解析并校验设置导出 JSON，返回可安全合并进 store 的字段子集
 * @throws JSON 非法、kind 不符、缺少 settings 对象或版本过新时抛出带本地化文案的 Error
 */
export function parseSettingsPayload(json: string): Partial<AppSettings> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(t('toast.settingsImportFail'));
  }
  const obj = parsed as { kind?: unknown; version?: unknown; settings?: unknown } | null;
  if (!obj || typeof obj !== 'object' || obj.kind !== 'settings' || typeof obj.settings !== 'object' || obj.settings === null) {
    throw new Error(t('toast.settingsImportFail'));
  }
  const version = typeof obj.version === 'number' ? obj.version : null;
  if (version != null && version > SETTINGS_FORMAT_VERSION) {
    throw new Error(t('toast.settingsVersionTooNew', { version }));
  }

  const incoming = obj.settings as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  // 必填字段：与 DEFAULT_SETTINGS 同 key 且类型一致才接受
  for (const [key, def] of Object.entries(DEFAULT_SETTINGS)) {
    const v = incoming[key];
    if (v === undefined || typeof v !== typeof def) continue;
    const enums = STRING_ENUMS[key as keyof AppSettings];
    if (enums && !enums.includes(v as string)) continue;
    if (key === 'analysisCards' && !validAnalysisCards(v)) continue;
    if (typeof v === 'number') {
      const range = NUMBER_RANGE[key as keyof AppSettings];
      out[key] = range ? Math.min(range[1], Math.max(range[0], v)) : v;
    } else {
      out[key] = v;
    }
  }
  // 可选字符串字段
  for (const key of OPTIONAL_STRING_KEYS) {
    const v = incoming[key];
    if (typeof v === 'string') out[key] = v;
  }
  // 可选数值字段
  for (const [key, range] of Object.entries(OPTIONAL_NUMBER_KEYS) as [keyof AppSettings, [number, number]][]) {
    const v = incoming[key];
    if (typeof v === 'number' && isFinite(v) && v >= range[0] && v <= range[1]) out[key] = v;
  }
  // 大模型补充规则：字符串数组逐条接受
  const er = incoming.llmExtraRules;
  if (Array.isArray(er) && er.every((x) => typeof x === 'string')) out.llmExtraRules = er;
  // 自定义音区边界：四个有限数字（按升序整理，边界本身是有序分界）
  const bb = incoming.bandBounds;
  if (Array.isArray(bb) && bb.length === 4 && bb.every((n) => typeof n === 'number' && isFinite(n))) {
    out.bandBounds = [...bb].sort((a, b) => a - b);
  }
  // 训练靶标：两个字段独立夹取，这里兜底保证 min ≤ max（交换而非丢弃）
  if (typeof out.targetF0Min === 'number' && typeof out.targetF0Max === 'number'
    && out.targetF0Min > out.targetF0Max) {
    [out.targetF0Min, out.targetF0Max] = [out.targetF0Max, out.targetF0Min];
  }
  return out as Partial<AppSettings>;
}
