/**
 * 彩蛋：喵喵练声（设置 → 应用 → 版本行连点六下）
 *
 * 全屏音高小游戏：麦克风实时音高（复用 recorder 的监听模式，不录音、不落库）
 * 落在目标音高的容差带里保持约 0.4 秒即可点亮一声；六声全中触发
 * 跨性别旗 emoji 撒花。没有麦克风时可按住空格 / 按钮「代喵」。
 *
 * 视觉只使用主题令牌（surface / card / accent / ink），深浅模式与
 * 各种预设配色都能直接适配；动画遵循 prefers-reduced-motion。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Mic, MicOff, PawPrint, RotateCcw, X } from 'lucide-react';
import { recorder } from '@/lib/audio/recorder';
import { registerBackClose } from '@/lib/backNav';
import { PixelCat } from './PixelCat';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { cn } from '@/lib/utils';
import {
  buildMeowTargets,
  foldOctave,
  meowTolerance,
  MEOW_COOLDOWN_MS,
  MEOW_HOLD_MS,
} from '@/lib/egg/meow';

type Mood = 'idle' | 'listening' | 'happy' | 'win';
type Phase = 'ready' | 'play' | 'win';
type MicState = 'off' | 'asking' | 'on' | 'denied';

/* ---------------- 声音：一段很轻的合成喵（无音频资源） ---------------- */

let sfxCtx: AudioContext | null = null;

function sfx(): AudioContext | null {
  try {
    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    sfxCtx ??= new Ctor();
    void sfxCtx.resume();
    return sfxCtx;
  } catch {
    return null;
  }
}

/** 合成「喵」：三角波做一次上滑再下滑的音高包络 */
function playMeow(happy: boolean): void {
  const ctx = sfx();
  if (!ctx) return;
  const at = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  const base = happy ? 430 : 360;
  osc.frequency.setValueAtTime(base * 1.25, at);
  osc.frequency.exponentialRampToValueAtTime(base * 0.82, at + 0.09);
  osc.frequency.exponentialRampToValueAtTime(base * 1.12, at + 0.24);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.05, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(at);
  osc.stop(at + 0.32);
}

/** 通关小琶音 */
function playChime(): void {
  const ctx = sfx();
  if (!ctx) return;
  const at = ctx.currentTime;
  [523.25, 659.25, 783.99].forEach((freq, i) => {
    const start = at + i * 0.11;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.045, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.42);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.45);
  });
}

/* ---------------- 撒花 ---------------- */

/** 跨性别旗 emoji 雨：canvas 逐帧绘制，横向摆动 + 旋转 + 重力，比 DOM 动画更顺 */
function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = 0;
    let h = 0;
    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    // emoji 只栅格化一次，之后逐帧 drawImage，避免每帧解析文字
    const sprite = document.createElement('canvas');
    const spriteSize = 160;
    sprite.width = spriteSize;
    sprite.height = spriteSize;
    const sctx = sprite.getContext('2d');
    if (sctx) {
      sctx.textAlign = 'center';
      sctx.textBaseline = 'middle';
      sctx.font = `${spriteSize - 28}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      sctx.fillText('🏳️‍⚧️', spriteSize / 2, spriteSize / 2);
    }

    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const spawn = (initial: boolean) => ({
      x: Math.random() * Math.max(1, w),
      y: initial ? rand(-h * 0.8, h * 0.2) : rand(-80, -20),
      vy: rand(55, 135),
      sway: rand(8, 30),
      freq: rand(0.7, 1.5),
      phase: Math.random() * Math.PI * 2,
      size: rand(16, 34),
      rot: rand(-0.4, 0.4),
      vr: rand(-0.9, 0.9),
      alpha: rand(0.7, 1),
    });
    const pieces = Array.from({ length: 56 }, () => spawn(true));

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, w, h);
      for (const p of pieces) {
        p.y += p.vy * dt;
        p.phase += p.freq * dt;
        p.rot += p.vr * dt;
        if (p.y > h + 40) {
          Object.assign(p, spawn(false));
          p.x = Math.random() * w;
        }
        const x = p.x + Math.sin(p.phase) * p.sway;
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.translate(x, p.y);
        ctx.rotate(p.rot);
        ctx.drawImage(sprite, -p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />;
}

/* ---------------- 主组件 ---------------- */

/** 全屏底纹：引导页同款「目标区间」曲线，弱化后铺在游戏背后 */
function PitchBackdrop() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 1200 800"
      preserveAspectRatio="none"
      aria-hidden
    >
      <path
        d="M-40 760 C 140 720, 260 650, 420 690 S 700 800, 860 740 S 1120 640, 1240 670"
        fill="none"
        className="stroke-accent/[0.07]"
        strokeWidth="2"
        strokeDasharray="7 10"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MeowGame({
  minF0,
  maxF0,
  haptics = false,
  onWin,
  onClose,
}: {
  /** 用户目标区间（取六等分作为六个音） */
  minF0: number;
  maxF0: number;
  /** 触发震动反馈（跟随设置 → 触感） */
  haptics?: boolean;
  /** 六声全中（每次通关都调用，由上层决定只解锁一次） */
  onWin?: () => void;
  onClose: () => void;
}) {
  useI18n();
  const reduce = useReducedMotion() ?? false;
  const targets = useMemo(() => buildMeowTargets(minF0, maxF0), [minF0, maxF0]);

  const [phase, setPhase] = useState<Phase>('ready');
  const [mic, setMic] = useState<MicState>('off');
  const [round, setRound] = useState(0);
  const [live, setLive] = useState<number | null>(null);
  const [hold, setHold] = useState(0);
  const [bubble, setBubble] = useState(0);
  const [jump, setJump] = useState(0);
  const [padHeld, setPadHeld] = useState(false);

  /** 由本组件打开的监听（录音中的话不接管、也不负责关闭） */
  const startedRef = useRef(false);
  const closedRef = useRef(false);
  const padHeldRef = useRef(false);
  const bubbleTimer = useRef<number | null>(null);
  // 用 ref 透传 onWin：父组件任何重渲染都不会重建判定循环（否则 hold 会被清零）
  const onWinRef = useRef(onWin);
  useEffect(() => {
    onWinRef.current = onWin;
  }, [onWin]);

  const target = targets[Math.min(round, targets.length - 1)];
  const tolerance = meowTolerance(target);

  const stopMic = useCallback(() => {
    if (startedRef.current && recorder.isMonitoring()) recorder.stopMonitor();
    startedRef.current = false;
  }, []);

  const close = useCallback(() => {
    closedRef.current = true;
    if (recorder.isStarting()) recorder.cancelStart();
    stopMic();
    onClose();
  }, [onClose, stopMic]);

  /* 卸载兜底：释放麦克风、清掉气泡计时器 */
  useEffect(() => {
    // StrictMode 的开发期「挂载→卸载→再挂载」会跑一次清理：
    // 这里在挂载时复位，避免 closedRef 被上一次清理永久置真
    closedRef.current = false;
    const bubbleEl = bubbleTimer;
    return () => {
      closedRef.current = true;
      if (startedRef.current && recorder.isMonitoring()) recorder.stopMonitor();
      startedRef.current = false;
      if (bubbleEl.current != null) window.clearTimeout(bubbleEl.current);
    };
  }, []);

  /* 打开期间锁住背景滚动 + Esc / 系统返回关闭 */
  useEffect(() => {
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  useEffect(() => registerBackClose(close), [close]);

  /** 开始（申请麦克风；被拒时留在准备页给两条路） */
  const start = useCallback(async () => {
    if (mic === 'asking') return;
    setMic('asking');
    try {
      // 正在录音时直接复用现有数据流，不经手监听模式
      if (!recorder.isRecording()) {
        await recorder.startMonitor();
        startedRef.current = true;
      }
      if (closedRef.current) {
        stopMic();
        return;
      }
      setMic('on');
      setRound(0);
      setLive(null);
      setHold(0);
      setPhase('play');
    } catch {
      if (closedRef.current) return;
      setMic('denied');
    }
  }, [mic, stopMic]);

  const startKeyboard = useCallback(() => {
    setMic('off');
    setRound(0);
    setLive(null);
    setHold(0);
    setPhase('play');
  }, []);

  const releasePad = useCallback(() => {
    padHeldRef.current = false;
    setPadHeld(false);
  }, []);

  const pressPad = useCallback(() => {
    padHeldRef.current = true;
    setPadHeld(true);
  }, []);

  /** 命中一声：喵、猫跳、气泡；第六声进入通关 */
  const onHit = useCallback(() => {
    playMeow(true);
    if (haptics) navigator.vibrate?.(10);
    setJump((n) => n + 1);
    setBubble((n) => n + 1);
    if (bubbleTimer.current != null) window.clearTimeout(bubbleTimer.current);
    bubbleTimer.current = window.setTimeout(() => setBubble(0), 900);
    setHold(0);
    setLive(null);
    if (round >= targets.length - 1) {
      stopMic();
      playChime();
      if (haptics) navigator.vibrate?.([12, 40, 12, 40, 24]);
      onWinRef.current?.();
      setPhase('win');
    } else {
      setRound((r) => r + 1);
    }
  }, [haptics, round, stopMic, targets.length]);

  /* 音高判定循环：仅游玩阶段运行，每轮重建以重置保持时长 */
  useEffect(() => {
    if (phase !== 'play') return;
    let raf = 0;
    let dead = false;
    let last = performance.now();
    let lastUi = 0;
    let holdSec = 0;
    let smooth: number | null = null;
    // 除第一声外，开头短暂冷却：让上一声的合成喵（及换气）先过去
    const cooldownUntil = round === 0 ? 0 : performance.now() + MEOW_COOLDOWN_MS;
    const tol = meowTolerance(targets[round]);

    const tick = (now: number) => {
      if (dead) return;
      const dt = Math.min(0.08, Math.max(0, (now - last) / 1000));
      last = now;

      let display: number | null = null;
      let inBand = false;
      if (padHeldRef.current) {
        // 键盘 / 触屏代喵：不受合成喵冷却影响，按住即为目标音
        display = targets[round];
        inBand = true;
      } else if (now >= cooldownUntil) {
        const pitch = recorder.lastPitch;
        if (pitch && pitch.prob > 0.55 && pitch.freq > 40) {
          const folded = foldOctave(pitch.freq, targets[round]);
          smooth = smooth == null ? folded : smooth + (folded - smooth) * 0.35;
          display = smooth;
          inBand = Math.abs(smooth - targets[round]) <= tol;
        }
      }

      if (inBand) holdSec += dt;
      else holdSec = Math.max(0, holdSec - dt * 2.5);

      if (holdSec >= MEOW_HOLD_MS / 1000) {
        dead = true;
        cancelAnimationFrame(raf);
        onHit();
        return;
      }

      if (now - lastUi > 66) {
        lastUi = now;
        setLive(display == null ? null : Math.round(display));
        setHold(Math.min(1, holdSec / (MEOW_HOLD_MS / 1000)));
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
    };
  }, [phase, round, targets, onHit]);

  /* 空格代喵（键盘 / 无障碍退路） */
  useEffect(() => {
    if (phase !== 'play') return;
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        padHeldRef.current = true;
        setPadHeld(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === ' ') {
        padHeldRef.current = false;
        setPadHeld(false);
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      padHeldRef.current = false;
    };
  }, [phase]);

  const again = useCallback(() => {
    setRound(0);
    setLive(null);
    setHold(0);
    setBubble(0);
    if (mic === 'on' || startedRef.current) void start();
    else setPhase('play');
  }, [mic, start]);

  const mood: Mood = phase === 'win'
    ? 'win'
    : phase === 'play' && live != null && Math.abs(live - target) <= tolerance
      ? 'happy'
      : phase === 'play' && live != null
        ? 'listening'
        : 'idle';

  const inBand = live != null && Math.abs(live - target) <= tolerance;
  const direction = live == null
    ? null
    : inBand
      ? t('egg.hold')
      : live < target
        ? t('egg.higher')
        : t('egg.lower');

  // 音高轴（对数刻度）：目标带与指针的位置
  const scaleLo = Math.min(...targets) * 0.72;
  const scaleHi = Math.max(...targets) * 1.28;
  const pos = (f: number) => {
    const v = (Math.log2(f) - Math.log2(scaleLo)) / (Math.log2(scaleHi) - Math.log2(scaleLo));
    return Math.min(1, Math.max(0, v));
  };
  const bandL = pos(target - tolerance);
  const bandW = Math.max(0.02, pos(target + tolerance) - bandL);

  const closeBtn = (
    <button
      type="button"
      onClick={close}
      aria-label={t('common.close')}
      className="grid size-10 place-items-center rounded-full bg-card text-ink shadow-[0_2px_14px_rgba(28,25,45,0.05),0_1px_3px_rgba(28,25,45,0.04)] transition-transform active:scale-90"
    >
      <X size={18} />
    </button>
  );

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      data-noswipe
      role="dialog"
      aria-modal="true"
      aria-label={t('egg.title')}
      className="fixed inset-0 z-[400] overflow-hidden bg-surface text-ink"
    >
      {/* 顶部柔光 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-accent/10 blur-3xl" />

      {/* 背景：引导页同款「目标区间」曲线，弱化后作为全屏底纹 */}
      <PitchBackdrop />

      {phase === 'win' && !reduce && <Confetti />}

      <div className="relative flex h-full w-full flex-col">
        <header className="flex shrink-0 items-center justify-between px-5 pt-4">
          {closeBtn}
          <div className="min-w-0 text-center">
            {phase === 'play' && (
              <p className="text-[12px] font-semibold tracking-tight text-ink">
                {t('egg.round', { n: round + 1, total: targets.length })}
              </p>
            )}
          </div>
          <span className="grid size-10 place-items-center rounded-full bg-card" aria-hidden>
            {mic === 'denied' ? (
              <MicOff size={16} className="text-ink-2/60" />
            ) : (
              <Mic size={16} className={mic === 'on' ? 'text-accent' : 'text-ink-2/40'} />
            )}
          </span>
        </header>

        <div className="relative mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col px-5 pb-5 sm:max-w-lg">
          <AnimatePresence mode="wait" initial={false}>
          {phase === 'ready' && (
            <motion.div
              key="ready"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="flex min-h-0 flex-1 flex-col items-center justify-center pb-4 text-center"
            >
              <PixelCat mood="idle" reduce={reduce} className="h-40 w-auto sm:h-56" />
              <h1 className="mt-4 text-[26px] font-semibold tracking-tight text-ink sm:text-[30px]">
                {t('egg.title')}
              </h1>
              <p className="mt-2 max-w-[302px] text-[12.5px] leading-relaxed text-ink-2 sm:max-w-[340px] sm:text-[13px]">
                {t('egg.subtitle')}
              </p>

              <button
                type="button"
                onClick={start}
                disabled={mic === 'asking'}
                className="mt-7 flex items-center gap-2 rounded-full bg-accent px-7 py-3 text-sm font-semibold text-on-accent transition-transform active:scale-95 disabled:opacity-60"
              >
                <PawPrint size={16} />
                {mic === 'asking' ? t('egg.micAsking') : t('egg.start')}
              </button>
              <p className="mt-2 text-[11px] text-ink-2/80">{t('egg.micNote')}</p>

              {mic === 'denied' && (
                <div className="mt-5 w-full max-w-[320px] rounded-2xl bg-card p-3.5 text-left shadow-[0_2px_14px_rgba(28,25,45,0.05)]">
                  <div className="flex items-start gap-2">
                    <MicOff size={15} className="mt-0.5 shrink-0 text-accent" />
                    <p className="text-[11.5px] leading-relaxed text-ink-2">{t('egg.micDenied')}</p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={start}
                      className="rounded-full bg-accent-soft px-3 py-1.5 text-[11px] font-semibold text-on-accent-soft transition-transform active:scale-95"
                    >
                      {t('egg.micRetry')}
                    </button>
                    <button
                      type="button"
                      onClick={startKeyboard}
                      className="rounded-full bg-surface-hi px-3 py-1.5 text-[11px] font-semibold text-ink transition-transform active:scale-95"
                    >
                      {t('egg.keyboardPlay')}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {phase === 'play' && (
            <motion.div
              key="play"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="flex min-h-0 flex-1 flex-col"
            >
              {/* 六声进度 */}
              <div className="flex shrink-0 items-center justify-center gap-2 pt-3">
                {targets.map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      'grid size-7 place-items-center rounded-full transition-colors',
                      i < round
                        ? 'bg-accent text-on-accent'
                        : i === round
                          ? 'bg-accent-soft text-on-accent-soft ring-1 ring-accent/60'
                          : 'bg-surface-hi text-ink-2/40',
                    )}
                  >
                    <PawPrint size={13} />
                  </span>
                ))}
              </div>

              {/* 猫 + 目标 + 音高带 */}
              <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center">
                <div className="relative">
                  <AnimatePresence>
                    {bubble > 0 && (
                      <motion.div
                        key={bubble}
                        initial={{ opacity: 0, y: 8, scale: 0.9 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.95 }}
                        className="absolute -top-6 right-1 z-10 rounded-2xl rounded-bl-sm bg-card px-3 py-1.5 text-xs font-semibold text-ink shadow-[0_4px_18px_rgba(28,25,45,0.12)]"
                      >
                        {t('egg.meow')}
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <motion.div
                    key={jump}
                    initial={{ y: 0, scale: 1 }}
                    animate={{ y: [0, -14, 0], scale: [1, 1.04, 1] }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                  >
                    <PixelCat mood={mood} reduce={reduce} className="h-32 w-auto sm:h-48" />
                  </motion.div>
                </div>

                <div className="mt-3 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-2">
                    {t('egg.targetLabel')}
                  </p>
                  <p className="mt-0.5 text-[44px] font-semibold leading-none tracking-tight tabular-nums text-ink sm:text-[56px]">
                    {target}
                    <span className="ml-1 text-base font-medium text-ink-2">Hz</span>
                  </p>
                </div>

                <div className="mt-5 w-full max-w-[300px] sm:max-w-[360px]">
                  <div className="relative h-3.5 w-full rounded-full bg-surface-hi">
                    <div
                      className="absolute inset-y-0 rounded-full bg-accent/25"
                      style={{ left: `${bandL * 100}%`, width: `${bandW * 100}%` }}
                    />
                    {live != null && (
                      <span
                        className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_0_3px_rgb(var(--c-surface-rgb))]"
                        style={{ left: `${pos(live) * 100}%` }}
                      />
                    )}
                  </div>
                  <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-hi">
                    <div
                      className="h-full rounded-full bg-accent transition-[width] duration-75"
                      style={{ width: `${Math.round(hold * 100)}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px]">
                    <span className="font-medium tabular-nums text-ink-2">
                      {live == null ? t('egg.silent') : t('egg.now', { hz: live })}
                    </span>
                    <span className="h-4 text-[11px] font-semibold text-accent">{direction}</span>
                  </div>
                </div>
              </div>

              {/* 键盘 / 触屏退路 */}
              <div className="shrink-0 pt-2 text-center">
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    pressPad();
                  }}
                  onPointerUp={releasePad}
                  onPointerLeave={releasePad}
                  onPointerCancel={releasePad}
                  onContextMenu={(e) => e.preventDefault()}
                  className={cn(
                    'mx-auto flex touch-none select-none items-center gap-2 rounded-full px-5 py-2.5 text-xs font-semibold transition-colors',
                    padHeld ? 'bg-accent text-on-accent' : 'bg-card text-ink-2',
                  )}
                >
                  <PawPrint size={14} />
                  {t('egg.holdButton')}
                </button>
              </div>
            </motion.div>
          )}

          {phase === 'win' && (
            <motion.div
              key="win"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24 }}
              className="relative flex min-h-0 flex-1 flex-col items-center justify-center pb-2"
            >
              <div className="w-full max-w-[352px] rounded-[28px] border border-line/50 bg-card/85 px-6 py-7 text-center shadow-[0_2px_14px_rgba(28,25,45,0.05),0_18px_60px_-30px_rgba(28,25,45,0.5)] backdrop-blur-md sm:max-w-[400px] sm:px-8 sm:py-8">
                <motion.div
                  initial={{ scale: 0.9, rotate: -3 }}
                  animate={reduce ? undefined : { scale: [0.96, 1.03, 0.96], rotate: [-2, 2, -2] }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <PixelCat mood="win" reduce={reduce} className="mx-auto h-40 w-auto sm:h-56" />
                </motion.div>

                <h1 className="mt-3 text-[27px] font-semibold tracking-tight text-ink sm:text-[30px]">
                  {t('egg.winTitle')}
                </h1>

                <div className="mt-7 flex items-center justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={again}
                    className="flex items-center gap-1.5 rounded-full bg-surface-hi px-5 py-2.5 text-xs font-semibold text-ink-2 transition-transform active:scale-95"
                  >
                    <RotateCcw size={14} />
                    {t('egg.again')}
                  </button>
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-full bg-accent px-6 py-2.5 text-xs font-semibold text-on-accent transition-transform active:scale-95"
                  >
                    {t('egg.done')}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        </div>
      </div>
    </motion.div>,
    document.body,
  );
}
