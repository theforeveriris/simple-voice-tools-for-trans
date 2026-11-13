/**
 * 首次打开引导（Onboarding）
 * 全屏覆盖层（z 高于底部导航与原生启动页），只在「未完成引导」时显示一次。
 * 步骤：训练方向 → 年龄段 → 界面语言 → 主题外观。
 *
 * 布局：竖屏为顶部 StepCurve + 底部 sheet；横屏与桌面切换为左侧曲线、
 * 右侧内容的自适应卡片。内容超高时仅内容区滚动，操作按钮始终固定可见。
 *
 * 设计要点：
 * - 复用 useStore.updateSettings：用户每改一项就立即落库，让主题 / 语言切换
 *   在引导过程中即时生效（所见即所得）。
 * - 训练方向同时会按 GOAL_TARGET_DEFAULTS 重新铺底训练靶标与共振峰中心
 *   （参见 ProfileSection.applyGoalDefaults），首次设置更有意义。
 * - 关闭：点「开始」设置 `svt:onboarded` 标记后卸载，标记位于
 *   localStorage 中而非 settings（避免导入旧 settings 时被重置）。
 *   右上角的「跳过」按要求保留为不显示。
 */

import { useState } from 'react';
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { MOTION } from '@/lib/motion';
import { ArrowRight, ChevronLeft, Languages, Palette, Sparkles, UserCircle2 } from 'lucide-react';
import { useStore } from '@/store/useStore';
import {
  AGE_GROUPS, GOAL_TARGET_DEFAULTS, USER_GOALS,
} from '@/constants';
import type { AgeGroup, AppSettings, UserGoal } from '@/types';
import { LOCALES } from '@/i18n';
import { localeRemark, t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui';
import { StepCurve } from './StepCurve';
import { ThemePickerBody } from './ThemePicker';

/** 完成标记键（与 svt:update-seen 等已有的 lv 顶键同风格，区别于 zustand persist 命名空间） */
const ONBOARDED_KEY = 'svt:onboarded';

/** 步骤枚举（顺序与显示一一对应） */
const STEPS = ['goal', 'age', 'language', 'appearance'] as const;

/** 大型选项卡（active 态：底色 + 描边） */
function ChoiceCard({
  active,
  onClick,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex flex-col gap-1 rounded-2xl border px-4 py-3 text-left transition-colors active:scale-[0.99]',
        active
          ? 'border-accent/50 bg-accent/[0.07]'
          : 'border-line/50 bg-surface-hi/40',
      )}
    >
      <span className="text-[13px] font-semibold text-ink">{title}</span>
      <span className="text-[11px] leading-relaxed text-ink-2">{desc}</span>
    </button>
  );
}

/** 步骤标题：图标 + 标题 + 说明 */
function StepIntro({
  icon,
  title,
  desc,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-accent">{icon}</span>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-[20px] font-semibold tracking-tight text-ink">{title}</p>
        <p className="text-[12px] leading-relaxed text-ink-2">{desc}</p>
      </div>
    </div>
  );
}

export function OnboardingSheet() {
  useI18n();
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const [step, setStep] = useState(0);
  // 首帧同步读取 localStorage：未标记 → 直接显示，避免 effect 同步
  const [show, setShow] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(ONBOARDED_KEY) !== '1';
  });

  /** 关闭并标记完成 */
  const close = () => {
    try {
      window.localStorage.setItem(ONBOARDED_KEY, '1');
    } catch {
      /* 配额满：仅本会话内不再显示，重启会再次出现——可接受 */
    }
    setShow(false);
  };

  if (!show) return null;

  const total = STEPS.length;
  const isFirst = step === 0;
  const isLast = step === total - 1;
  const stepKey = STEPS[step];

  /** 选择训练方向：铺底目标区间与共振峰中心 */
  const pickGoal = (g: UserGoal) => {
    const d = GOAL_TARGET_DEFAULTS[g];
    updateSettings({
      userGoal: g,
      targetF0Min: d.targetF0Min,
      targetF0Max: d.targetF0Max,
      formantTargetF1: d.formantTargetF1,
      formantTargetF2: d.formantTargetF2,
    });
  };
  const pickAge = (a: AgeGroup) => updateSettings({ ageGroup: a });
  const pickLanguage = (lang: string) => updateSettings({ language: lang as AppSettings['language'] });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      data-noswipe
      className="onboarding fixed inset-0 z-[300] flex items-center justify-center overflow-hidden bg-surface"
    >
      <div className="onboarding-stage flex h-full w-full max-w-sm flex-col overflow-hidden bg-surface">
        <div className="onboarding-visual">
          {/* 品牌栏（右上角的「跳过」按要求不显示） */}
          <div className="onboarding-brand flex shrink-0 items-center gap-2 px-5 pb-1 pt-4">
            <Sparkles size={16} className="text-accent" />
            <span className="text-[13px] font-semibold tracking-tight text-ink">
              Simple Voice Tool
            </span>
          </div>

          {/* 进度曲线 */}
          <StepCurve step={step} total={total} className="onboarding-curve px-4" />
        </div>

        {/* 内容面板：贴着底部的 sheet，高度跟着内容走 */}
        <div className="onboarding-sheet relative -mt-4 flex min-h-0 flex-1 flex-col rounded-t-[22px] border-t border-line/60 bg-card px-5 pb-4 pt-3">
          <div className="onboarding-sheet-handle mx-auto mb-3 h-1 w-9 shrink-0 rounded-full bg-ink/10" />

          <motion.div
            key={stepKey}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={MOTION.base}
            className="onboarding-content flex min-h-0 flex-1 flex-col overflow-y-auto"
          >
            <div className="flex flex-col gap-3">
              <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-ink-2/80">
                {t('onboard.stepOf', { n: step + 1, total })}
              </p>

              {stepKey === 'goal' && (
                <>
                  <StepIntro
                    icon={<UserCircle2 size={15} />}
                    title={t('onboard.goalTitle')}
                    desc={t('onboard.goalDesc')}
                  />
                  <div className="grid gap-2 pb-1">
                    {USER_GOALS.map((g) => (
                      <ChoiceCard
                        key={g.id}
                        active={settings.userGoal === g.id}
                        onClick={() => pickGoal(g.id)}
                        title={t(g.labelKey)}
                        desc={t(g.descKey)}
                      />
                    ))}
                  </div>
                </>
              )}

              {stepKey === 'age' && (
                <>
                  <StepIntro
                    icon={<UserCircle2 size={15} />}
                    title={t('onboard.ageTitle')}
                    desc={t('onboard.ageDesc')}
                  />
                  <div className="grid grid-cols-2 gap-2 pb-1">
                    {AGE_GROUPS.map((a) => (
                      <ChoiceCard
                        key={a.id}
                        active={settings.ageGroup === a.id}
                        onClick={() => pickAge(a.id)}
                        title={t(a.labelKey)}
                        desc={t(a.descKey)}
                      />
                    ))}
                  </div>
                </>
              )}

              {stepKey === 'language' && (
                <>
                  <StepIntro
                    icon={<Languages size={15} />}
                    title={t('onboard.languageTitle')}
                    desc={t('onboard.languageDesc')}
                  />
                  <Select value={settings.language} onValueChange={pickLanguage}>
                    <SelectTrigger className="w-full border border-line/60 bg-surface-hi px-3 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" className="rounded-2xl border-0 bg-card shadow-lg">
                      {LOCALES.map((l) => {
                        const remark = localeRemark(l, t('onboard.machine'));
                        return (
                          <SelectItem key={l.id} value={l.id}>
                            {l.label}
                            {remark ? ` · ${remark}` : ''}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </>
              )}

              {stepKey === 'appearance' && (
                <>
                  <StepIntro
                    icon={<Palette size={15} />}
                    title={t('onboard.appearanceTitle')}
                    desc={t('onboard.appearanceDesc')}
                  />
                  {/* 与 设置 → 外观 的主要主题控件一致：深浅 / 预设卡片 /
                      莫奈三色相 / 骄傲旗与渐变参数 / 自定义图片选图。
                      不含九宫焦点、模糊、压暗、声音染色等微调小项（留在设置里）。 */}
                  <ThemePickerBody settings={settings} update={updateSettings} />
                </>
              )}
            </div>
          </motion.div>

          {/* 底栏：上一步 / 下一步 */}
          <div className="onboarding-footer mt-3 flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={isFirst}
              className="flex items-center gap-1 rounded-full border border-line/70 px-4 py-2.5 text-xs font-medium text-ink-2 transition-opacity disabled:opacity-30"
            >
              <ChevronLeft size={14} />
              {t('onboard.prev')}
            </button>
            {isLast ? (
              <button
                type="button"
                onClick={close}
                className="ml-auto flex items-center gap-1 rounded-full bg-accent px-5 py-2.5 text-xs font-semibold text-on-accent shadow-[0_2px_14px_rgba(28,25,45,0.05),0_1px_3px_rgba(28,25,45,0.04)] transition-opacity hover:opacity-90"
              >
                {t('onboard.finish')}
                <ArrowRight size={14} />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setStep((s) => Math.min(total - 1, s + 1))}
                className="ml-auto flex items-center gap-1 rounded-full bg-accent px-5 py-2.5 text-xs font-semibold text-on-accent shadow-[0_2px_14px_rgba(28,25,45,0.05),0_1px_3px_rgba(28,25,45,0.04)] transition-opacity hover:opacity-90"
              >
                {t('onboard.next')}
                <ArrowRight size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
