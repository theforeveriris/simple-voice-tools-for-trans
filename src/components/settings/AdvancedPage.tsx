/**
 * 高级（设置的子页面，原「实验性功能」）
 * 只保留真正未定型或可编程的能力：
 *   - 功能开关：分析页语谱图、实时频谱、「AI 显示为 SI」彩蛋、音高算法对比卡
 *   - 算法参数：YIN 阈值 / 音高搜索范围 / 预加重 / LPC 阶数 / F1·F2 搜索窗 /
 *     发声与活跃门限 / 嗓音质量与 CPPS 参数（改动即时生效于实时曲线，
 *     下次录音或导入用新参数）
 *   - 脚本中心：Lua 脚本（建议规则 / 分享卡模板 / 花朵生成 / 自定义导出桥）
 * 已转正的能力迁出本页：外部音频导入 → 数据；实时练习视图、音区边界、
 * 训练建议模式 → 训练；GitHub 云备份 → 数据。
 */

import { ArrowLeft, SlidersHorizontal, RotateCcw, Cog } from 'lucide-react';
import { toast } from 'sonner';
import { ALGO_PARAM_DEFAULTS } from '@/lib/audio/algoParams';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import type { AppSettings } from '@/types';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '@/components/ui';
import { SettingsSection, SettingRow, SELECT_TRIGGER_CLASS } from './rows';
import { ScriptHubSection } from './ScriptHubSection';
import { InfoTip } from './InfoTip';

/** 算法参数的档位下拉（数字值 ↔ 字符串键；当前值不在档位内时补入，防导入的任意值显示为空） */
function AlgoSelect({ value, options, onChange, format, className = 'w-40' }: {
  value: number;
  options: readonly number[];
  onChange: (v: number) => void;
  format: (v: number) => string;
  className?: string;
}) {
  const opts = options.includes(value) ? options : [...options, value].sort((a, b) => a - b);
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger className={cn(SELECT_TRIGGER_CLASS, className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" className="rounded-2xl border-0 bg-card shadow-lg">
        {opts.map((v) => (
          <SelectItem key={v} value={String(v)}>{format(v)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function AdvancedPage({
  settings,
  update,
  onBack,
}: {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  /** 返回设置主视图（advancedOpen 由父组件持有，不持久化） */
  onBack: () => void;
}) {
  useI18n();

  return (
    <div className="flex flex-col gap-3.5 pb-4">
      <div className="flex flex-col gap-3.5">
        {/* 子页面头：返回 + 标题 */}
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            aria-label={t('common.back')}
            className="grid size-10 place-items-center rounded-full bg-card text-ink shadow-[0_2px_14px_rgba(28,25,45,0.05),0_1px_3px_rgba(28,25,45,0.04)] transition-transform active:scale-90"
          >
            <ArrowLeft size={18} />
          </button>
          <p className="text-base font-semibold text-ink">{t('settings.advanced')}</p>
        </div>

        {/* 功能开关（仍未定型的显示与算法选项） */}
        <SettingsSection icon={SlidersHorizontal} title={t('settings.labsToggles')}>
          <SettingRow label={t('settings.showSpec')}>
            <Switch
              checked={settings.showSpectrogram}
              onCheckedChange={(v) => update({ showSpectrogram: v })}
            />
          </SettingRow>
          <SettingRow label={<InfoTip label={t('settings.siRename')} text={t('settings.siRenameDesc')} />}>
            <Switch
              checked={settings.siRenameEnabled}
              onCheckedChange={(v) => update({ siRenameEnabled: v })}
            />
          </SettingRow>
          <SettingRow label={t('settings.liveSpectrum')}>
            <Switch
              checked={settings.liveSpectrum}
              onCheckedChange={(v) => update({ liveSpectrum: v })}
            />
          </SettingRow>
          <SettingRow label={<InfoTip label={t('labs.pitchCompare')} text={t('labs.pitchCompareDesc')} />}>
            <Switch
              checked={settings.pitchCompareEnabled}
              onCheckedChange={(v) => update({ pitchCompareEnabled: v })}
            />
          </SettingRow>
          <SettingRow label={<InfoTip label={t('sibilance.title')} text={t('sibilance.explain')} />}>
            <Switch
              checked={settings.analysisCards.sibilance !== false}
              onCheckedChange={(v) => update({ analysisCards: { ...settings.analysisCards, sibilance: v } })}
            />
          </SettingRow>
        </SettingsSection>

        {/* 算法参数：改动即时生效于实时曲线；下次录音/导入用新参数重算 */}
        <SettingsSection icon={Cog} title={t('settings.algoParams')}>
          <SettingRow
            label={<InfoTip label={t('settings.algoYinThreshold')} text={t('settings.algoYinThresholdDesc')} />}
          >
            <AlgoSelect
              value={settings.algoYinThreshold}
              options={[0.05, 0.08, 0.11, 0.14, 0.18, 0.24, 0.3, 0.38]}
              onChange={(v) => update({ algoYinThreshold: v })}
              format={(v) => v.toFixed(2)}
            />
          </SettingRow>
          <SettingRow
            label={<InfoTip label={t('settings.algoPitchRange')} text={t('settings.algoPitchRangeDesc')} />}
          >
            <div className="flex items-center gap-2">
              <AlgoSelect
                className="w-28"
                value={settings.algoPitchMinHz}
                options={[40, 50, 60, 75, 90, 110, 140, 170, 200]}
                onChange={(v) => update({
                  algoPitchMinHz: v,
                  // 下限抬高时同步抬升上限，保持至少 100 Hz 的搜索带宽
                  ...(v + 100 > settings.algoPitchMaxHz ? { algoPitchMaxHz: v + 100 } : {}),
                })}
                format={(v) => `≥ ${v} Hz`}
              />
              <AlgoSelect
                className="w-28"
                value={settings.algoPitchMaxHz}
                options={[300, 400, 500, 600, 750, 900, 1050, 1200]}
                onChange={(v) => update({ algoPitchMaxHz: Math.max(v, settings.algoPitchMinHz + 100) })}
                format={(v) => `≤ ${v} Hz`}
              />
            </div>
          </SettingRow>
          <SettingRow
            label={<InfoTip label={t('settings.algoPreEmphasis')} text={t('settings.algoPreEmphasisDesc')} />}
          >
            <AlgoSelect
              value={settings.algoPreEmphasis}
              options={[0, 0.9, 0.94, 0.96, 0.97, 0.98]}
              onChange={(v) => update({ algoPreEmphasis: v })}
              format={(v) => v.toFixed(2)}
            />
          </SettingRow>
          <SettingRow
            label={<InfoTip label={t('settings.algoF1Min')} text={t('settings.algoF1MinDesc')} />}
          >
            <AlgoSelect
              value={settings.algoF1MinHz}
              options={[100, 140, 180, 200, 240, 280, 320, 400]}
              onChange={(v) => update({ algoF1MinHz: v })}
              format={(v) => `${v} Hz`}
            />
          </SettingRow>
          <SettingRow
            label={<InfoTip label={t('settings.algoF2Max')} text={t('settings.algoF2MaxDesc')} />}
          >
            <AlgoSelect
              value={settings.algoF2MaxHz}
              options={[2000, 2400, 2800, 3400, 4000, 4600, 5000]}
              onChange={(v) => update({ algoF2MaxHz: v })}
              format={(v) => `${v} Hz`}
            />
          </SettingRow>
          <SettingRow
            label={<InfoTip label={t('settings.algoVoicedGate')} text={t('settings.algoVoicedGateDesc')} />}
          >
            <AlgoSelect
              value={settings.algoVoicedGateDb}
              options={[-70, -65, -60, -55, -50, -45, -40]}
              onChange={(v) => update({ algoVoicedGateDb: v })}
              format={(v) => `${v} dB`}
            />
          </SettingRow>
          <SettingRow
            label={<InfoTip label={t('settings.algoActiveGate')} text={t('settings.algoActiveGateDesc')} />}
          >
            <AlgoSelect
              value={settings.algoActiveGateDb}
              options={[-70, -65, -60, -55, -50, -45, -40, -35, -30]}
              onChange={(v) => update({ algoActiveGateDb: v })}
              format={(v) => `${v} dB`}
            />
          </SettingRow>
          <SettingRow
            label={<InfoTip label={t('settings.algoLpcOrder')} text={t('settings.algoLpcOrderDesc')} />}
          >
            <AlgoSelect
              value={settings.algoLpcOrder}
              options={[0, 10, 12, 14, 16, 18, 22]}
              onChange={(v) => update({ algoLpcOrder: v })}
              format={(v) => (v === 0 ? t('settings.algoOrderAuto') : `${v}`)}
            />
          </SettingRow>
          <SettingRow
            label={<InfoTip label={t('settings.algoVqMinProb')} text={t('settings.algoVqMinProbDesc')} />}
          >
            <AlgoSelect
              value={settings.algoVqMinProb}
              options={[0.3, 0.4, 0.5, 0.55, 0.6, 0.7, 0.8]}
              onChange={(v) => update({ algoVqMinProb: v })}
              format={(v) => v.toFixed(2)}
            />
          </SettingRow>
          <SettingRow
            label={<InfoTip label={t('settings.algoVqMinPeriods')} text={t('settings.algoVqMinPeriodsDesc')} />}
          >
            <AlgoSelect
              value={settings.algoVqMinPeriods}
              options={[4, 6, 8, 10, 12, 16]}
              onChange={(v) => update({ algoVqMinPeriods: v })}
              format={(v) => `${v}`}
            />
          </SettingRow>
          <SettingRow
            label={<InfoTip label={t('settings.algoCppsF0Max')} text={t('settings.algoCppsF0MaxDesc')} />}
          >
            <AlgoSelect
              value={settings.algoCppsF0Max}
              options={[300, 400, 500, 600, 800, 1000]}
              onChange={(v) => update({ algoCppsF0Max: v })}
              format={(v) => `${v} Hz`}
            />
          </SettingRow>
          <SettingRow
            label={<InfoTip label={t('settings.algoCppsSmooth')} text={t('settings.algoCppsSmoothDesc')} />}
          >
            <AlgoSelect
              value={settings.algoCppsSmoothFrames}
              options={[1, 3, 5, 7, 9, 11, 15]}
              onChange={(v) => update({ algoCppsSmoothFrames: v })}
              format={(v) => `${v}`}
            />
          </SettingRow>
          <SettingRow label={t('settings.algoReset')}>
            <button
              onClick={() => {
                update({
                  algoYinThreshold: ALGO_PARAM_DEFAULTS.yinThreshold,
                  algoPitchMinHz: ALGO_PARAM_DEFAULTS.pitchMinHz,
                  algoPitchMaxHz: ALGO_PARAM_DEFAULTS.pitchMaxHz,
                  algoPreEmphasis: ALGO_PARAM_DEFAULTS.preEmphasis,
                  algoLpcOrder: ALGO_PARAM_DEFAULTS.lpcOrder,
                  algoF1MinHz: ALGO_PARAM_DEFAULTS.f1MinHz,
                  algoF2MaxHz: ALGO_PARAM_DEFAULTS.f2MaxHz,
                  algoVoicedGateDb: ALGO_PARAM_DEFAULTS.voicedGateDb,
                  algoActiveGateDb: ALGO_PARAM_DEFAULTS.activeGateDb,
                  algoVqMinProb: ALGO_PARAM_DEFAULTS.vqMinProb,
                  algoVqMinPeriods: ALGO_PARAM_DEFAULTS.vqMinPeriods,
                  algoCppsF0Max: ALGO_PARAM_DEFAULTS.cppsF0Max,
                  algoCppsSmoothFrames: ALGO_PARAM_DEFAULTS.cppsSmoothFrames,
                });
                toast.success(t('toast.algoResetDone'));
              }}
              className="flex items-center gap-1.5 px-1 py-2 text-xs font-medium text-accent transition-opacity hover:opacity-70"
            >
              <RotateCcw size={14} />
              {t('settings.bandResetAction')}
            </button>
          </SettingRow>
        </SettingsSection>

        {/* 脚本中心（Lua 脚本：建议规则 / 分享卡模板 / 花朵生成 / 自定义导出桥） */}
        <ScriptHubSection />
      </div>
    </div>
  );
}
