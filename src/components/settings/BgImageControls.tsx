/**
 * 自定义背景图片参数（外观页「自定义图片」预设与组件外观页共用）
 *
 * 图片本体存 IndexedDB，参数写 AppSettings.bgImage*，由 applyBgImage 同步到
 * CSS 变量；这里的 UI 只负责选图 / 移除 / 焦点 / 模糊 / 压暗 / 饱和度 /
 * 存在感 / 漂移。两种主题都复用同一批参数，避免两套背景图配置。
 *
 * compact：组件外观页内嵌使用——选图按钮内联，进阶参数折叠进「图片参数」，
 * 避免图片模式把整页拉得很长。
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { getBgImageUrl, loadBgImage, processImageFile, removeBgImage, saveBgImage } from '@/lib/theme/bgImage';
import { t } from '@/i18n';
import type { DictKey } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import type { AppSettings, BgImageFocus } from '@/types';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui';
import { InfoTip } from './InfoTip';
import { GlassRow, PrideSlider } from './ThemePicker';
import { SettingRow } from './rows';

/** 九宫焦点：展示顺序（左上 → 右下）与各方向词条 */
const BG_FOCUS_KEYS: BgImageFocus[] = [
  'top-left', 'top', 'top-right',
  'left', 'center', 'right',
  'bottom-left', 'bottom', 'bottom-right',
];

const BG_FOCUS_LABEL: Record<BgImageFocus, DictKey> = {
  'top-left': 'settings.bgPosTopLeft',
  'top': 'settings.bgPosTop',
  'top-right': 'settings.bgPosTopRight',
  'left': 'settings.bgPosLeft',
  'center': 'settings.bgPosCenter',
  'right': 'settings.bgPosRight',
  'bottom-left': 'settings.bgPosBottomLeft',
  'bottom': 'settings.bgPosBottom',
  'bottom-right': 'settings.bgPosBottomRight',
};

export function BgImageControls({
  settings,
  update,
  onGlassBlur,
  onImageChange,
  compact = false,
}: {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  onGlassBlur?: (v: number) => void;
  /** 选图 / 移除后通知外部刷新缩略图 */
  onImageChange?: (url: string | null) => void;
  /** 组件外观页内嵌：选图内联，进阶参数折叠 */
  compact?: boolean;
}) {
  useI18n();
  const [bgUrl, setBgUrl] = useState<string | null>(getBgImageUrl());
  const fileRef = useRef<HTMLInputElement>(null);

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

  const pick = async (file: File) => {
    try {
      await saveBgImage(await processImageFile(file));
      const url = getBgImageUrl();
      setBgUrl(url);
      onImageChange?.(url);
    } catch {
      toast.error(t('toast.bgImageFail'));
    }
  };

  const remove = () => {
    void removeBgImage().then(() => {
      const url = getBgImageUrl();
      setBgUrl(url);
      onImageChange?.(url);
    });
  };

  const thumbnail = bgUrl ? (
    <img
      src={bgUrl}
      alt=""
      className={cn(
        'rounded-lg border border-line/60 object-cover',
        compact ? 'h-9 w-14' : 'h-10 w-16',
      )}
    />
  ) : null;

  const pickButton = (
    <button
      type="button"
      onClick={() => fileRef.current?.click()}
      className={cn(
        'rounded-full font-semibold transition-transform active:scale-95',
        compact
          ? 'bg-accent px-3 py-1.5 text-[11px] text-on-accent'
          : 'bg-accent-soft px-3.5 py-1.5 text-xs text-on-accent-soft',
      )}
    >
      {t('settings.bgImagePick')}
    </button>
  );

  const removeButton = bgUrl ? (
    <button
      type="button"
      onClick={remove}
      className={cn(
        'rounded-full bg-surface-hi font-semibold text-ink-2 transition-transform active:scale-95',
        compact ? 'px-3 py-1.5 text-[11px]' : 'px-3.5 py-1.5 text-xs',
      )}
    >
      {t('settings.bgImageRemove')}
    </button>
  ) : null;

  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = ''; // 允许重复选择同一文件
        if (f) void pick(f);
      }}
    />
  );

  const advanced = (
    <>
      {/* 九宫焦点：cover 裁切的锚点 */}
      <SettingRow label={t('settings.bgImageFocus')} stacked>
        <div className="grid w-24 grid-cols-3 gap-1" role="group" aria-label={t('settings.bgImageFocus')}>
          {BG_FOCUS_KEYS.map((k) => {
            const active = settings.bgImageFocus === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => update({ bgImageFocus: k })}
                aria-pressed={active}
                aria-label={t(BG_FOCUS_LABEL[k])}
                className={cn(
                  'grid h-7 place-items-center rounded-lg bg-surface-hi transition-all active:scale-90',
                  active && 'ring-1 ring-accent',
                )}
              >
                <span className={cn('size-1.5 rounded-full', active ? 'bg-accent' : 'bg-ink-2/40')} />
              </button>
            );
          })}
        </div>
      </SettingRow>
      <PrideSlider
        label={t('settings.bgImageBlur')}
        min={0}
        max={60}
        step={2}
        value={settings.bgImageBlur}
        onChange={(v) => update({ bgImageBlur: v })}
        format={(v) => `${v}px`}
      />
      {/* 压暗：深色模式在 CSS 内自动加深 1.5 倍 */}
      <SettingRow
        label={<InfoTip label={t('settings.bgImageDim')} text={t('settings.bgImageDimDesc')} />}
      >
        <div className="flex items-center gap-2.5">
          <input
            type="range"
            min={0}
            max={0.6}
            step={0.05}
            value={settings.bgImageDim}
            onChange={(e) => update({ bgImageDim: Number(e.target.value) })}
            className="h-1.5 w-36 cursor-pointer appearance-none rounded-full bg-surface-hi accent-accent"
            aria-label={t('settings.bgImageDim')}
          />
          <span className="w-10 shrink-0 text-right text-xs tabular-nums text-ink-2">
            {Math.round(settings.bgImageDim * 100)}%
          </span>
        </div>
      </SettingRow>
      <PrideSlider
        label={t('settings.bgImageSat')}
        min={0.3}
        max={2}
        step={0.05}
        value={settings.bgImageSaturation}
        onChange={(v) => update({ bgImageSaturation: v })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <PrideSlider
        label={t('settings.bgImageAlpha')}
        min={0}
        max={1}
        step={0.05}
        value={settings.bgImageOpacity}
        onChange={(v) => update({ bgImageOpacity: v })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <SettingRow label={t('settings.bgImageDrift')}>
        <Switch
          checked={settings.bgImageDrift}
          onCheckedChange={(v) => update({ bgImageDrift: v })}
        />
      </SettingRow>
      {/* 毛玻璃强度：卡片透过图片的磨砂程度 */}
      <GlassRow
        value={settings.prideGlassBlur}
        onChange={(v) => (onGlassBlur ?? ((x: number) => update({ prideGlassBlur: x })))(v)}
      />
    </>
  );

  if (compact) {
    return (
      <>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {thumbnail}
          {pickButton}
          {removeButton}
          {fileInput}
        </div>
        <details className="group mt-1.5">
          <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg bg-surface-hi/60 px-2.5 py-1.5 text-[10px] font-medium text-ink-2 transition-colors hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 [&::-webkit-details-marker]:hidden">
            {t('customTheme.imageOptions')}
            <ChevronDown size={12} className="transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-0.5">{advanced}</div>
        </details>
      </>
    );
  }

  return (
    <>
      <SettingRow label={t('settings.bgImage')} stacked>
        <div className="flex items-center gap-2.5">
          {thumbnail}
          {pickButton}
          {removeButton}
          {fileInput}
        </div>
      </SettingRow>
      {advanced}
    </>
  );
}
