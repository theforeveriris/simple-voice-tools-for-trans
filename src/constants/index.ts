/**
 * 应用常量定义
 * 音高区间、莫奈主题预设、音符换算、默认设置
 */

import type {
  AgeGroup, AppSettings, PitchAlgorithm, PitchBand, PrideFlag, TestMode, UserGoal,
} from '@/types';
import type { DictKey } from '@/i18n';

/**
 * 骄傲旗主题可选旗帜（设置 → 外观 的旗帜复选顺序）
 */
export const PRIDE_FLAGS: { id: PrideFlag; labelKey: string; stripes: string[] }[] = [
  // 条纹色取自各旗（自上而下），用于选项前的小色条
  { id: 'transPride', labelKey: 'settings.presetTrans', stripes: ['#5BCEFA', '#F5A9B8', '#FFFFFF', '#F5A9B8', '#5BCEFA'] },
  { id: 'nonbinary', labelKey: 'settings.presetNonbinary', stripes: ['#FFF430', '#FFFFFF', '#9C59D1', '#141414'] },
  { id: 'genderfluid', labelKey: 'settings.presetGenderfluid', stripes: ['#FF75A0', '#FFFFFF', '#C011D7', '#141414', '#2F3CBE'] },
];

/**
 * 音符名称列表
 */
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * 音区边界（Hz），自低到高四个分界点：
 *   < b1            low         偏低（淡紫）
 *   b1  - b2        male        男声区（淡蓝）
 *   b2  - b3        transition  男女过渡区（黑）
 *   b3  - b4        female      女声区（淡粉）
 *   > b4            high        偏高（淡紫）
 * 曲线着色、音区色带、占比统计共用同一来源（getBandRanges / bandOf），
 * 用户可在 设置 → 实验性功能 中自定义（适配变声期、童声、低音女声）。
 */
export type BandBounds = [number, number, number, number];

/** 默认边界：85 / 165 / 180 / 255 Hz */
export const DEFAULT_BAND_BOUNDS: BandBounds = [85, 165, 180, 255];

/**
 * 按年龄段派生的默认音区边界
 * （未设置 bandBounds 时由 store 根据 settings.ageGroup 选用其中之一）：
 * 童声 / 青少年变声期 / 成人 / 长者 各自的典型会话基频范围
 * 全部与音高纵轴 PITCH_AXIS [50, 520] 对齐，保证两端有音区宽度
 */
export const AGE_BAND_PRESETS: Record<AgeGroup, BandBounds> = {
  // 儿童：说话基频通常 250–400 Hz
  child: [150, 250, 280, 380],
  // 青少年（变声期）：基频跨度大且不稳定，区间放宽
  adolescent: [100, 170, 200, 300],
  // 成人：维持原 85/165/180/255
  adult: [85, 165, 180, 255],
  // 长者：基频整体下移
  senior: [70, 130, 150, 220],
};

/**
 * 按训练方向给出的默认靶标（用户首次设置目标时铺底；具体区间仍可在
 * 配置 → 训练 中手调，靶标本身默认未启用需用户主动打开）
 */
export const GOAL_TARGET_DEFAULTS: Record<UserGoal, {
  targetF0Min: number;
  targetF0Max: number;
  formantTargetF1: number;
  formantTargetF2: number;
}> = {
  // 女性化：典型会话女声 165–220（设置给到 255 留训练余量）；共振峰偏女声位
  mtf: { targetF0Min: 165, targetF0Max: 255, formantTargetF1: 900, formantTargetF2: 1900 },
  // 男性化：典型会话男声 85–165；共振峰偏男声位
  ftm: { targetF0Min: 85, targetF0Max: 165, formantTargetF1: 700, formantTargetF2: 1500 },
  // 未指定：覆盖男女双区间的中性宽靶
  other: { targetF0Min: 120, targetF0Max: 220, formantTargetF1: 800, formantTargetF2: 1700 },
};

/** 设置 / 引导页可选项（顺序与展示一致） */
export const USER_GOALS: { id: UserGoal; labelKey: DictKey; descKey: DictKey }[] = [
  { id: 'mtf', labelKey: 'settings.goalMtf', descKey: 'settings.goalMtfDesc' },
  { id: 'ftm', labelKey: 'settings.goalFtm', descKey: 'settings.goalFtmDesc' },
  { id: 'other', labelKey: 'settings.goalOther', descKey: 'settings.goalOtherDesc' },
];

export const AGE_GROUPS: { id: AgeGroup; labelKey: DictKey; descKey: DictKey }[] = [
  { id: 'child', labelKey: 'settings.ageChild', descKey: 'settings.ageChildDesc' },
  { id: 'adolescent', labelKey: 'settings.ageAdolescent', descKey: 'settings.ageAdolescentDesc' },
  { id: 'adult', labelKey: 'settings.ageAdult', descKey: 'settings.ageAdultDesc' },
  { id: 'senior', labelKey: 'settings.ageSenior', descKey: 'settings.ageSeniorDesc' },
];

/** 边界允许范围（与音高纵轴 PITCH_AXIS 对齐，留出音区最小宽度） */
const BOUND_MIN = 60;
const BOUND_MAX = 500;

/** 模块级当前边界（由 store 同步，参照 i18n 的单例模式） */
let currentBandBounds: BandBounds = DEFAULT_BAND_BOUNDS;

/**
 * 应用自定义音区边界（非法输入回退默认）
 * 设置页已做相邻挤开，这里仅做最终兜底
 */
export function setBandBounds(bounds: readonly number[] | undefined | null): void {
  if (!bounds || bounds.length !== 4) {
    currentBandBounds = DEFAULT_BAND_BOUNDS;
    return;
  }
  const v = bounds.map((x) => {
    const n = Math.round(Number(x));
    return isFinite(n) ? Math.max(BOUND_MIN, Math.min(BOUND_MAX, n)) : NaN;
  }) as unknown as BandBounds;
  currentBandBounds = v.every(isFinite) && v[0] < v[1] && v[1] < v[2] && v[2] < v[3]
    ? v
    : DEFAULT_BAND_BOUNDS;
}

/** 读取当前音区边界（副本，防止外部误改） */
export function getBandBounds(): BandBounds {
  return [...currentBandBounds] as BandBounds;
}

/** 当前边界下的五段音区范围（低/高两端与音高纵轴对齐） */
export function getBandRanges(): Record<PitchBand, [number, number]> {
  const [b1, b2, b3, b4] = currentBandBounds;
  return {
    low: [50, b1],
    male: [b1, b2],
    transition: [b2, b3],
    female: [b3, b4],
    high: [b4, 520],
  };
}

/**
 * 音高区间配色（固定，不随主题变化）
 * 曲线分段着色 / 区间背景 / 徽标
 */
export const BAND_COLORS: Record<PitchBand, string> = {
  low: '#BBA7EA',
  male: '#8FB8EC',
  transition: '#35343D',
  female: '#F0A2C0',
  high: '#BBA7EA',
};

/**
 * 判断频率所属音高区间（跟随自定义音区边界）
 */
export function bandOf(freq: number): PitchBand {
  const [b1, b2, b3, b4] = currentBandBounds;
  if (freq < b1) return 'low';
  if (freq < b2) return 'male';
  if (freq < b3) return 'transition';
  if (freq <= b4) return 'female';
  return 'high';
}

/**
 * 频率 → 钢琴音符（十二平均律，A4 = 440Hz）
 * 无效频率（无声录音 avgF0=0 等）返回占位符，避免出现 NaN
 */
export function freqToNote(freq: number): { name: string; midi: number; cents: number } {
  if (!isFinite(freq) || freq <= 0) return { name: '—', midi: 0, cents: 0 };
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  const name = NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
  const exact = 440 * Math.pow(2, (midi - 69) / 12);
  const cents = Math.round(1200 * Math.log2(freq / exact));
  return { name, midi, cents };
}

/**
 * 默认应用设置
 */
export const DEFAULT_SETTINGS: AppSettings = {
  // 用户画像：训练方向与年龄段（未显式选时为「其他 / 成人」）
  userGoal: 'other',
  ageGroup: 'adult',
  hue: 15,
  accentHue: 15,
  darkHue: 15,
  theme: 'system',
  language: 'en',
  huePreset: 'monet',
  catThemeUnlocked: false,
  prideFlag: 'transPride',
  prideGlow: 1,
  prideSaturation: 1.12,
  prideGlassBlur: 18,
  prideDrift: true,
  voiceTint: false,
  volumeBreath: false,
  bgImageFocus: 'center',
  bgImageBlur: 32,
  bgImageDim: 0.2,
  bgImageSaturation: 1,
  bgImageOpacity: 0.8,
  bgImageDrift: true,
  showGrid: true,
  navStyle: 'floating',
  maxDurationSec: 120,
  autoEnterAnalysis: true,
  micDeviceId: '',
  audioSave: true,
  testMode: 'reading',
  syncChartRange: true,
  mobileSpark: true,
  // 新装默认靶标为「未指定」口径的中性区间（120–220 Hz），与 userGoal='other' 对齐；
  // 首次引导 / 切换训练方向会按 GOAL_TARGET_DEFAULTS 重新铺底，已有记录用户保留自身值
  targetEnabled: false,
  targetF0Min: 120,
  targetF0Max: 220,
  formantTargetEnabled: false,
  formantTargetF1: 800,
  formantTargetF2: 1700,
  formantTargetRadius: 200,
  // 实验性功能
  showSpectrogram: true,
  siRenameEnabled: false,
  gardenColumns: 4,
  gardenMonthSections: true,
  showGarden: false,
  liveSpectrum: false,
  pitchAlgorithm: 'yin',
  pitchCompareEnabled: true,
  algoYinThreshold: 0.14,
  algoPitchMinHz: 60,
  algoPitchMaxHz: 600,
  algoPreEmphasis: 0.97,
  algoLpcOrder: 0,
  algoF1MinHz: 200,
  algoF2MaxHz: 3400,
  algoVoicedGateDb: -55,
  algoActiveGateDb: -50,
  algoVqMinProb: 0.55,
  algoVqMinPeriods: 8,
  algoCppsF0Max: 500,
  algoCppsSmoothFrames: 5,
  adviceMode: 'rules',
  adviceOnCompare: false,
  practiceReminderEnabled: false,
  practiceReminderTime: '20:00',
  memoryAutoSave: 'auto',
  // AI 翻译语言（语言子页面）
  aiTranslateEnabled: false,
  // 配置子页面扩展
  playbackRate: 1,
  silenceStopSec: 1,
  pitchAxisMin: 50,
  pitchAxisMax: 520,
  liveWindowSec: 12,
  pitchSmoothing: 0,
  specColormap: 'magma',
  audioBitrateKbps: 128,
  micEnhance: false,
  haptics: true,
  autoReplay: false,
  analysisCards: { pitch: true, formant: true, energy: true, spec: true, vrp: true, sibilance: true },
  startTab: 'test',
  splashScreen: true,
  diaryWeekStart: 1,
};

/**
 * 测试模式元信息
 * autoStopSec：模式自带的最长录音秒数（0 = 沿用设置里的最长录音时长）
 * silenceStopSec：发声开始后持续静音达到该秒数自动结束（0 = 不启用）
 */
export const MODE_META: Record<TestMode, {
  autoStopSec: number;
  silenceStopSec: number;
}> = {
  reading: { autoStopSec: 0, silenceStopSec: 0 },
  sustained: { autoStopSec: 0, silenceStopSec: 1 },
  glide: { autoStopSec: 20, silenceStopSec: 0 },
};

/** 音高曲线纵轴范围（Hz，默认值；运行时由设置同步，图表经 getPitchAxis 读取） */
export const PITCH_AXIS: [number, number] = [50, 520];

/** 共振峰曲线纵轴范围（Hz） */
export const FORMANT_AXIS: [number, number] = [0, 3500];

/** 能量曲线纵轴范围（dB） */
export const ENERGY_AXIS: [number, number] = [-90, 0];

/** 实时曲线滚动窗口长度（秒，默认值；运行时由设置同步） */
export const LIVE_WINDOW_SEC = 12;

/** 运行时音高轴（useStore 订阅设置同步；音区边界同一模式） */
let currentPitchAxis: [number, number] = [...PITCH_AXIS];
export function getPitchAxis(): [number, number] {
  return currentPitchAxis;
}
export function setPitchAxis(min: number, max: number): void {
  const lo = Math.max(30, Math.min(200, Math.round(min) || PITCH_AXIS[0]));
  const hi = Math.max(300, Math.min(2000, Math.round(max) || PITCH_AXIS[1]));
  if (lo >= hi - 50) return;
  currentPitchAxis = [lo, hi];
}

/** 运行时实时窗口（秒） */
let currentLiveWindowSec = LIVE_WINDOW_SEC;
export function getLiveWindowSec(): number {
  return currentLiveWindowSec;
}
export function setLiveWindowSec(sec: number): void {
  currentLiveWindowSec = [6, 12, 20].includes(sec) ? sec : LIVE_WINDOW_SEC;
}

/**
 * 运行时实时音高显示平滑级别（0 = 关闭，1–3 递增）
 * 画笔读取：仅平滑实时音量图表的显示，不影响记录数据与统计（音符/读数保持真实）
 */
let currentPitchSmoothing = 0;
export function getPitchSmoothing(): number {
  return currentPitchSmoothing;
}
export function setPitchSmoothing(level: number): void {
  currentPitchSmoothing = Number.isFinite(level) ? Math.max(0, Math.min(3, Math.round(level))) : 0;
}

/** 运行时语谱图配色（导入 settings 时同步） */
let currentSpecColormap: 'magma' | 'gray' | 'accent' = 'magma';
export function getSpecColormap() {
  return currentSpecColormap;
}
export function setSpecColormap(c: 'magma' | 'gray' | 'accent'): void {
  currentSpecColormap = c;
}

/** 运行时实时音高算法（recorder 分析循环读取；store 订阅同步，与音区边界同一模式） */
let currentPitchAlgorithm: PitchAlgorithm = 'yin';
export function getPitchAlgorithm(): PitchAlgorithm {
  return currentPitchAlgorithm;
}
export function setPitchAlgorithm(a: PitchAlgorithm): void {
  currentPitchAlgorithm = a;
}

/** 共振峰目标区（元音散点叠加；f1 = null 表示未启用） */
export interface FormantTarget {
  f1: number;
  f2: number;
  /** 容差半径（Hz）：目标区为 (F1±r, F2±r) 的矩形 */
  radius: number;
}

/** 运行时共振峰目标区（useStore 订阅设置同步，画笔 / 命中率统计同一来源） */
let currentFormantTarget: FormantTarget | null = null;
export function getFormantTarget(): FormantTarget | null {
  return currentFormantTarget;
}
export function setFormantTarget(t: FormantTarget | null): void {
  currentFormantTarget = t;
}

/* ------------------------------ 元音空间散点图 ------------------------------ */

/** 元音空间 F1 纵轴范围（Hz，对数刻度，倒置：低 F1=开口小 在上） */
export const VOWEL_AXIS_F1: [number, number] = [200, 1100];
/** 元音空间 F2 横轴范围（Hz，对数刻度，倒置：高 F2=舌位靠前 在左） */
export const VOWEL_AXIS_F2: [number, number] = [500, 3400];

/**
 * 元音空间参考元音（典型共振峰位置，取 Peterson & Barney 平均值附近）
 * 叠加为半透明虚线圈，帮助定位自己的发音落点
 */
export const VOWEL_REFS: { label: string; zh: string; f1: number; f2: number }[] = [
  { label: 'i', zh: '衣', f1: 280, f2: 2250 },
  { label: 'a', zh: '啊', f1: 730, f2: 1090 },
  { label: 'u', zh: '乌', f1: 300, f2: 870 },
];

/* -------------------------------- 声域图 VRP -------------------------------- */

/** VRP 声域图纵轴范围（MIDI 音符号）：C2=36 到 C6=84，覆盖绝大多数人声 */
export const VRP_NOTE_MIN = 36;
export const VRP_NOTE_MAX = 84;

/** 历史记录最多保留条数（记录与音频均存于 IndexedDB，容量充裕） */
export const MAX_HISTORY = 200;

/* ------------------------------ 语谱图参数 ------------------------------ */

/** 语谱图频带数（每行的采样点数） */
export const SPEC_BANDS = 64;
/** 语谱图频率范围（Hz），对数分带 */
export const SPEC_FMIN = 80;
export const SPEC_FMAX = 5000;
/** 语谱图动态范围（dB），映射到 0-255 */
export const SPEC_DB_MIN = -90;
export const SPEC_DB_MAX = -15;
/** 语谱图最多保留行数（约 2 分钟 @30Hz），超长录音截断尾部以约束体积 */
export const SPEC_MAX_ROWS = 3600;
