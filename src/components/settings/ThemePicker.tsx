/**
 * 主题选择的共享 UI（外观页与首次引导页共用）
 * - 原语：ThemeCard / FlagSwatch / MonetSwatch / PrideSlider / GlassRow
 * - ThemePickerBody：完整的「主要」主题控件（深浅模式 / 预设卡片 / 色相三滑条 /
 *   骄傲旗 + 渐变参数 / 自定义图片选图），供引导页直接嵌入；
 *   外观页在 SettingsSection 内自行拼装同一批控件。
 *
 * 所有变更都通过 update() 落库；主题的实际应用由 App 的 effect
 * （监听 hue / accentHue / darkHue / huePreset / prideFlag / theme）
 * 与 useStore 的 syncModuleSettings（pride 参数）完成，这里无需手动 applyTheme。
 */

import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  getBgImageUrl, loadBgImage, processImageFile, saveBgImage,
} from '@/lib/theme/bgImage';
import { PRIDE_FLAGS } from '@/constants';
import { t } from '@/i18n';
import type { DictKey } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import type { AppSettings, HuePreset, PrideFlag, ThemeMode } from '@/types';
import { Switch } from '@/components/ui';
import { cn } from '@/lib/utils';
import { SettingRow } from './rows';
import { InfoTip } from './InfoTip';

/** 主题卡片：上方色板预览 + 下方名称，选中描边（预设 / 旗帜选择共用） */
export function ThemeCard({ active, onClick, label, children }: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex flex-col gap-1.5 rounded-2xl bg-card p-2 text-left shadow-[0_2px_14px_rgba(28,25,45,0.05),0_1px_3px_rgba(28,25,45,0.04)] transition-transform active:scale-[0.97]',
        // ring-inset：选中描边画在盒内，避免最外侧卡片贴住滚动容器边缘时被裁掉左右两段
        active && 'ring-2 ring-inset ring-accent',
      )}
    >
      <span className="relative block h-10 w-full overflow-hidden rounded-xl border border-line/60">
        {children}
      </span>
      <span className="line-clamp-2 min-h-7 text-[10px] leading-snug font-medium text-ink">{label}</span>
    </button>
  );
}

/** 旗帜色板预览（条纹自上而下） */
export function FlagSwatch({ stripes }: { stripes: readonly string[] }) {
  return (
    <span
      className="block h-full w-full"
      style={{ background: `linear-gradient(to bottom, ${stripes.join(',')})` }}
      aria-hidden
    />
  );
}

/** 莫奈色板预览：表面 → 强调 → 次强调（次强调 = hue+70，与 buildTokens 单色逻辑一致） */
export function MonetSwatch({ hue }: { hue: number }) {
  return (
    <span
      className="block h-full w-full"
      style={{
        background: `linear-gradient(135deg, oklch(0.85 0.06 ${hue}), oklch(0.62 0.12 ${hue}), oklch(0.5 0.12 ${(hue + 70) % 360}))`,
      }}
      aria-hidden
    />
  );
}

/** 毛玻璃强度行（pride 渐变与自定义背景图共用同一参数 prideGlassBlur） */
export function GlassRow({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <SettingRow label={<InfoTip label={t('settings.prideGlass')} text={t('settings.prideGlassDesc')} />}>
      <div className="flex items-center gap-2.5">
        <input
          type="range"
          min={0}
          max={28}
          step={2}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-1.5 w-36 cursor-pointer appearance-none rounded-full bg-surface-hi accent-accent"
          aria-label={t('settings.prideGlass')}
        />
        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-ink-2">
          {value === 0 ? t('settings.prideGlassOff') : `${value}px`}
        </span>
      </div>
    </SettingRow>
  );
}

/** 主题参数滑条（与色相滑条同款拖块） */
export function PrideSlider({
  label, min, max, step, value, onChange, format,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  return (
    <SettingRow label={label}>
      <div className="flex items-center gap-2.5">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-1.5 w-36 cursor-pointer appearance-none rounded-full bg-surface-hi accent-accent"
          aria-label={label}
        />
        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-ink-2">{format(value)}</span>
      </div>
    </SettingRow>
  );
}

/** 色相滑条（彩虹底；主题 / 强调 / 深色三种口径共用同一呈现，仅底色不同） */
function HueSlider({
  label, value, onChange, rainbow, hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  rainbow?: boolean;
  hint?: string;
}) {
  return (
    <SettingRow label={hint ? <InfoTip label={label} text={hint} /> : label}>
      <div className="flex items-center gap-2.5">
        <input
          type="range"
          min={0}
          max={360}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className={cn(
            'h-1.5 w-36 cursor-pointer appearance-none rounded-full accent-accent',
            rainbow ? 'bg-gradient-to-r from-red-400 via-emerald-400 to-violet-500' : 'bg-surface-hi',
          )}
          aria-label={label}
        />
        <span className="w-9 shrink-0 text-right text-xs tabular-nums text-ink-2">{value}°</span>
      </div>
    </SettingRow>
  );
}

/**
 * 主要主题控件（引导页外观步骤 / 外观页主题区共用）
 * 覆盖：深浅模式、三种预设卡片、莫奈三色相滑条、骄傲旗与渐变参数、
 * 自定义图片选图。不含图片的九宫焦点 / 模糊 / 压暗 / 饱和度 / 存在感 / 漂移
 * 与声音染色、音量呼吸等微调项（这些留在 设置 → 外观）。
 */
export function ThemePickerBody({
  settings,
  update,
}: {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
}) {
  useI18n();
  const preset = settings.huePreset ?? 'monet';
  const [bgUrl, setBgUrl] = useState<string | null>(getBgImageUrl());
  const bgFileRef = useRef<HTMLInputElement>(null);

  // 启动预加载完成后刷新缩略图；loadBgImage 幂等，不重复加载
  useEffect(() => {
    let alive = true;
    void loadBgImage().then(() => {
      if (alive) setBgUrl(getBgImageUrl());
    });
    return () => {
      alive = false;
    };
  }, []);

  const setPreset = (p: HuePreset) => update({ huePreset: p });
  const setPrideFlag = (f: PrideFlag) => update({ prideFlag: f });
  const setHue = (hue: number) => {
    // 强调色相 / 深色色相默认跟随主题色相：尚未独立调整（仍相等）时一并更新
    const patch: Partial<AppSettings> = { hue };
    if (settings.accentHue === settings.hue) patch.accentHue = hue;
    if (settings.darkHue === settings.hue) patch.darkHue = hue;
    update(patch);
  };

  const pickBgImage = async (file: File) => {
    try {
      await saveBgImage(await processImageFile(file));
      setBgUrl(getBgImageUrl());
    } catch {
      toast.error(t('toast.bgImageFail'));
    }
  };

  return (
    <>
      {/* 深浅模式 */}
      <SettingRow label={t('settings.theme')}>
        <div className="flex items-center gap-1.5">
          {(
            [
              { id: 'system', key: 'settings.themeSystem' },
              { id: 'light', key: 'settings.themeLight' },
              { id: 'dark', key: 'settings.themeDark' },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => update({ theme: m.id as ThemeMode })}
              aria-pressed={settings.theme === m.id}
              className={cn(
                'rounded-xl px-3 py-2 text-xs font-medium transition-transform active:scale-[0.97]',
                settings.theme === m.id
                  ? 'bg-accent-soft text-on-accent-soft'
                  : 'bg-surface-hi text-ink',
              )}
            >
              {t(m.key as DictKey)}
            </button>
          ))}
        </div>
      </SettingRow>

      {/* 预设配色卡片：色板实时预览 */}
      <SettingRow label={t('settings.huePreset')} stacked>
        <div className="grid grid-cols-3 gap-2.5">
          <ThemeCard active={preset === 'monet'} onClick={() => setPreset('monet')} label={t('settings.presetMonet')}>
            <MonetSwatch hue={settings.hue} />
          </ThemeCard>
          <ThemeCard active={preset === 'pride'} onClick={() => setPreset('pride')} label={t('settings.presetPride')}>
            <FlagSwatch stripes={PRIDE_FLAGS.find((f) => f.id === settings.prideFlag)?.stripes ?? []} />
          </ThemeCard>
          <ThemeCard active={preset === 'image'} onClick={() => setPreset('image')} label={t('settings.bgImage')}>
            {bgUrl ? (
              <img src={bgUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="grid h-full w-full place-items-center bg-surface-hi text-ink-2">
                <ImageIcon size={14} />
              </span>
            )}
          </ThemeCard>
        </div>
      </SettingRow>

      {/* 莫奈 / 图片：三色相滑条（主题 = 取色种子，强调 = 双色调，深色 = 独立铺底） */}
      {(preset === 'monet' || preset === 'image') && (
        <>
          <HueSlider label={t('settings.hue')} value={settings.hue} onChange={setHue} rainbow />
          <HueSlider
            label={t('settings.accentHue')}
            hint={t('settings.accentHueDesc')}
            value={settings.accentHue}
            onChange={(v) => update({ accentHue: v })}
          />
          <HueSlider
            label={t('settings.darkHue')}
            hint={t('settings.darkHueDesc')}
            value={settings.darkHue}
            onChange={(v) => update({ darkHue: v })}
          />
        </>
      )}

      {/* 自定义图片：选图 / 缩略图 / 移除（不含焦点、模糊等微调小项） */}
      {preset === 'image' && (
        <SettingRow label={t('settings.bgImagePick')} stacked>
          <div className="flex items-center gap-2.5">
            {bgUrl && (
              <img src={bgUrl} alt="" className="h-10 w-16 rounded-lg border border-line/60 object-cover" />
            )}
            <button
              type="button"
              onClick={() => bgFileRef.current?.click()}
              className="rounded-full bg-accent-soft px-3.5 py-1.5 text-xs font-semibold text-on-accent-soft transition-transform active:scale-95"
            >
              {t('settings.bgImagePick')}
            </button>
            <input
              ref={bgFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void pickBgImage(f);
              }}
            />
          </div>
        </SettingRow>
      )}

      {/* 骄傲旗：旗帜卡片 + 渐变浓度 / 饱和度 + 漂移 */}
      {preset === 'pride' && (
        <>
          <SettingRow label={t('settings.prideFlag')} stacked>
            <div className="grid grid-cols-3 gap-2.5">
              {PRIDE_FLAGS.map((f) => (
                <ThemeCard
                  key={f.id}
                  active={settings.prideFlag === f.id}
                  onClick={() => setPrideFlag(f.id)}
                  label={t(f.labelKey as DictKey)}
                >
                  <FlagSwatch stripes={f.stripes} />
                </ThemeCard>
              ))}
            </div>
          </SettingRow>
          <PrideSlider
            label={t('settings.prideGlow')}
            min={0.2}
            max={1.6}
            step={0.05}
            value={settings.prideGlow}
            onChange={(v) => update({ prideGlow: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <PrideSlider
            label={t('settings.prideSaturation')}
            min={0.3}
            max={2}
            step={0.05}
            value={settings.prideSaturation}
            onChange={(v) => update({ prideSaturation: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SettingRow label={t('settings.prideDrift')}>
            <Switch
              checked={settings.prideDrift}
              onCheckedChange={(v) => update({ prideDrift: v })}
            />
          </SettingRow>
        </>
      )}
    </>
  );
}
