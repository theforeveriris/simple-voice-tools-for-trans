/**
 * 应用主状态管理
 * 页面导航、录音状态、当前分析数据、应用设置（持久化）
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { toast } from 'sonner';
import type { AnalysisRecord, AppSettings, ViewType } from '@/types';
import { DEFAULT_SETTINGS, MODE_META } from '@/constants';
import { recorder } from '@/lib/audio/recorder';
import { maybeAutoBackup } from '@/lib/backup/local';
import { t } from '@/i18n';
import { useHistoryStore } from './useHistoryStore';
import { autoLogPracticeForRecord } from '@/lib/practicePlan';
import { persistLlmApiKey } from './startup';

interface AppState {
  /** 当前页面 */
  currentTab: ViewType;
  setTab: (tab: ViewType) => void;
  /** 上一个页签（独立全屏页的返回按钮使用） */
  lastTab: ViewType;

  /** 是否正在录音（含权限等待期间） */
  isRecording: boolean;
  /** 当前展示的分析记录（录音完成后或从历史打开） */
  currentAnalysis: AnalysisRecord | null;
  setCurrentAnalysis: (record: AnalysisRecord | null) => void;
  /** 录完自动回放：分析页挂载音频后消费并清除 */
  pendingAutoReplay: boolean;
  clearPendingAutoReplay: () => void;

  /** 应用设置（持久化） */
  settings: AppSettings;
  updateSettings: (settings: Partial<AppSettings>) => void;

  /** 开始录音（失败时抛出异常由调用方提示） */
  startRecording: () => Promise<void>;
  /** 停止录音并完成落库 / 跳转（含音频解码与嗓音质量计算） */
  stopRecording: () => Promise<void>;
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      currentTab: 'test',
      lastTab: 'test',
      setTab: (tab) => {
        const previous = get().currentTab;
        set({ currentTab: tab, lastTab: previous });
        // 同步 hash（pushState 不触发 hashchange，App 内的 hashchange 监听
        // 只负责浏览器返回/前进键）：页签可深链接，返回键在页签间回退而非退出应用
        const want = `#/${tab}`;
        if (typeof window !== 'undefined' && window.location.hash !== want) {
          window.history.pushState(null, '', want);
        }
      },

      isRecording: false,

      currentAnalysis: null,
      setCurrentAnalysis: (record) => set({ currentAnalysis: record }),
      pendingAutoReplay: false,
      clearPendingAutoReplay: () => set({ pendingAutoReplay: false }),

      settings: DEFAULT_SETTINGS,
      updateSettings: (settings) => {
        // API Key 变更同步写入 IDB kv（内存态仅为解析配置用，不持久化到 localStorage）
        if (settings.llmApiKey !== undefined) persistLlmApiKey(settings.llmApiKey);
        set((state) => ({ settings: { ...state.settings, ...settings } }));
      },

      startRecording: async () => {
        if (get().isRecording) return;
        const { settings } = get();
        const meta = MODE_META[settings.testMode];
        // 提前置位（权限弹窗等待期间也保持录音态）：
        // 自动停止回调触发 stopRecording 时依赖该状态，为 false 会直接 return 漏停；
        // 圆球仅在测试页渲染，离开后录音在后台继续，回来时据此恢复「录音中」状态
        set({ isRecording: true });
        try {
          await recorder.start({
            deviceId: settings.micDeviceId || undefined,
            maxDurationSec: meta.autoStopSec || settings.maxDurationSec || undefined,
            // 长音模式的静音判停时长可配置；其余模式沿用模式元信息（0 = 不启用）
            silenceStopSec: meta.silenceStopSec > 0 ? (settings.silenceStopSec || meta.silenceStopSec) : 0,
            targetRange: settings.targetEnabled
              ? [settings.targetF0Min, settings.targetF0Max]
              : null,
            mode: settings.testMode,
            saveAudio: settings.audioSave,
            micEnhance: settings.micEnhance,
            audioBitrateKbps: settings.audioBitrateKbps,
            onAutoStop: () => void get().stopRecording(),
          });
          if (settings.haptics) navigator.vibrate?.(30);
        } catch (error) {
          console.error('录音启动失败:', error);
          set({ isRecording: false });
          throw error;
        }
      },

      stopRecording: async () => {
        if (!get().isRecording) return;
        set({ isRecording: false });

        // 权限等待期间取消：中止启动流程即可，无记录也不提示
        if (recorder.isStarting()) {
          recorder.cancelStart();
          return;
        }

        const raw = recorder.stop();
        if (!raw) {
          toast.error(t('toast.tooShort'));
          return;
        }
        if (get().settings.haptics) navigator.vibrate?.(20);
        // 音频解码 + 嗓音质量计算（失败时自动降级为无音频记录）
        const { record, audio } = await recorder.finishRecord(raw);
        useHistoryStore.getState().addRecord(record, audio ?? undefined);
        autoLogPracticeForRecord(record);
        // 实验性：本地自动备份（选择了文件夹时按天写入，内部自行节流）
        void maybeAutoBackup('record');
        set({ currentAnalysis: record, pendingAutoReplay: get().settings.autoReplay && audio != null });
        if (get().settings.autoEnterAnalysis) {
          get().setTab('analysis');
        }
        toast.success(t('toast.recordDone'));
      },
    }),
    {
      name: 'svt:settings:v1',
      // v2：底栏默认样式改为「悬浮胶囊」。旧安装里 navStyle 可能是上一版一次性
      // 迁移写入的 classic，所以在这里统一铺一次；用户之后在外观里选了 classic
      // 会连版本号一起写回存储，迁移不会再跑。
      version: 2,
      migrate: (persisted, version) => {
        const state = persisted as { settings?: Partial<AppSettings> } | undefined;
        if (version < 2 && state?.settings) {
          state.settings = { ...state.settings, navStyle: 'floating' };
        }
        return state as { settings: AppSettings };
      },
      // llmApiKey 不进 localStorage（存 IDB kv）：排除在持久化对象之外
      partialize: (state) => {
        const { llmApiKey: _omit, ...rest } = state.settings;
        void _omit;
        return { settings: rest };
      },
      merge: (persisted, current) => {
        const p = (persisted as { settings?: Partial<AppSettings> } | undefined)?.settings ?? {};
        const settings = { ...DEFAULT_SETTINGS, ...p } as AppSettings;
        // 旧版「训练建议」布尔开关迁移为三态模式（开启 → 规则判断，关闭 → 无）
        const legacy = (p as { adviceEnabled?: unknown }).adviceEnabled;
        if (typeof legacy === 'boolean' && p.adviceMode === undefined) {
          settings.adviceMode = legacy ? 'rules' : 'none';
        }
        // 旧版旗帜直接作为预设存储：收敛为 pride 预设 + prideFlag 字段
        const legacyFlags = ['transPride', 'nonbinary', 'genderfluid'] as const;
        if (legacyFlags.includes(settings.huePreset as (typeof legacyFlags)[number])) {
          settings.prideFlag = settings.huePreset as AppSettings['prideFlag'];
          settings.huePreset = 'pride';
        }
        // 旧版背景图开关迁移为第三预设：bgImageEnabled = true → huePreset = 'image'
        if ((p as { bgImageEnabled?: unknown }).bgImageEnabled === true && settings.huePreset !== 'image') {
          settings.huePreset = 'image';
        }
        // 迁移是一次性的：遗留键必须从 settings 里剔除。否则 partialize 会把它写回
        // localStorage，下次启动又满足迁移条件，用户永远无法切换到别的预设。
        const settingsBag = settings as unknown as Record<string, unknown>;
        delete settingsBag.bgImageEnabled;
        delete settingsBag.adviceEnabled;
        // 旧版把 API Key 存在 localStorage：一次性迁入 IDB kv，内存态保留可用
        const legacyKey = (p as { llmApiKey?: unknown }).llmApiKey;
        if (typeof legacyKey === 'string' && legacyKey) {
          persistLlmApiKey(legacyKey);
        }
        return { ...current, settings };
      },
    },
  ),
);
