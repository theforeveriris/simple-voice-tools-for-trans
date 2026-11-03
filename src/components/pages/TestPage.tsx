/**
 * 测试页面
 * 由上到下：模式提示文字（极简，无卡片）→
 *   F1/F2 共振峰曲线 → 音频能量图 → 音高曲线图
 * 三张图按比例分配剩余高度，随录音时间推进实时滚动更新；
 * 短按圆球以当前模式开始录音，长按弹出模式选择，结束后自动进入分析页。
 * 训练靶标启用时：音高图叠加目标带，右上角显示实时偏差与区间达成率。
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Play, Square } from 'lucide-react';
import { toast } from 'sonner';
import { SeriesChart } from '@/components/charts/SeriesChart';
import { LiveSpectrum } from '@/components/charts/LiveSpectrum';
import { recorder } from '@/lib/audio/recorder';
import { freqToNote } from '@/constants';
import { useStore } from '@/store/useStore';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { VowelLiveSheet } from './VowelLiveSheet';
import type { TestMode } from '@/types';
import { cn } from '@/lib/utils';
import { LocateFixed } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui';

/** 图表卡片容器：白底、微圆角、无边框、微阴影 */
function ChartCard({
  title,
  right,
  children,
  className,
}: {
  title: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'relative flex min-h-0 flex-col card-surface p-3.5',
        className,
      )}
    >
      <div className="mb-1.5 flex shrink-0 items-center justify-between px-0.5">
        <span className="text-xs font-medium tracking-wide text-ink-2">{title}</span>
        {right}
      </div>
      <div className="relative min-h-0 flex-1">{children}</div>
    </div>
  );
}

/** 音高图右上角的实时读数（Hz + 钢琴音高 + 靶标偏差），约 8Hz 刷新避免频繁重渲染 */
function LivePitchReadout() {
  const isRecording = useStore((s) => s.isRecording);
  // 非录音态直接静态渲染，避免 effect 内同步重置状态
  if (!isRecording) {
    return (
      <div className="flex items-baseline gap-2 tabular-nums">
        <span className="text-sm text-ink-2">{t('test.noReading')}</span>
      </div>
    );
  }
  return <LiveReadout />;
}

/** 实时读数 + 训练靶标反馈（偏差/达标）+ 区间达成率 */
function LiveReadout() {
  useI18n();
  const targetEnabled = useStore((s) => s.settings.targetEnabled);
  const targetMin = useStore((s) => s.settings.targetF0Min);
  const targetMax = useStore((s) => s.settings.targetF0Max);
  const [readout, setReadout] = useState<{
    freq: number; note: string; inPct: number;
  } | null>(null);

  useEffect(() => {
    let raf = 0;
    let lastUpdate = 0;
    const loop = (now: number) => {
      if (now - lastUpdate > 120) {
        lastUpdate = now;
        const pitch = recorder.lastPitch;
        // 区间达成率：对当前实时缓冲统计（约 8Hz 重算足够）
        let inPct: number | null = null;
        if (targetEnabled) {
          const live = recorder.getLive();
          let voiced = 0;
          let inside = 0;
          for (const f of live.f0) {
            if (!isFinite(f) || f <= 0) continue;
            voiced++;
            if (f >= targetMin && f <= targetMax) inside++;
          }
          if (voiced > 0) inPct = Math.round((inside / voiced) * 100);
        }
        setReadout({
          freq: pitch ? pitch.freq : 0,
          note: pitch ? freqToNote(pitch.freq).name : '',
          inPct: inPct ?? -1,
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [targetEnabled, targetMin, targetMax]);

  const pitch = readout && readout.note ? readout : null;
  const inTarget = pitch != null && pitch.freq >= targetMin && pitch.freq <= targetMax;
  const deviation = pitch == null ? 0 : pitch.freq < targetMin ? pitch.freq - targetMin : pitch.freq - targetMax;

  return (
    <div className="flex items-center gap-2.5">
      {targetEnabled && readout && readout.inPct >= 0 && (
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold tabular-nums text-on-accent-soft">
          {t('test.inTargetPct', { pct: readout.inPct })}
        </span>
      )}
      <div className="flex items-baseline gap-2 tabular-nums">
        {pitch ? (
          <>
            <span className="text-lg font-semibold text-ink">{pitch.freq.toFixed(1)}</span>
            <span className="text-[11px] text-ink-2">Hz</span>
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-on-accent-soft">
              {pitch.note}
            </span>
            {targetEnabled && (
              <span
                className={cn(
                  'text-[11px] font-semibold tabular-nums',
                  inTarget ? 'text-accent' : 'text-ink-2',
                )}
              >
                {inTarget
                  ? t('test.inTargetOn')
                  : t(deviation < 0 ? 'test.inTargetBelow' : 'test.inTargetAbove', { hz: Math.abs(Math.round(deviation)) })}
              </span>
            )}
          </>
        ) : (
          <span className="text-sm text-ink-2">{t('test.noReading')}</span>
        )}
      </div>
    </div>
  );
}

/** 共振峰图例 */
function FormantLegend() {
  return (
    <div className="flex items-center gap-3 text-[11px] text-ink-2">
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-accent" /> F1
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-accent2" /> F2
      </span>
    </div>
  );
}

/** 悬浮胶囊模式下的极简模式提示 */
const MODE_HINT_KEY: Record<TestMode, 'test.hintReading' | 'test.hintSustained' | 'test.hintGlide'> = {
  reading: 'test.hintReading',
  sustained: 'test.hintSustained',
  glide: 'test.hintGlide',
};

function ModeHint({ mode }: { mode: TestMode }) {
  return (
    <p className="mx-auto w-[60%] py-0.5 text-center text-xs text-ink-2">{t(MODE_HINT_KEY[mode])}</p>
  );
}

/** 悬浮胶囊模式下的录音灵动岛（经典底栏用顶部状态条替代） */
function RecordingIsland() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      if (now - last > 200) {
        last = now;
        setElapsed(recorder.getLive().elapsedSec);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const mm = Math.floor(elapsed / 60);
  const ss = Math.floor(elapsed % 60);
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 26 }}
      className="mx-auto flex w-fit items-center gap-2 rounded-full bg-black/85 py-1.5 pl-3 pr-3.5 shadow-[0_4px_16px_rgba(0,0,0,0.25)]"
      role="status"
      aria-label={t('vowelLive.recordingBadge')}
    >
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-accent" />
      </span>
      <span className="text-[11px] font-semibold tabular-nums text-white/90">
        {mm}:{String(ss).padStart(2, '0')}
      </span>
    </motion.div>
  );
}

/** 模式显示名 */
const MODE_LABEL_KEY: Record<TestMode, 'mode.reading' | 'mode.sustained' | 'mode.glide'> = {
  reading: 'mode.reading',
  sustained: 'mode.sustained',
  glide: 'mode.glide',
};

/** 录音计时（仅录音时挂载，重新开始会归零） */
function RecordingElapsed() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setElapsed(recorder.getLive().elapsedSec), 250);
    return () => window.clearInterval(id);
  }, []);
  const mm = Math.floor(elapsed / 60);
  const ss = Math.floor(elapsed % 60);
  return <span className="tabular-nums">{mm}:{String(ss).padStart(2, '0')}</span>;
}

/**
 * 测试页录音头：模式 / 目标 / 开始停止。
 * 测试页本身不滚动，这一行始终可见；导航栏只负责切页。
 */
function TestRecordHeader() {
  useI18n();
  const mode = useStore((s) => s.settings.testMode);
  const updateSettings = useStore((s) => s.updateSettings);
  const isRecording = useStore((s) => s.isRecording);
  const targetEnabled = useStore((s) => s.settings.targetEnabled);
  const targetMin = useStore((s) => s.settings.targetF0Min);
  const targetMax = useStore((s) => s.settings.targetF0Max);

  return (
    <div className="flex items-center gap-2">
      <Select value={mode} onValueChange={(v) => updateSettings({ testMode: v as TestMode })}>
        <SelectTrigger className="h-8 w-auto gap-1.5 rounded-full border border-black/10 bg-card px-3 text-xs font-medium text-ink shadow-none">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" className="rounded-2xl border-0 bg-card shadow-lg">
          {(['reading', 'sustained', 'glide'] as const).map((m) => (
            <SelectItem key={m} value={m}>{t(MODE_LABEL_KEY[m])}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {targetEnabled && (
        <span className="hidden rounded-full bg-surface-hi px-2.5 py-1 text-[10px] font-medium tabular-nums text-ink-2 sm:inline-flex">
          {targetMin}–{targetMax} Hz
        </span>
      )}

      {isRecording && (
        <span className="ml-auto flex items-center gap-1.5 rounded-full bg-ink px-2.5 py-1 text-[10px] font-medium text-surface">
          <span className="size-1.5 animate-pulse rounded-full bg-accent" />
          <RecordingElapsed />
        </span>
      )}
    </div>
  );
}

/**
 * 音高曲线卡片右下角的扇形录音键。
 * 直角贴住卡片右下角，左上角做成四分之一圆；图标靠近圆心（右下），
 * 录音中换成结束方块，计时放在顶部状态条。
 */
function FanRecordButton() {
  const isRecording = useStore((s) => s.isRecording);
  const startRecording = useStore((s) => s.startRecording);
  const stopRecording = useStore((s) => s.stopRecording);

  const toggle = () => {
    if (isRecording) {
      void stopRecording();
    } else {
      void startRecording().catch(() => toast.error(t('toast.micError')));
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isRecording ? t('test.stopRecording') : t('test.startRecording')}
      title={isRecording ? t('test.stopRecording') : t('test.startRecording')}
      className={cn(
        'absolute -bottom-2 -right-2 z-10 grid size-[3.375rem] place-items-end justify-items-end overflow-hidden rounded-br-[20px] text-on-accent shadow-[0_6px_18px_-6px_rgb(var(--c-accent-rgb)/0.5)] transition-transform active:scale-95',
        isRecording ? 'bg-ink text-surface' : 'bg-accent',
      )}
      style={{ borderTopLeftRadius: '100%' }}
    >
      <span className="mb-2.5 mr-2.5 grid place-items-center">
        {isRecording
          ? <Square size={15} fill="currentColor" strokeWidth={0} />
          : <Play size={16} fill="currentColor" strokeWidth={0} className="translate-x-[1px]" />}
      </span>
    </button>
  );
}

export function TestPage() {
  useI18n();
  const navStyle = useStore((s) => s.settings.navStyle);
  const mode = useStore((s) => s.settings.testMode);
  const isRecording = useStore((s) => s.isRecording);
  const targetEnabled = useStore((s) => s.settings.targetEnabled);
  const targetMin = useStore((s) => s.settings.targetF0Min);
  const targetMax = useStore((s) => s.settings.targetF0Max);
  const liveSpectrum = useStore((s) => s.settings.liveSpectrum);
  const [vowelLiveOpen, setVowelLiveOpen] = useState(false);
  // 图表延迟挂载：三张 Canvas 的 rAF 绘制循环会占用主线程，
  // 推迟到页面入场与底栏弹簧动画结束（约 300ms）后再启动，保证动效满帧
  const [chartsReady, setChartsReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setChartsReady(true), 300);
    return () => clearTimeout(timer);
  }, []);

  // 经典底栏：测试页 Space = 开始 / 停止录音（悬浮胶囊仍由 BottomBar 处理 Space）
  useEffect(() => {
    if (navStyle !== 'classic') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (
        target
        && (target.tagName === 'INPUT'
          || target.tagName === 'TEXTAREA'
          || target.tagName === 'SELECT'
          || target.tagName === 'BUTTON'
          || target.isContentEditable)
      ) return;
      e.preventDefault();
      const st = useStore.getState();
      if (st.isRecording) void st.stopRecording();
      else void st.startRecording().catch(() => toast.error(t('toast.micError')));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navStyle]);

  return (
    // 高度下探到距底栏约 12px；经典底栏更矮，单独减掉安全区；
    // -mb-14 抵消 main 的底部留白，页面不产生滚动；三张图按比例分配剩余高度。
    <div
      className={cn(
        '-mb-14 flex min-h-[360px] flex-col gap-3 sm:gap-3.5',
        navStyle === 'classic'
          ? 'h-[calc(100dvh-6.5rem-env(safe-area-inset-bottom))]'
          : 'h-[calc(100dvh-7.25rem)]',
      )}
    >
      {navStyle === 'classic'
        ? <TestRecordHeader />
        : (isRecording ? <RecordingIsland /> : <ModeHint mode={mode} />)}

      {/* F1 / F2 共振峰 */}
      <ChartCard
        title={t('test.titleFormant')}
        right={
          <div className="flex items-center gap-1.5">
            <FormantLegend />
            <button
              onClick={() => setVowelLiveOpen(true)}
              className="grid size-7 place-items-center rounded-full text-ink-2 transition-colors hover:bg-surface-hi hover:text-accent"
              aria-label={t('vowelLive.openAria')}
              title={t('vowelLive.title')}
            >
              <LocateFixed size={14} />
            </button>
          </div>
        }
        className="min-h-[72px] shrink basis-0 grow-[6]"
      >
        {chartsReady && <SeriesChart kind="formant" live />}
      </ChartCard>

      {/* 音频能量 */}
      <ChartCard title={t('test.titleEnergy')} className="min-h-[60px] shrink basis-0 grow-[5]">
        {chartsReady && <SeriesChart kind="energy" live />}
      </ChartCard>

      {/* 音高曲线 */}
      <ChartCard
        title={t('test.titlePitch')}
        right={
          <div className="flex items-center gap-2">
            {targetEnabled && (
              <span className="hidden text-[10px] tabular-nums text-ink-2 sm:inline">
                {t('test.targetLegend', { min: targetMin, max: targetMax })}
              </span>
            )}
            <LivePitchReadout />
          </div>
        }
        className={cn(
          'min-h-[130px] shrink basis-0 grow-[12]',
          navStyle === 'classic' && 'overflow-hidden',
        )}
      >
        {chartsReady && <SeriesChart kind="pitch" live />}
        {navStyle === 'classic' && <FanRecordButton />}
      </ChartCard>

      {/* 实时频谱（实验性）：窄带幅度谱，可见谐波列与共振峰峰包 */}
      {liveSpectrum && (
        <ChartCard title={t('test.titleSpectrum')} className="min-h-[72px] shrink basis-0 grow-[4]">
          {chartsReady && <LiveSpectrum />}
        </ChartCard>
      )}

      {/* 实时元音落点（实验性，全屏子页面） */}
      {vowelLiveOpen && <VowelLiveSheet onClose={() => setVowelLiveOpen(false)} />}
    </div>
  );
}
