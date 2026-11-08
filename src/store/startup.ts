/**
 * 应用启动时的一次性副作用
 * 从 useStore.ts 拆出，让 store 模块保持纯状态定义、可独立测试：
 * - runStartupMigrations：API Key 的 IDB 恢复 + v0.9.0 LLM 档案迁移
 * - syncModuleSettings：设置 → 模块级单例同步（bandOf / 画笔 / DSP 共用），
 *   AlgoParams 映射表驱动，新增算法参数只改表
 * 由 main.tsx 在挂载前调用（早于首帧渲染，保证模块单例与设置一致）。
 */

import type { AppSettings } from '@/types';
import {
  AGE_BAND_PRESETS, setBandBounds,
  setPitchAxis, setLiveWindowSec, setSpecColormap, setPitchAlgorithm,
  setFormantTarget, setPitchSmoothing,
} from '@/constants';
import { applyPrideParams } from '@/lib/theme/monet';
import { applyBgImage } from '@/lib/theme/bgImage';
import { setAlgoParams } from '@/lib/audio/algoParams';
import { setSiRenameEnabled } from '@/i18n';
import { idbGetKV, idbPutKV } from '@/lib/storage/idb';
import { addProfile, profilesReady } from '@/lib/llmProfiles';
import { loadPracticePlan } from '@/lib/practicePlan';
import { t } from '@/i18n';
import { useStore } from './useStore';

/** 大模型 API Key 在 IDB kv 仓库中的键名（敏感态不进 localStorage） */
export const KV_LLM_API_KEY = 'llm-api-key';

// 音区边界 / 音高轴 / 实时窗口 / 语谱图配色：设置 → 模块级单例同步（bandOf / 画笔共用）。
// 初始化一次（persist 从 localStorage 同步恢复后 merge 会触发订阅），
// 之后仅在实际变化时刷新

/** settings 字段 → setAlgoParams 字段的一一对应（名字相同的不必出现在此） */
const ALGO_PARAMS_KEYS = [
  'yinThreshold',
  'pitchMinHz',
  'pitchMaxHz',
  'preEmphasis',
  'lpcOrder',
  'f1MinHz',
  'f2MaxHz',
  'voicedGateDb',
  'activeGateDb',
  'vqMinProb',
  'vqMinPeriods',
  'cppsF0Max',
  'cppsSmoothFrames',
] as const;

export function syncModuleSettings(s: AppSettings): void {
  // 用户自定义 bandBounds 优先；未自定义时按年龄段派生默认音区边界
  setBandBounds(s.bandBounds ?? AGE_BAND_PRESETS[s.ageGroup]);
  setPitchAxis(s.pitchAxisMin, s.pitchAxisMax);
  setLiveWindowSec(s.liveWindowSec);
  setPitchSmoothing(s.pitchSmoothing);
  setSpecColormap(s.specColormap);
  setPitchAlgorithm(s.pitchAlgorithm);
  setFormantTarget(s.formantTargetEnabled
    ? { f1: s.formantTargetF1, f2: s.formantTargetF2, radius: s.formantTargetRadius }
    : null);
  // 骄傲旗主题可调参数（CSS 变量；非骄傲旗预设下写入无副作用）
  applyPrideParams(s.prideGlow, s.prideSaturation, s.prideGlassBlur, s.prideDrift);
  // 自定义背景图参数（CSS 变量与 bg-image 类；毛玻璃强度共用 prideGlassBlur）
  applyBgImage(s);
  // 实验性：AI → SI 显示改名（t() 出口的全局转换）
  setSiRenameEnabled(s.siRenameEnabled);
  // 算法参数（实验性）：实时循环与主线程离线回退读模块单例；Worker 随请求携带快照。
  // settings 键 = 'algo' + 帕斯卡化的参数名（algoYinThreshold 等）；表驱动避免逐字段手工映射
  const algo = {} as Record<(typeof ALGO_PARAMS_KEYS)[number], number>;
  for (const k of ALGO_PARAMS_KEYS) {
    algo[k] = s[`algo${k[0].toUpperCase()}${k.slice(1)}` as keyof AppSettings] as number;
  }
  setAlgoParams(algo);
}

/** 大模型 API Key 启动时从 IDB kv 恢复到内存态（v0.9.0 起仅供迁移读取）；内存已有值时不覆盖 */
async function restoreApiKey(): Promise<void> {
  try {
    const key = await idbGetKV<string>(KV_LLM_API_KEY);
    if (key && !useStore.getState().settings.llmApiKey) {
      useStore.getState().updateSettings({ llmApiKey: key });
    }
  } catch {
    /* IndexedDB 不可用时保持为空，由设置页提示补全 */
  }
}

/** v0.9.0 迁移：旧「三字段活动配置」→ 档案（方案 A：档案即数据源）。仅在还没有任何档案时执行一次 */
async function migrateLlmProfiles(): Promise<void> {
  try {
    const list = await profilesReady();
    if (list.length > 0) return;
    const s = useStore.getState().settings;
    const baseUrl = s.llmBaseUrl?.trim() ?? '';
    const apiKey = s.llmApiKey?.trim() ?? '';
    const modelId = s.llmModelId?.trim() ?? '';
    if (!baseUrl && !apiKey && !modelId) return;
    const id = addProfile(t('settings.llmProfileMigrated'), { baseUrl, apiKey, modelId });
    useStore.getState().updateSettings({ llmActiveProfileId: id });
  } catch {
    /* 迁移失败不阻塞启动：档案页会提示补全 */
  }
}

/** 启动副作用总入口：幂等，失败均不阻塞启动 */
export function runStartupSideEffects(): void {
  syncModuleSettings(useStore.getState().settings);
  useStore.subscribe((state, prev) => {
    if (state.settings !== prev.settings) syncModuleSettings(state.settings);
  });
  void (async () => {
    await restoreApiKey();
    await migrateLlmProfiles();
  })();
  void loadPracticePlan();
}

/** API Key 变更同步写入 IDB kv（updateSettings 调用；内存态仅为解析配置用） */
export function persistLlmApiKey(key: string): void {
  void idbPutKV(KV_LLM_API_KEY, key).catch((err) => {
    console.warn('大模型 API Key 写入 IndexedDB 失败:', err);
  });
}
