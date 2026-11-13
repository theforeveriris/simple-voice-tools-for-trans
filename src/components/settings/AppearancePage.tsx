/**
 * 外观（设置的子页面，入口为主视图单行卡片）
 * - 主题：深浅模式、预设配色卡片（莫奈取色 / 骄傲旗 / 自定义图片，带色板预览）、
 *   莫奈与图片预设共用三滑条（主题色相 / 强调色相 / 深色色相，强调与深色默认跟随主题色相）、
 *   图片预设参数（选图 / 九宫焦点 / 模糊 / 压暗 / 饱和度 / 存在感 / 漂移 / 毛玻璃）、
 *   骄傲旗卡片选择 + 渐变与毛玻璃参数
 * - 氛围彩蛋：声音染色（莫奈 / pride / 图片均可用）、音量呼吸（pride 渐变 / 图片背景）
 * - 图表辅助选项：网格辅助线、时间轴联动、移动端迷你基频（各带 Info 说明浮窗）
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Download, Image as ImageIcon, Palette, PanelBottom, Settings2, Share2, SlidersHorizontal, Sparkles, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { applyPrideParams, applyTheme, presetSpec } from '@/lib/theme/monet';
import { applyCustomTheme } from '@/lib/theme/customTheme';
import { buildThemeExport, parseThemeFile, themeFileName } from '@/lib/theme/themeShare';
import { downloadBlob } from '@/lib/file';
import {
  getBgImageUrl,
  loadBgImage,
} from '@/lib/theme/bgImage';
import { PRIDE_FLAGS } from '@/constants';
import { t } from '@/i18n';
import type { DictKey } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import type { AppSettings, HuePreset, NavStyle, PrideFlag, SpecColormap, ThemeMode } from '@/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@/components/ui';
import { cn } from '@/lib/utils';
import { useStore } from '@/store/useStore';
import { SettingsSection, SettingRow, NUMBER_INPUT_CLASS, SELECT_TRIGGER_CLASS } from './rows';
import { InfoTip } from './InfoTip';
import { CatSwatch, FlagSwatch, GlassRow, MonetSwatch, PrideSlider, ThemeCard } from './ThemePicker';
import { CustomThemePage } from './CustomThemePage';
import { BgImageControls } from './BgImageControls';
import { MOTION } from '@/lib/motion';

/** 导航栏样式预览：悬浮胶囊 / 全宽经典底栏 */
function NavStylePreview({ style }: { style: NavStyle }) {
  if (style === 'classic') {
    return (
      <div className="flex h-9 items-end justify-center gap-1 rounded-t-xl border-t border-black/10 bg-surface-hi px-1.5 pb-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="flex flex-1 flex-col items-center gap-0.5">
            <span className={cn('size-1.5 rounded-full', i === 1 ? 'bg-accent' : 'bg-ink-2/45')} />
            <span className={cn('h-[2px] w-3 rounded-full', i === 1 ? 'bg-accent' : 'bg-ink-2/35')} />
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className="flex h-9 items-center justify-center">
      <div className="flex items-center gap-1 rounded-full bg-surface-hi px-2 py-1.5 shadow-sm">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className={cn('size-1.5 rounded-full', i === 1 ? 'bg-accent' : 'bg-ink-2/40')} />
        ))}
      </div>
    </div>
  );
}

/** 导航栏样式预览：AI 工作台（只剩 AI 页 + 侧栏设置入口） */
function AiWorkspacePreview() {
  return (
    <div className="flex h-9 items-center justify-center gap-1.5 rounded-xl bg-surface-hi">
      <Sparkles size={13} className="text-accent" />
      <span className="h-3.5 w-px bg-line" />
      <span className="grid size-4 place-items-center rounded-full bg-card text-ink-2">
        <Settings2 size={9} />
      </span>
    </div>
  );
}

/** 自定义组件外观预览：当前主题令牌组成的斜向渐变 */
function CustomSwatch() {
  return (
    <span
      className="block h-full w-full"
      style={{
        background: 'linear-gradient(135deg, var(--c-accent), var(--c-surface-hi) 55%, var(--c-ink))',
      }}
    />
  );
}

const NAV_STYLE_LABEL: Record<NavStyle, DictKey> = {
  floating: 'settings.navStyleFloating',
  classic: 'settings.navStyleClassic',
  ai: 'settings.navStyleAi',
};

export function AppearancePage({
  settings,
  update,
  onBack,
}: {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  /** 返回设置主视图（appearanceOpen 由父组件持有，不持久化） */
  onBack: () => void;
}) {
  useI18n();

  const dark = settings.theme === 'dark'
    || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const preset = settings.huePreset ?? 'monet';

  /** 按当前设置立即重放色板（预设/色相/旗帜变更共用） */
  const applyPreset = (next: Partial<AppSettings>) => {
    update(next);
    const merged = { ...settings, ...next };
    const p = presetSpec(merged.huePreset, merged.hue, merged.prideFlag, merged.accentHue, merged.darkHue);
    applyTheme(p.hue, dark, p.accentHue, p.spec, merged.prideFlag);
    // 骄傲旗参数可能随合并变化，同步一遍（非骄傲旗预设下写入也无副作用）
    applyPrideParams(merged.prideGlow, merged.prideSaturation, merged.prideGlassBlur, merged.prideDrift);
    // 自定义组件外观：非 custom 预设时移除覆盖层
    applyCustomTheme(merged.huePreset === 'custom' ? merged.customTheme ?? null : null);
  };

  const setPreset = (p: HuePreset) => applyPreset({ huePreset: p });
  const setPrideFlag = (f: PrideFlag) => applyPreset({ prideFlag: f });
  const setHue = (hue: number) => {
    // 强调色相 / 深色色相默认跟随主题色相：尚未被独立调整（仍与旧 hue 相等）时一并更新；
    // 拖动过强调 / 深色滑条即分离，形成双色调或独立深色铺底
    const patch: Partial<AppSettings> = { hue };
    if (settings.accentHue === settings.hue) patch.accentHue = hue;
    if (settings.darkHue === settings.hue) patch.darkHue = hue;
    applyPreset(patch);
  };

  /* ---- 自定义背景图：当前图片 objectURL 与选择/移除 ---- */
  const [bgUrl, setBgUrl] = useState<string | null>(getBgImageUrl());
  /** 自定义组件外观子页 */
  const [customOpen, setCustomOpen] = useState(false);
  // 启动预加载（main.tsx 已发起）完成后刷新缩略图；loadBgImage 幂等，不重复加载
  useEffect(() => {
    let alive = true;
    void loadBgImage().then(() => {
      if (alive) setBgUrl(getBgImageUrl());
    });
    return () => {
      alive = false;
    };
  }, []);

  if (customOpen) {
    return <CustomThemePage settings={settings} update={update} onBack={() => setCustomOpen(false)} />;
  }

  return (
    <div className="flex flex-col gap-3.5 pb-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={MOTION.page}
        className="flex flex-col gap-3.5"
      >
        {/* 子页面头：返回 + 标题 */}
        <div className="flex items-center gap-3" data-theme-part="topbar">
          <button
            onClick={onBack}
            aria-label={t('common.back')}
            className="grid size-10 place-items-center rounded-full bg-card text-ink shadow-[0_2px_14px_rgba(28,25,45,0.05),0_1px_3px_rgba(28,25,45,0.04)] transition-transform active:scale-90"
          >
            <ArrowLeft size={18} />
          </button>
          <p className="text-base font-semibold text-ink">{t('settings.appearance')}</p>
        </div>

        {/* 主题（深浅模式 + 预设配色 + 主题色，原两区块合并） */}
        <SettingsSection icon={Palette} title={t('settings.theme')}>
          <SettingRow label={t('settings.theme')}>
            <Select
              value={settings.theme}
              onValueChange={(v) => update({ theme: v as ThemeMode })}
            >
              <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="rounded-2xl border-0 bg-card shadow-lg">
                <SelectItem value="system">{t('settings.themeSystem')}</SelectItem>
                <SelectItem value="light">{t('settings.themeLight')}</SelectItem>
                <SelectItem value="dark">{t('settings.themeDark')}</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
          {/* 预设配色卡片：色板实时预览（莫奈跟随当前色相，骄傲旗跟随当前旗帜，
              自定义图片显示当前背景图，未选图时为占位图标） */}
          <SettingRow label={t('settings.huePreset')} stacked>
            <div className={cn('grid gap-2.5', settings.catThemeUnlocked ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-4')}>
              <ThemeCard
                active={preset === 'monet'}
                onClick={() => setPreset('monet')}
                label={t('settings.presetMonet')}
              >
                <MonetSwatch hue={settings.hue} />
              </ThemeCard>
              <ThemeCard
                active={preset === 'pride'}
                onClick={() => setPreset('pride')}
                label={t('settings.presetPride')}
              >
                <FlagSwatch stripes={PRIDE_FLAGS.find((f) => f.id === settings.prideFlag)?.stripes ?? []} />
              </ThemeCard>
              <ThemeCard
                active={preset === 'image'}
                onClick={() => setPreset('image')}
                label={t('settings.bgImage')}
              >
                {bgUrl ? (
                  <img src={bgUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="grid h-full w-full place-items-center bg-surface-hi text-ink-2">
                    <ImageIcon size={14} />
                  </span>
                )}
              </ThemeCard>
              <ThemeCard
                active={preset === 'custom'}
                onClick={() => {
                  applyPreset({ huePreset: 'custom' });
                  setCustomOpen(true);
                }}
                label={t('settings.presetCustom')}
              >
                <CustomSwatch />
              </ThemeCard>
              {settings.catThemeUnlocked && (
                <ThemeCard
                  active={preset === 'cat'}
                  onClick={() => setPreset('cat')}
                  label={t('settings.presetCat')}
                >
                  <CatSwatch />
                </ThemeCard>
              )}
            </div>
          </SettingRow>
          {/* 自定义预设由组件外观接管颜色，不再展示基础色相滑条；
              需要调基础色板时先切回莫奈/图片预设 */}
          {(preset === 'monet' || preset === 'image') && (
            <>
              {/* 主题色相：莫奈取色种子色相（骄傲旗预设的色板由旗帜决定） */}
              <SettingRow label={t('settings.hue')}>
                <div className="flex items-center gap-2.5">
                  <input
                    type="range"
                    min={0}
                    max={360}
                    value={settings.hue}
                    onChange={(e) => setHue(Number(e.target.value))}
                    className="h-1.5 w-36 cursor-pointer appearance-none rounded-full bg-gradient-to-r from-red-400 via-emerald-400 to-violet-500 accent-accent"
                    aria-label={t('settings.hue')}
                  />
                  <span className="w-9 shrink-0 text-right text-xs tabular-nums text-ink-2">{settings.hue}°</span>
                </div>
              </SettingRow>
              {/* 双色调：强调色相（按钮 / 选中态 / 图表主曲线），默认跟随主题色相 */}
              <SettingRow
                label={<InfoTip label={t('settings.accentHue')} text={t('settings.accentHueDesc')} />}
              >
                <div className="flex items-center gap-2.5">
                  <input
                    type="range"
                    min={0}
                    max={360}
                    value={settings.accentHue}
                    onChange={(e) => applyPreset({ accentHue: Number(e.target.value) })}
                    className="h-1.5 w-36 cursor-pointer appearance-none rounded-full bg-surface-hi accent-accent"
                    aria-label={t('settings.accentHue')}
                  />
                  <span className="w-9 shrink-0 text-right text-xs tabular-nums text-ink-2">{settings.accentHue}°</span>
                </div>
              </SettingRow>
              {/* 独立深色铺底：深色模式的表面色相，默认跟随主题色相 */}
              <SettingRow
                label={<InfoTip label={t('settings.darkHue')} text={t('settings.darkHueDesc')} />}
              >
                <div className="flex items-center gap-2.5">
                  <input
                    type="range"
                    min={0}
                    max={360}
                    value={settings.darkHue}
                    onChange={(e) => applyPreset({ darkHue: Number(e.target.value) })}
                    className="h-1.5 w-36 cursor-pointer appearance-none rounded-full bg-surface-hi accent-accent"
                    aria-label={t('settings.darkHue')}
                  />
                  <span className="w-9 shrink-0 text-right text-xs tabular-nums text-ink-2">{settings.darkHue}°</span>
                </div>
              </SettingRow>
            </>
          )}
          {/* 背景图片参数：image 预设常驻；custom 预设的页面背景选择「图片」时复用同一组参数。
              色板沿用莫奈逻辑的三个色相滑条；图片压缩后仅存本机 IndexedDB */}
          {(preset === 'image' || (preset === 'custom' && (dark ? settings.customTheme?.dark?.page?.image : settings.customTheme?.light?.page?.image))) && (
            <BgImageControls
              settings={settings}
              update={update}
              onGlassBlur={(v) => applyPreset({ prideGlassBlur: v })}
              onImageChange={setBgUrl}
            />
          )}
          {preset === 'pride' && (
            <>
              {/* 旗帜卡片（条纹预览，点选即换） */}
              <SettingRow label={t('settings.prideFlag')} stacked>
                <div className="grid grid-cols-3 gap-2.5">
                  {PRIDE_FLAGS.map((f) => (
                    <ThemeCard
                      key={f.id}
                      active={settings.prideFlag === f.id}
                      onClick={() => setPrideFlag(f.id)}
                      label={t(f.labelKey as Parameters<typeof t>[0])}
                    >
                      <FlagSwatch stripes={f.stripes} />
                    </ThemeCard>
                  ))}
                </div>
              </SettingRow>
              {/* 渐变与毛玻璃参数 */}
              <PrideSlider
                label={t('settings.prideGlow')}
                min={0.2}
                max={1.6}
                step={0.05}
                value={settings.prideGlow}
                onChange={(v) => applyPreset({ prideGlow: v })}
                format={(v) => `${Math.round(v * 100)}%`}
              />
              <PrideSlider
                label={t('settings.prideSaturation')}
                min={0.3}
                max={2}
                step={0.05}
                value={settings.prideSaturation}
                onChange={(v) => applyPreset({ prideSaturation: v })}
                format={(v) => `${Math.round(v * 100)}%`}
              />
              {/* 毛玻璃强度（与自定义背景图共用） */}
              <GlassRow value={settings.prideGlassBlur} onChange={(v) => applyPreset({ prideGlassBlur: v })} />
              <SettingRow label={t('settings.prideDrift')}>
                <Switch
                  checked={settings.prideDrift}
                  onCheckedChange={(v) => applyPreset({ prideDrift: v })}
                />
              </SettingRow>
              {/* 音量呼吸：渐变浓度随麦克风响度起伏（pride 渐变专属彩蛋） */}
              <SettingRow
                label={<InfoTip label={t('settings.volumeBreath')} text={t('settings.volumeBreathDesc')} />}
              >
                <Switch
                  checked={settings.volumeBreath}
                  onCheckedChange={(v) => update({ volumeBreath: v })}
                />
              </SettingRow>
            </>
          )}

          {/* 声音染色：界面色相随实时音高流动（莫奈 / pride 预设均可用） */}
          <SettingRow
            label={<InfoTip label={t('settings.voiceTint')} text={t('settings.voiceTintDesc')} />}
          >
            <Switch
              checked={settings.voiceTint}
              onCheckedChange={(v) => update({ voiceTint: v })}
            />
          </SettingRow>
        </SettingsSection>

        {/* 导航栏样式：悬浮胶囊 / 贯穿底部的经典底栏 */}
        <SettingsSection
          icon={PanelBottom}
          title={<InfoTip label={t('settings.navStyle')} text={t('settings.navStyleDesc')} />}
        >
          <div className="grid grid-cols-3 gap-2">
            {(['floating', 'classic', 'ai'] as const).map((style) => {
              const active = settings.navStyle === style;
              return (
                <button
                  key={style}
                  onClick={() => {
                    update({ navStyle: style });
                    if (style === 'ai') useStore.getState().setTab('assistant');
                  }}
                  aria-pressed={active}
                  className={cn(
                    'rounded-2xl border p-2 text-left transition-colors',
                    active ? 'border-accent bg-accent/5' : 'border-black/10 bg-surface-hi/40 hover:border-black/20',
                  )}
                >
                  {style === 'ai' ? <AiWorkspacePreview /> : <NavStylePreview style={style} />}
                  <span className={cn('mt-1.5 block px-0.5 text-[11px] font-medium', active ? 'text-accent' : 'text-ink-2')}>
                    {t(NAV_STYLE_LABEL[style])}
                  </span>
                </button>
              );
            })}
          </div>
        </SettingsSection>

        {/* 动效：删除历史记录时卡片收起淡出（Telegram 消息式），默认开启 */}
        <SettingsSection icon={Sparkles} title={t('settings.motion')}>
          <SettingRow
            label={<InfoTip label={t('settings.deleteAnimation')} text={t('settings.deleteAnimationDesc')} />}
          >
            <Switch
              checked={settings.deleteAnimation}
              onCheckedChange={(v) => update({ deleteAnimation: v })}
            />
          </SettingRow>
        </SettingsSection>

        {/* 图表与显示：外观类显示选项 + 图表与回放（原「配置 · 图表与回放」并入此处，
            同一件事只出现在一个地方） */}
        <SettingsSection icon={SlidersHorizontal} title={t('settings.chartDisplay')}>
          <SettingRow label={<InfoTip label={t('settings.showGrid')} text={t('settings.showGridDesc')} />}>
            <Switch
              checked={settings.showGrid}
              onCheckedChange={(v) => update({ showGrid: v })}
            />
          </SettingRow>
          <SettingRow label={<InfoTip label={t('settings.syncRange')} text={t('settings.syncRangeDesc')} />}>
            <Switch
              checked={settings.syncChartRange}
              onCheckedChange={(v) => update({ syncChartRange: v })}
            />
          </SettingRow>
          <SettingRow label={<InfoTip label={t('settings.mobileSpark')} text={t('settings.mobileSparkDesc')} />}>
            <Switch
              checked={settings.mobileSpark}
              onCheckedChange={(v) => update({ mobileSpark: v })}
            />
          </SettingRow>
          <SettingRow label={<InfoTip label={t('settings.liveWindow')} text={t('settings.liveWindowDesc')} />}>
            <Select
              value={String(settings.liveWindowSec)}
              onValueChange={(v) => update({ liveWindowSec: Number(v) })}
            >
              <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="rounded-2xl border-0 bg-card shadow-lg">
                <SelectItem value="6">{t('common.sec', { n: 6 })}</SelectItem>
                <SelectItem value="12">{t('common.sec', { n: 12 })}</SelectItem>
                <SelectItem value="20">{t('common.sec', { n: 20 })}</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow label={<InfoTip label={t('settings.pitchSmoothing')} text={t('settings.pitchSmoothingDesc')} />}>
            <Select
              value={String(settings.pitchSmoothing)}
              onValueChange={(v) => update({ pitchSmoothing: Number(v) })}
            >
              <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="rounded-2xl border-0 bg-card shadow-lg">
                <SelectItem value="0">{t('settings.pitchSmoothOff')}</SelectItem>
                <SelectItem value="1">{t('settings.pitchSmoothLight')}</SelectItem>
                <SelectItem value="2">{t('settings.pitchSmoothMedium')}</SelectItem>
                <SelectItem value="3">{t('settings.pitchSmoothStrong')}</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow label={<InfoTip label={t('settings.pitchAxis')} text={t('settings.pitchAxisDesc')} />}>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                inputMode="numeric"
                min={30}
                max={200}
                value={settings.pitchAxisMin}
                onChange={(e) => {
                  const min = Math.max(30, Math.min(200, Number(e.target.value) || 50));
                  update({ pitchAxisMin: Math.min(min, settings.pitchAxisMax - 50) });
                }}
                className={NUMBER_INPUT_CLASS}
                aria-label={t('settings.pitchAxis')}
              />
              <span className="text-ink-2">–</span>
              <input
                type="number"
                inputMode="numeric"
                min={300}
                max={2000}
                value={settings.pitchAxisMax}
                onChange={(e) => {
                  const max = Math.max(300, Math.min(2000, Number(e.target.value) || 520));
                  update({ pitchAxisMax: Math.max(max, settings.pitchAxisMin + 50) });
                }}
                className={NUMBER_INPUT_CLASS}
                aria-label={t('settings.pitchAxis')}
              />
              <span className="text-xs text-ink-2">Hz</span>
            </div>
          </SettingRow>
          <SettingRow label={<InfoTip label={t('settings.specColormap')} text={t('settings.specColormapDesc')} />}>
            <Select
              value={settings.specColormap}
              onValueChange={(v) => update({ specColormap: v as SpecColormap })}
            >
              <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="rounded-2xl border-0 bg-card shadow-lg">
                <SelectItem value="magma">{t('settings.colormapMagma')}</SelectItem>
                <SelectItem value="gray">{t('settings.colormapGray')}</SelectItem>
                <SelectItem value="accent">{t('settings.colormapAccent')}</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow label={t('settings.playbackRateSel')}>
            <Select
              value={String(settings.playbackRate)}
              onValueChange={(v) => update({ playbackRate: Number(v) })}
            >
              <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="rounded-2xl border-0 bg-card shadow-lg">
                <SelectItem value="0.5">0.5×</SelectItem>
                <SelectItem value="0.75">0.75×</SelectItem>
                <SelectItem value="1">{t('settings.playbackNormal')}</SelectItem>
                <SelectItem value="1.5">1.5×</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow label={t('settings.diaryWeekStart')}>
            <Select
              value={String(settings.diaryWeekStart)}
              onValueChange={(v) => update({ diaryWeekStart: Number(v) as 0 | 1 })}
            >
              <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="rounded-2xl border-0 bg-card shadow-lg">
                <SelectItem value="1">{t('settings.weekMonday')}</SelectItem>
                <SelectItem value="0">{t('settings.weekSunday')}</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
        </SettingsSection>

        {/* 花园布局（声之花视图的排版） */}
        <SettingsSection icon={Palette} title={t('settings.gardenLayout')}>
          <SettingRow label={<InfoTip label={t('garden.show')} text={t('settings.gardenShowDesc')} />}>
            <Switch
              checked={!!settings.showGarden}
              onCheckedChange={(v) => update({ showGarden: v })}
            />
          </SettingRow>
          {settings.showGarden && (
            <>
              <SettingRow label={<InfoTip label={t('garden.colsLabel')} text={t('settings.gardenColsDesc')} />}>
                <div className="flex items-center gap-1" role="group" aria-label={t('garden.colsLabel')}>
                  {[2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => update({ gardenColumns: n })}
                      aria-pressed={settings.gardenColumns === n}
                      aria-label={t('garden.colsAria', { n })}
                      className={cn(
                        'grid size-8 place-items-center rounded-full text-xs font-semibold tabular-nums transition-colors',
                        settings.gardenColumns === n ? 'bg-accent text-on-accent' : 'bg-surface-hi text-ink-2 hover:text-ink',
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </SettingRow>
              <SettingRow label={<InfoTip label={t('garden.monthSections')} text={t('settings.gardenMonthDesc')} />}>
                <Switch
                  checked={settings.gardenMonthSections}
                  onCheckedChange={(v) => update({ gardenMonthSections: v })}
                />
              </SettingRow>
            </>
          )}
        </SettingsSection>

        {/* 主题分享（.svt-theme 导入导出） */}
        <ThemeShareSection settings={settings} update={update} applyPreset={applyPreset} />
      </motion.div>
    </div>
  );
}

/**
 * 主题分享区块：把外观设置打包成 .svt-theme JSON 分享 / 导入他人主题包。
 * 导入经 parseThemeFile 白名单校验后走 applyPreset 立即重放色板。
 */
function ThemeShareSection({
  settings, applyPreset,
}: {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  applyPreset: (next: Partial<AppSettings>) => void;
}) {
  useI18n();
  const [name, setName] = useState('');

  const doExport = () => {
    const exp = buildThemeExport(settings, name || t('themeShare.exportName'));
    downloadBlob(themeFileName(exp.name), new Blob([JSON.stringify(exp, null, 2)], { type: 'application/json' }));
    toast.success(t('themeShare.exported'));
    setName('');
  };

  const doImport = () => {
    if (!confirm(t('themeShare.overwrite'))) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.svt-theme,.svt-theme.json,.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const parsed = parseThemeFile(await file.text());
      if (!parsed) {
        toast.error(t('themeShare.importFail'));
        return;
      }
      applyPreset(parsed.patch);
      toast.success(t('themeShare.imported', { name: parsed.name }));
    };
    input.click();
  };

  return (
    <SettingsSection icon={Share2} title={t('themeShare.title')}>
      <p className="mb-2 px-0.5 text-[11px] leading-relaxed text-ink-2">{t('themeShare.desc')}</p>
      <SettingRow label={t('themeShare.exportName')}>
        <div className="flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('themeShare.exportName')}
            className="w-32 rounded-xl border border-black/10 bg-card px-3 py-1.5 text-xs text-ink outline-none focus:border-accent"
          />
          <button
            onClick={doExport}
            className="flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-xs font-medium text-on-accent transition-transform active:scale-95"
          >
            <Download size={13} />
            {t('common.export')}
          </button>
        </div>
      </SettingRow>
      <SettingRow label={t('themeShare.importPick')}>
        <button
          onClick={doImport}
          className="flex items-center gap-1.5 rounded-full border border-black/10 bg-surface-hi px-3.5 py-1.5 text-xs font-medium text-ink transition-colors hover:border-accent"
        >
          <Upload size={13} />
          {t('common.import')}
        </button>
      </SettingRow>
    </SettingsSection>
  );
}
