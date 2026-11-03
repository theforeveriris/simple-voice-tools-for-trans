/**
 * 录音浮窗：录音进行中离开测试页时的全局迷你预览。
 * 测试页本身已有三张实时图（含靶标带与达成率）；本浮窗补的是
 * 「切到历史 / 设置后看不到进度」的缺口——录音在后台继续
 * （自动停止照常触发），浮窗让练习者随时瞄一眼当前音高是否在靶标内。
 *
 * 位置：底栏上方居中的悬浮小卡；点击主体回到测试页（看完整三图），
 * 右侧提供停止按钮。仅渲染于非测试页（测试页有完整视图，无需冗余）。
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Square, X } from 'lucide-react';
import { paintChart } from '@/components/charts/chartPainters';
import { recorder } from '@/lib/audio/recorder';
import { getLiveWindowSec } from '@/constants';
import { useStore } from '@/store/useStore';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { cn } from '@/lib/utils';
import { useLiveSheetLoop } from '@/hooks/useLiveSheetLoop';

function MiniPitchCanvas() {
  const { attachCanvas } = useLiveSheetLoop<void>({
    paint: (ctx, w, h) => {
      const snap = recorder.getLive();
      const win = getLiveWindowSec();
      const t1 = Math.max(snap.elapsedSec, win);
      paintChart('pitch', ctx, w, h, snap, t1 - win, t1, false, false, true, null, null);
    },
  });
  return <canvas ref={attachCanvas} className="block h-12 w-full" aria-hidden />;
}

function RecordingTimer() {
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
    <span className="text-[11px] font-semibold tabular-nums text-ink">
      {mm}:{String(ss).padStart(2, '0')}
    </span>
  );
}

export function RecordingMiniView() {
  useI18n();
  const isRecording = useStore((s) => s.isRecording);
  const currentTab = useStore((s) => s.currentTab);
  const navStyle = useStore((s) => s.settings.navStyle);
  const setTab = useStore((s) => s.setTab);
  const stopRecording = useStore((s) => s.stopRecording);
  const [dismissed, setDismissed] = useState(false);

  // 新的一次录音重置关闭态：渲染期派生（effect 里 setState 会多一轮级联渲染）
  const [wasRecording, setWasRecording] = useState(isRecording);
  if (isRecording !== wasRecording) {
    setWasRecording(isRecording);
    if (isRecording) setDismissed(false);
  }

  const visible = isRecording && currentTab !== 'test' && !dismissed;
  return (
    <motion.div
      initial={false}
      animate={visible ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 8, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 420, damping: 30 }}
      className={cn(
        'pointer-events-none fixed inset-x-0 z-30 flex justify-center px-4',
        navStyle === 'classic'
          ? 'bottom-[calc(4.75rem+env(safe-area-inset-bottom))]'
          : 'bottom-[5.6rem]',
      )}
    >
      {visible && (
        <div className="pointer-events-auto card-surface flex w-full max-w-sm items-center gap-3 px-3 py-2.5">
          {/* 计时 + 迷你音高图（点击回测试页看完整三图） */}
          <button
            onClick={() => setTab('test')}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
            aria-label={t('recMini.backToTest')}
          >
            <RecordingTimer />
            <span className="relative flex size-2 shrink-0">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-accent" />
            </span>
            <span className="min-w-0 flex-1">
              <MiniPitchCanvas />
            </span>
          </button>
          {/* 停止 */}
          <button
            onClick={() => void stopRecording()}
            className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-on-accent transition-transform active:scale-90"
            aria-label={t('nav.recordStopAria')}
          >
            <Square size={13} fill="currentColor" strokeWidth={0} />
          </button>
          {/* 关闭浮窗（不停止录音） */}
          <button
            onClick={() => setDismissed(true)}
            className="grid size-6 shrink-0 place-items-center rounded-full text-ink-2 transition-colors hover:bg-surface-hi"
            aria-label={t('common.close')}
          >
            <X size={13} />
          </button>
        </div>
      )}
    </motion.div>
  );
}
