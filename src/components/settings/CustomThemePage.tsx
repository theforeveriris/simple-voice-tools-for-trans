/**
 * 组件外观（自定义配色系统）子页
 *
 * 在莫奈色板之上按组件部位覆盖样式：页面、卡片、顶栏、底栏、主按钮、输入框、弹层。
 * 浅色 / 深色各一套；每次修改立即写入 settings.customTheme，App 的主题 effect
 * 会即时重放覆盖层（实时预览）。未设置的属性继续继承当前主题。
 */
import { useEffect, useRef, useState } from 'react';
import type { ElementType } from 'react';
import { ArrowLeft, Braces, ChevronRight, Palette, RotateCcw, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import type { AppSettings, CustomGradient, CustomPartStyle, CustomTheme, CustomThemePart } from '@/types';
import { useI18n } from '@/i18n/hook';
import { t } from '@/i18n';
import type { DictKey } from '@/i18n';
import { CUSTOM_THEME_PART_IDS, autoTextColor, parseCustomThemeJson } from '@/lib/theme/customTheme';
import { registerBackClose } from '@/lib/backNav';
import { BgImageControls } from './BgImageControls';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui';
import { cn } from '@/lib/utils';

const EMPTY: CustomTheme = { version: 1, light: {}, dark: {} };

const PART_LABEL: Record<CustomThemePart, DictKey> = {
  page: 'customTheme.partPage',
  card: 'customTheme.partCard',
  topbar: 'customTheme.partTopbar',
  bottombar: 'customTheme.partBottombar',
  primaryButton: 'customTheme.partPrimaryButton',
  input: 'customTheme.partInput',
  dialog: 'customTheme.partDialog',
};

/**
 * 颜色行：未设置时不显示假白色块，而是一枚虚线空环；
 * 已设置时显示实际色块与清除按钮。桌面端额外显示 hex。
 */
function ColorField({
  label, value, fallback, fallbackLabel, onChange, onClear, clearable = true,
}: {
  label: string;
  value: string | undefined;
  /** value 为空时显示的推导色（例如按背景自动对比的文字色） */
  fallback?: string;
  fallbackLabel?: string;
  onChange: (v: string) => void;
  onClear: () => void;
  clearable?: boolean;
}) {
  const shown = value ?? fallback;
  const status = value ? null : fallbackLabel ?? t('customTheme.inherit');
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 py-1">
      <span className="min-w-0 truncate text-[11px] text-ink-2">{label}</span>
      <div className="flex shrink-0 items-center rounded-full bg-surface-hi focus-within:ring-1 focus-within:ring-accent/60">
        <label className="flex cursor-pointer items-center gap-1.5 py-0.5 pl-1 pr-2 focus:outline-none">
          <span
            className={cn(
              'relative grid size-5 shrink-0 place-items-center overflow-hidden rounded-full border bg-card',
              value ? 'border-line' : 'border-dashed border-line',
            )}
          >
            {shown
              ? <span className="absolute inset-0" style={{ background: shown }} />
              : <span className="relative text-[9px] leading-none text-ink-2/70">–</span>}
            <input
              type="color"
              value={value ?? fallback ?? '#ffffff'}
              onChange={(e) => onChange(e.target.value)}
              aria-label={label}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </span>
          <span className={cn('text-[10px] text-ink-2', value && 'font-mono')}>
            {value ?? status}
          </span>
        </label>
        {value && clearable && (
          <button
            type="button"
            onClick={onClear}
            aria-label={t('customTheme.inherit')}
            className="mr-0.5 grid size-5 shrink-0 place-items-center rounded-full text-ink-2/60 transition-colors hover:bg-surface-hi hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
          >
            <X size={10} />
          </button>
        )}
      </div>
    </div>
  );
}

function SliderField({
  label, value, min, max, step = 1, unit, format, onChange, onClear, clearable = true,
}: {
  label: string;
  value: number | undefined;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  onClear: () => void;
  clearable?: boolean;
}) {
  return (
    <div className="py-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-ink-2">{label}</span>
        <div className="flex items-center gap-1">
          <span className="font-mono text-[10px] tabular-nums text-ink-2/70">
            {value == null ? t('customTheme.inherit') : (format ? format(value) : `${value}${unit ?? ''}`)}
          </span>
          {value != null && clearable && (
            <button
              type="button"
              onClick={onClear}
              aria-label={t('customTheme.inherit')}
              className="grid size-5 place-items-center rounded-full text-ink-2/60 transition-colors hover:bg-surface-hi hover:text-ink"
            >
              <X size={10} />
            </button>
          )}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value ?? min}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="mt-0.5 w-full cursor-pointer accent-[var(--c-accent)]"
      />
    </div>
  );
}

/** 卡片标题：与设置页其他分块保持一致（图标 + 粗体标题） */
function SectionTitle({ icon: Icon, children }: { icon: ElementType; children: string }) {
  return (
    <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
      <Icon size={15} className="text-accent" />
      {children}
    </p>
  );
}

export function CustomThemePage({
  settings,
  update,
  onBack,
}: {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  onBack: () => void;
}) {
  useI18n();
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);
  // 嵌套子页：返回手势先关本页，再回外观页
  useEffect(() => registerBackClose(() => onBackRef.current()), []);

  const dark = settings.theme === 'dark'
    || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const mode: 'light' | 'dark' = dark ? 'dark' : 'light';
  const theme = settings.customTheme ?? EMPTY;
  const modeStyles = theme[mode] ?? {};
  const [part, setPart] = useState<CustomThemePart>('page');
  const style: CustomPartStyle = modeStyles[part] ?? {};
  /** 任一模式存在覆盖时才显示固定恢复按钮（干净状态不遮挡滑条） */
  const hasAnyOverride = Object.keys(theme.light ?? {}).length > 0
    || Object.keys(theme.dark ?? {}).length > 0;
  const hasStyle = Object.keys(style).length > 0;
  /** 原始 JSON 编辑器 */
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  const setStyle = (patch: Partial<CustomPartStyle>) => {
    const nextStyle: CustomPartStyle = { ...style, ...patch };
    for (const key of Object.keys(nextStyle) as (keyof CustomPartStyle)[]) {
      if (nextStyle[key] === undefined) delete nextStyle[key];
    }
    const nextMode = { ...modeStyles };
    if (Object.keys(nextStyle).length > 0) nextMode[part] = nextStyle;
    else delete nextMode[part];
    const next: CustomTheme = { ...theme, [mode]: nextMode };
    update({ customTheme: next, huePreset: 'custom' });
  };

  const resetPart = () => {
    const nextMode = { ...modeStyles };
    delete nextMode[part];
    update({ customTheme: { ...theme, [mode]: nextMode }, huePreset: 'custom' });
  };

  const resetAll = () => {
    if (!confirm(t('customTheme.resetConfirm'))) return;
    update({ customTheme: null, huePreset: 'custom' });
  };

  /** 打开原始 JSON 编辑器，初始值取当前完整配置（含浅色 / 深色） */
  const openJson = () => {
    setJsonText(JSON.stringify(settings.customTheme ?? EMPTY, null, 2));
    setJsonError(null);
    setJsonOpen(true);
  };

  const formatJson = () => {
    try {
      setJsonText(JSON.stringify(JSON.parse(jsonText), null, 2));
      setJsonError(null);
    } catch {
      setJsonError(t('customTheme.jsonError'));
    }
  };

  const resetJson = () => {
    setJsonText(JSON.stringify(settings.customTheme ?? EMPTY, null, 2));
    setJsonError(null);
  };

  const applyJson = () => {
    const parsed = parseCustomThemeJson(jsonText);
    if (parsed === undefined) {
      setJsonError(t('customTheme.jsonError'));
      return;
    }
    update({ customTheme: parsed, huePreset: 'custom' });
    setJsonOpen(false);
  };

  const bgMode = style.image ? 'image' : style.gradient ? 'gradient' : style.bg ? 'solid' : 'inherit';
  /** 页面背景可选图片；其他部位只支持纯色 / 渐变 */
  const bgModes = part === 'page'
    ? (['inherit', 'solid', 'gradient', 'image'] as const)
    : (['inherit', 'solid', 'gradient'] as const);
  const defaultBg = mode === 'dark' ? '#16121a' : '#ffffff';
  const gradient: CustomGradient = style.gradient ?? {
    angle: 135,
    from: style.bg ?? defaultBg,
    to: '#9a6bff',
  };
  const autoText = bgMode === 'solid' || bgMode === 'gradient';

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 pb-4">
      <div className="flex items-center gap-3" data-theme-part="topbar">
        <button
          onClick={() => window.history.back()}
          aria-label={t('common.back')}
          className="grid size-10 place-items-center rounded-full bg-card text-ink shadow-[0_2px_14px_rgba(28,25,45,0.05),0_1px_3px_rgba(28,25,45,0.04)] transition-transform active:scale-90"
        >
          <ArrowLeft size={18} />
        </button>
        <p className="min-w-0 flex-1 truncate text-base font-semibold text-ink">{t('customTheme.title')}</p>
        <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
          {t('customTheme.live')}
        </span>
        {hasAnyOverride && (
          <button
            type="button"
            onClick={resetAll}
            aria-label={t('customTheme.resetAll')}
            title={t('customTheme.resetAll')}
            className="grid size-8 shrink-0 place-items-center rounded-full text-ink-2 transition-colors hover:bg-surface-hi hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
          >
            <RotateCcw size={13} />
          </button>
        )}
      </div>

      <p className="px-1 text-[11px] leading-relaxed text-ink-2/80">{t('customTheme.subtitle')}</p>

      {/* 浅色 / 深色 + 组件选择：合并为一张卡，组件换行展示不横向截断 */}
      <div className="card-surface p-4">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-ink-2">{t('customTheme.editMode')}</span>
          <div className="ml-auto inline-flex rounded-full bg-surface-hi p-0.5">
            {(['light', 'dark'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => update({ theme: m })}
                aria-pressed={mode === m}
                className={cn(
                  'rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60',
                  mode === m ? 'bg-accent text-on-accent shadow-sm' : 'text-ink-2 hover:text-ink',
                )}
              >
                {t(m === 'light' ? 'customTheme.light' : 'customTheme.dark')}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
          {CUSTOM_THEME_PART_IDS.map((id) => {
            const customized = Object.keys(modeStyles[id] ?? {}).length > 0;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setPart(id)}
                aria-pressed={part === id}
                title={customized ? t('customTheme.overridden') : t('customTheme.inherited')}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60',
                  part === id ? 'bg-accent text-on-accent shadow-sm' : 'bg-surface-hi text-ink-2 hover:text-ink',
                )}
              >
                {t(PART_LABEL[id])}
                {customized && (
                  <span
                    className={cn(
                      'size-1 rounded-full',
                      part === id ? 'bg-on-accent' : 'bg-accent',
                    )}
                    aria-hidden
                  />
                )}
              </button>
            );
          })}
          {hasStyle && (
            <button
              type="button"
              onClick={resetPart}
              className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-[10px] font-medium text-ink-2 transition-colors hover:bg-surface-hi hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
            >
              <RotateCcw size={11} />
              {t('customTheme.resetPart')}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={openJson}
          className="mt-3 flex w-full items-center gap-2 border-t border-line pt-3 text-left text-[11px] font-medium text-ink-2 transition-colors hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
        >
          <Braces size={13} className="shrink-0 text-accent" />
          <span>{t('customTheme.editJson')}</span>
          <ChevronRight size={13} className="ml-auto shrink-0" />
        </button>
      </div>

      {/* 背景 */}
      <div className="card-surface p-4">
        <SectionTitle icon={Palette}>{t('customTheme.background')}</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {bgModes.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                if (m === 'inherit') setStyle({ bg: undefined, gradient: undefined, image: undefined });
                else if (m === 'solid') setStyle({ gradient: undefined, image: undefined, bg: style.bg ?? defaultBg });
                else if (m === 'gradient') setStyle({ bg: undefined, image: undefined, gradient });
                else setStyle({ bg: undefined, gradient: undefined, image: true });
              }}
              aria-pressed={bgMode === m}
              className={cn(
                'rounded-full px-2.5 py-1.5 text-[10px] font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60',
                bgMode === m ? 'bg-accent text-on-accent' : 'bg-surface-hi text-ink-2 hover:text-ink',
              )}
            >
              {t(m === 'inherit' ? 'customTheme.inherit' : m === 'solid' ? 'customTheme.solid' : m === 'gradient' ? 'customTheme.gradient' : 'customTheme.image')}
            </button>
          ))}
        </div>

        {bgMode === 'solid' && (
          <ColorField
            label={t('customTheme.color')}
            value={style.bg}
            onChange={(bg) => setStyle({ bg })}
            onClear={() => setStyle({ bg: undefined })}
          />
        )}
        {bgMode === 'gradient' && (
          <>
            <div className="mt-1 grid grid-cols-2 gap-x-4">
              <ColorField
                label={t('customTheme.gradientFrom')}
                value={gradient.from}
                onChange={(from) => setStyle({ gradient: { ...gradient, from } })}
                onClear={() => setStyle({ gradient: undefined })}
                clearable={false}
              />
              <ColorField
                label={t('customTheme.gradientTo')}
                value={gradient.to}
                onChange={(to) => setStyle({ gradient: { ...gradient, to } })}
                onClear={() => setStyle({ gradient: undefined })}
                clearable={false}
              />
            </div>
            <SliderField
              label={t('customTheme.angle')}
              value={gradient.angle}
              min={0}
              max={360}
              unit="°"
              onChange={(angle) => setStyle({ gradient: { ...gradient, angle } })}
              onClear={() => setStyle({ gradient: undefined })}
              clearable={false}
            />
          </>
        )}
        {bgMode === 'image' && (
          <>
            <p className="mt-1.5 text-[10px] leading-relaxed text-ink-2/70">{t('customTheme.imageHint')}</p>
            <BgImageControls compact settings={settings} update={update} />
          </>
        )}
      </div>

      {/* 文字 / 边框 / 圆角 */}
      <div className="card-surface p-4">
        <SectionTitle icon={SlidersHorizontal}>{t('customTheme.style')}</SectionTitle>
        <ColorField
          label={t('customTheme.text')}
          value={style.text}
          fallback={autoText ? autoTextColor(style) : undefined}
          fallbackLabel={autoText ? t('customTheme.autoContrast') : undefined}
          onChange={(text) => setStyle({ text })}
          onClear={() => setStyle({ text: undefined })}
        />
        <ColorField
          label={t('customTheme.borderColor')}
          value={style.border}
          onChange={(border) => setStyle({ border })}
          onClear={() => setStyle({ border: undefined })}
        />
        <SliderField
          label={t('customTheme.borderWidth')}
          value={style.borderWidth}
          min={0}
          max={8}
          unit="px"
          onChange={(borderWidth) => setStyle({ borderWidth })}
          onClear={() => setStyle({ borderWidth: undefined })}
        />
        <SliderField
          label={t('customTheme.radius')}
          value={style.radius}
          min={0}
          max={40}
          unit="px"
          onChange={(radius) => setStyle({ radius })}
          onClear={() => setStyle({ radius: undefined })}
        />
      </div>

      {/* 效果 */}
      <div className="card-surface p-4">
        <SectionTitle icon={Sparkles}>{t('customTheme.effects')}</SectionTitle>
        <SliderField
          label={t('customTheme.blur')}
          value={style.blur}
          min={0}
          max={40}
          unit="px"
          onChange={(blur) => setStyle({ blur })}
          onClear={() => setStyle({ blur: undefined })}
        />
        <SliderField
          label={t('customTheme.opacity')}
          value={style.opacity}
          min={0.2}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(opacity) => setStyle({ opacity })}
          onClear={() => setStyle({ opacity: undefined })}
        />
      </div>

      {/* 原始 JSON 配置：高级入口，校验后走 normalizeCustomTheme */}
      <Dialog
        open={jsonOpen}
        onOpenChange={(open) => {
          setJsonOpen(open);
          if (!open) setJsonError(null);
        }}
      >
        <DialogContent
          className="gap-3 overflow-y-auto"
          style={{ maxWidth: 'min(42rem, calc(100vw - 1.5rem))', maxHeight: '90dvh' }}
        >
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold text-ink">
              {t('customTheme.editJson')}
            </DialogTitle>
            <DialogDescription className="text-[11px] leading-relaxed text-ink-2">
              {t('customTheme.jsonDesc')}
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={jsonText}
            onChange={(e) => {
              setJsonText(e.target.value);
              setJsonError(null);
            }}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label={t('customTheme.editJson')}
            className="min-h-[42vh] w-full resize-y rounded-xl border border-line bg-surface-hi p-3 font-mono text-[11px] leading-relaxed text-ink outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
          />
          {jsonError && (
            <p className="text-[11px] leading-relaxed text-destructive">{jsonError}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={formatJson}
              className="rounded-full bg-surface-hi px-3 py-1.5 text-[11px] font-medium text-ink-2 transition-colors hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
            >
              {t('customTheme.jsonFormat')}
            </button>
            <button
              type="button"
              onClick={resetJson}
              className="rounded-full bg-surface-hi px-3 py-1.5 text-[11px] font-medium text-ink-2 transition-colors hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
            >
              {t('common.reset')}
            </button>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setJsonOpen(false)}
                className="rounded-full px-3 py-1.5 text-[11px] font-medium text-ink-2 transition-colors hover:bg-surface-hi hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={applyJson}
                className="rounded-full bg-accent px-3.5 py-1.5 text-[11px] font-semibold text-on-accent transition-transform active:scale-95 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
