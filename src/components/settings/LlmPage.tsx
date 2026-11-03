/**
 * 大模型（设置子页面，v0.9.0 从实验性功能迁出）
 * - AI 助手：切到顶部 AI 页（底部导航的独立页签）
 * - 模型配置：当前使用中档案概览 + 连接测试
 * - 配置档案：档案即数据源（llm:profiles），点按切换 / 编辑 / 复制 / 删除
 * - 提示词调节：进入 PromptPage（补充规则 + 覆写，仍为独立二级页）
 * - 用量与费用：LlmUsageSection 原样移入
 * 「训练建议」三态开关留在实验性功能页——它是建议卡的行为开关，不是服务配置。
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ChevronRight, Layers, Loader2, Sparkles, SquarePen } from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import type { AppSettings } from '@/types';
import { SettingsSection, SettingRow } from './rows';
import { LlmProfilesSection } from './LlmProfilesSection';
import { LlmUsageSection } from './LlmUsageSection';
import { PromptPage } from './PromptPage';
import { useStore } from '@/store/useStore';
import { useActiveLlmConfig, useLlmProfiles } from '@/lib/llmProfiles';
import { testLlmConnection } from '@/lib/llm';

export function LlmPage({
  settings,
  update,
  onBack,
}: {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  /** 返回设置主视图（llmOpen 由父组件持有，不持久化） */
  onBack: () => void;
}) {
  useI18n();
  const setTab = useStore((s) => s.setTab);
  const [promptOpen, setPromptOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const activeProfileId = settings.llmActiveProfileId;
  const profiles = useLlmProfiles();
  const cfg = useActiveLlmConfig(activeProfileId);
  const activeProfile = profiles?.find((p) => p.id === activeProfileId) ?? null;

  const onTest = () => {
    if (testing || !cfg) return;
    setTesting(true);
    testLlmConnection(cfg)
      .then((reply) => toast.success(t('toast.llmTestOk', { model: reply })))
      .catch((err: unknown) =>
        toast.error(t('toast.llmTestFail', { msg: err instanceof Error ? err.message : String(err) })))
      .finally(() => setTesting(false));
  };

  if (promptOpen) {
    return <PromptPage settings={settings} update={update} onBack={() => setPromptOpen(false)} />;
  }

  const rulesCount = settings.llmExtraRules?.length ?? 0;
  const promptSummary = settings.llmPromptOverride?.trim()
    ? t('settings.llmPromptSummaryOverride')
    : rulesCount > 0
      ? t('settings.llmPromptSummaryRules', { n: rulesCount })
      : t('settings.llmPromptSummaryNone');

  return (
    <div className="flex flex-col gap-3.5 pb-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
        className="flex flex-col gap-3.5"
      >
        {/* 子页面头：返回 + 标题 */}
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            aria-label={t('common.back')}
            className="grid size-10 place-items-center rounded-full bg-card text-ink shadow-[0_2px_14px_rgba(28,25,45,0.05),0_1px_3px_rgba(28,25,45,0.04)] transition-transform active:scale-90"
          >
            <ArrowLeft size={18} />
          </button>
          <p className="text-base font-semibold text-ink">{t('settings.llmPage')}</p>
        </div>

        {/* AI 助手入口 */}
        <button
          onClick={() => setTab('assistant')}
          className="flex items-center gap-3 card-surface p-4 text-left transition-transform active:scale-[0.99]"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
            <Sparkles size={19} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink">{t('assistant.entry')}</span>
            <span className="block truncate text-[11px] text-ink-2">{t('assistant.entryDesc')}</span>
          </span>
          <ChevronRight size={16} className="shrink-0 text-ink-2" />
        </button>

        {/* ① 模型配置（当前使用中的档案） */}
        <SettingsSection icon={Layers} title={t('settings.llmModelConfig')}>
          {cfg && activeProfile ? (
            <>
              <SettingRow label={t('settings.llmProfileName')}>
                <span className="max-w-44 truncate text-xs text-ink-2">{activeProfile.name}</span>
              </SettingRow>
              <SettingRow label={t('settings.llmProtocol')}>
                <span className="max-w-44 truncate text-xs text-ink-2">
                  {activeProfile.protocol === 'anthropic'
                    ? t('settings.llmProtocolAnthropic')
                    : t('settings.llmProtocolOpenai')}
                </span>
              </SettingRow>
              <SettingRow label={t('settings.llmBaseUrl')}>
                <span className="max-w-44 truncate font-mono text-xs text-ink-2">{activeProfile.baseUrl}</span>
              </SettingRow>
              <SettingRow label={t('settings.llmModelId')}>
                <span className="max-w-44 truncate font-mono text-xs text-ink-2">{activeProfile.modelId}</span>
              </SettingRow>
              <SettingRow label={t('settings.llmTestDesc')}>
                <button
                  onClick={onTest}
                  disabled={testing}
                  className="flex items-center gap-1.5 rounded-full bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent disabled:opacity-60"
                >
                  {testing && <Loader2 size={12} className="animate-spin" />}
                  {testing ? t('settings.llmTesting') : t('settings.llmTest')}
                </button>
              </SettingRow>
            </>
          ) : (
            <p className="py-2 text-xs leading-relaxed text-ink-2">{t('settings.llmActiveNone')}</p>
          )}
        </SettingsSection>

        {/* ② 档案管理 */}
        <LlmProfilesSection settings={settings} update={update} />

        {/* ③ 提示词调节 */}
        <SettingsSection icon={SquarePen} title={t('settings.llmPromptSection')}>
          <button
            onClick={() => setPromptOpen(true)}
            className="flex w-full items-center justify-between gap-3 py-2 text-left"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">{t('settings.llmPromptEntry')}</span>
              <span className="block text-[11px] text-ink-2">{promptSummary}</span>
            </span>
            <ChevronRight size={15} className="shrink-0 text-ink-2" />
          </button>
        </SettingsSection>

        {/* ④ 用量与费用 */}
        <LlmUsageSection settings={settings} update={update} />
      </motion.div>


    </div>
  );
}
