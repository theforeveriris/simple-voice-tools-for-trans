/**
 * 底部悬浮导航栏 + 录音圆球
 *
 * - 苹果式悬浮 Dock：微圆角、无边框、微阴影，四个页签（测试/分析/历史/设置），
 *   选中项有 layoutId 胶囊滑移动效与图标弹性微动效。
 * - 长按录音圆球：底栏从中缝分开（左组：测试/分析，右组：历史/设置），
 *   圆球从右缘飞入中缝落座，整个底栏保持居中；落座后以圆球为圆心
 *   扇形唤出三个模式选项——圆球已居中，经典扇形在任何屏宽都放得下。
 *   选定模式后底栏立即合拢，圆球在背景模糊淡出的同时飞回右缘
 *   （模糊遮罩盖住衔接细节），录音在右缘圆球上进行，与短按一致。
 * - 短按圆球以当前模式开始/停止录音（记住上次选择，默认随意朗读）。
 *   圆球的两个停靠位置用 layoutId 共享元素动画衔接，飞行时从页签上层滑过。
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { ElementType, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  SquareTerminal,
  ChartNoAxesColumn,
  History,
  Sparkles,
  Settings2,
  Play,
  Square,
  BookOpenText,
  AudioLines,
  TrendingUp,
} from 'lucide-react';
import { useStore } from '@/store/useStore';
import { NAV, navLabelKey } from '@/components/settings/navItems';
import type { ViewType, TestMode } from '@/types';
import { toast } from 'sonner';
import { t, getI18nVersion, localeTag } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { cn } from '@/lib/utils';

const SPRING = { type: 'spring' as const, stiffness: 380, damping: 32, mass: 0.9 };

/** 页签图标（清单与顺序来自 navItems.NAV，唯一来源） */
const TAB_ICONS: Record<ViewType, ElementType> = {
  test: SquareTerminal,
  analysis: ChartNoAxesColumn,
  history: History,
  assistant: Sparkles,
  settings: Settings2,
};

/**
 * 悬浮胶囊保留原样：4 个页签 + 录音球，不显示 AI 页签。
 * AI 只出现在经典底栏（5 个纯导航页签）。
 */
const TABS = NAV.filter((id) => id !== 'assistant').map((id) => ({
  id,
  labelKey: navLabelKey[id],
  icon: TAB_ICONS[id],
}));

/** 模式选项（扇形排列，自左向右） */
const MODE_OPTIONS: { id: TestMode; labelKey: 'mode.reading' | 'mode.sustained' | 'mode.glide'; icon: ElementType }[] = [
  { id: 'reading', labelKey: 'mode.reading', icon: BookOpenText },
  { id: 'sustained', labelKey: 'mode.sustained', icon: AudioLines },
  { id: 'glide', labelKey: 'mode.glide', icon: TrendingUp },
];

/** 长按触发时长（ms） */
const LONG_PRESS_MS = 480;
/** 扇形半径（px，自圆球圆心起算） */
const FAN_RADIUS = 118;
/** 常规扇形半张角（度）：三选项关于竖直对称，相邻间隔 = 该值 */
const FAN_SPREAD_DEG = 52;
/** 窄屏收窄后的半张角（间隔稍小，可减小所需旋转量） */
const FAN_SPREAD_COMPACT_DEG = 38;
/** 逆时针旋转上限（度），防止左侧选项低到与圆球同排 */
const FAN_MAX_ROTATE_DEG = 55;
/** 圆球直径：比页签按钮（41px）略高一点，但低于底栏整体高度（53px），视觉上只冒一点头 */
const BALL_SIZE = 46;
/** 圆球落座后底栏中缝的宽度（圆球直径 + 两侧呼吸 8） */
const BALL_SLOT_W = BALL_SIZE + 8;

/**
 * 模式选择覆盖层
 * 渲染到 body（祖先链上的 transform 动画会使 fixed 相对定位失效），
 * 以圆球圆心为原点、扇形半径排布三个选项。
 */
function ModeFanSelector({
  center,
  onClose,
  onChoose,
}: {
  center: { x: number; y: number };
  onClose: () => void;
  onChoose: (mode: TestMode) => void;
}) {
  useEffect(() => {
    // 捕获阶段监听：数字键直选模式并阻断全局快捷键（1–4 切页签）的同键冲突；
    // Escape 关闭（长按手势的键盘等价操作）
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      const idx = ['1', '2', '3'].indexOf(e.key);
      if (idx >= 0) {
        e.preventDefault();
        e.stopPropagation();
        onChoose(MODE_OPTIONS[idx].id);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, onChoose]);

  return createPortal(
    <div className="fixed inset-0 z-[70]">
      {/* 背景模糊暗化，点击取消 */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
        className="absolute inset-0 bg-ink/25 backdrop-blur-md"
      />
      {MODE_OPTIONS.map((opt, i) => {
        // 窄屏（手机竖屏）时圆球贴近右缘：间隔稍收窄 + 整体逆时针旋转，
        // 旋转量按圆球右侧剩余空间求解，选项始终保持等距，
        // 且都分布在以圆球为圆心的同一弧上（旋转不脱离圆球，平移/逐个钳制会变形）。
        // 圆球落座底栏中缝后 center.x 即屏幕中心，常规扇形恒能放下，此分支仅作兜底。
        const vw = window.innerWidth;
        const fanMargin = BALL_SIZE / 2 + 28; // 圆钮半径 + 标签半宽
        const roomRight = vw - fanMargin - center.x;
        let spread = FAN_SPREAD_DEG;
        let rotateDeg = 0;
        if (roomRight < Math.sin((FAN_SPREAD_DEG * Math.PI) / 180) * FAN_RADIUS) {
          spread = FAN_SPREAD_COMPACT_DEG;
          const ratio = Math.max(-1, Math.min(1, roomRight / FAN_RADIUS));
          rotateDeg = Math.min(
            FAN_MAX_ROTATE_DEG,
            Math.max(0, spread - (Math.asin(ratio) * 180) / Math.PI),
          );
        }
        const rad = (((i - 1) * spread - rotateDeg) * Math.PI) / 180;
        const dx = Math.sin(rad) * FAN_RADIUS;
        const dy = -Math.cos(rad) * FAN_RADIUS;
        const Icon = opt.icon;
        return (
          <motion.div
            key={opt.id}
            className="absolute"
            style={{ left: center.x, top: center.y }}
            initial={{ x: 0, y: 0, scale: 0.2, opacity: 0 }}
            animate={{ x: dx, y: dy, scale: 1, opacity: 1 }}
            exit={{ x: 0, y: 0, scale: 0.2, opacity: 0, transition: { duration: 0.14 } }}
            transition={{ type: 'spring', stiffness: 430, damping: 24, delay: i * 0.05 }}
          >
            <button
              onClick={() => onChoose(opt.id)}
              className="flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2"
              aria-label={`${t(opt.labelKey)}：${t(`mode.${opt.id}Desc`)}`}
            >
              <motion.span
                whileTap={{ scale: 0.88 }}
                className="grid size-14 place-items-center rounded-full bg-card shadow-[0_10px_30px_-6px_rgba(28,25,45,0.3),0_3px_10px_rgba(28,25,45,0.12)]"
              >
                <Icon size={22} strokeWidth={2} className="text-accent" />
              </motion.span>
              <span className="whitespace-nowrap rounded-full bg-ink px-2.5 py-1 text-[10px] font-medium text-card shadow">
                {t(opt.labelKey)}
              </span>
            </button>
          </motion.div>
        );
      })}
      {/* 取消提示 */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ delay: 0.25 }}
        className="absolute inset-x-0 top-7 text-center text-xs text-white/90"
      >
        {t('nav.fanCancelHint')}
      </motion.p>
    </div>,
    document.body,
  );
}

/** 圆球本体（两种停靠位置共用：录音按钮 + 呼吸光晕） */
function BallCore({ onLongPress }: { onLongPress: () => void }) {
  const isRecording = useStore((s) => s.isRecording);
  const startRecording = useStore((s) => s.startRecording);
  const stopRecording = useStore((s) => s.stopRecording);

  const pressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);
  const pressOrigin = useRef({ x: 0, y: 0 });

  const onPointerDown = (e: ReactPointerEvent) => {
    if (isRecording) return;
    longPressFired.current = false;
    pressOrigin.current = { x: e.clientX, y: e.clientY };
    // 长按已触发后，抬手产生的那次 click 必须被吞掉（否则会同时开始录音）
    pressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      onLongPress();
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (pressTimer.current === null) return;
    const moved = Math.hypot(e.clientX - pressOrigin.current.x, e.clientY - pressOrigin.current.y);
    if (moved > 12) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const clearPress = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const onClick = async () => {
    // 长按展开选择器后，抬手的 click 不应触发短按开始
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    if (isRecording) {
      void stopRecording();
    } else {
      try {
        await startRecording();
      } catch {
        toast.error(t('toast.micError'));
      }
    }
  };

  useEffect(() => clearPress, []);

  return (
    <>
      {/* 呼吸光晕（录音中） */}
      <AnimatePresence>
        {isRecording && (
          <motion.span
            key="halo"
            initial={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            className="absolute -inset-1.5 rounded-full"
          >
            <motion.span
              className="absolute inset-0 rounded-full bg-accent/35"
              animate={{ scale: [1, 1.55], opacity: [0.55, 0] }}
              transition={{ duration: 1.7, ease: 'easeOut', repeat: Infinity }}
            />
            <motion.span
              className="absolute inset-0 rounded-full bg-accent/25"
              animate={{ scale: [1, 1.9], opacity: [0.4, 0] }}
              transition={{ duration: 1.7, ease: 'easeOut', repeat: Infinity, delay: 0.55 }}
            />
            <motion.span
              className="absolute inset-0 rounded-full ring-2 ring-accent/50"
              animate={{ scale: [1, 1.06, 1] }}
              transition={{ duration: 1.7, ease: 'easeInOut', repeat: Infinity }}
            />
          </motion.span>
        )}
      </AnimatePresence>

      <motion.button
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={clearPress}
        onPointerCancel={clearPress}
        onPointerLeave={clearPress}
        onContextMenu={(e) => e.preventDefault()}
        whileHover={{ scale: 1.07 }}
        whileTap={{ scale: 0.9 }}
        animate={isRecording ? { scale: [1, 1.04, 1] } : { scale: 1 }}
        transition={isRecording ? { duration: 1.7, ease: 'easeInOut', repeat: Infinity } : SPRING}
        className="relative grid size-full select-none place-items-center rounded-full bg-accent text-on-accent shadow-[0_8px_22px_-6px_rgb(var(--c-accent-rgb)/0.55),0_3px_10px_rgb(var(--c-accent-rgb)/0.25)]"
        aria-label={isRecording ? t('nav.recordStopAria') : t('nav.recordStartAria')}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={isRecording ? 'stop' : 'play'}
            initial={{ scale: 0.3, opacity: 0, rotate: -70 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0.3, opacity: 0, rotate: 70 }}
            transition={{ duration: 0.16 }}
            className="grid place-items-center"
          >
            {isRecording ? (
              <Square size={16} fill="currentColor" strokeWidth={0} />
            ) : (
              <Play size={18} fill="currentColor" strokeWidth={0} className="translate-x-[2px]" />
            )}
          </motion.span>
        </AnimatePresence>
      </motion.button>
    </>
  );
}

/**
 * 录音圆球：两个停靠位置（右缘悬浮 / 底栏中缝）用同一 layoutId 衔接，
 * 切换时 framer 自动从旧位置飞行到新位置，穿过页签时位于上层。
 * entrance 仅在首次进入测试页时为 true（播放缩放入场）；
 * layoutId 衔接飞行时必须关闭入场动画，否则透明度会跳变。
 */
function RecordBall({
  docked,
  entrance = false,
  onLongPress,
}: {
  docked: boolean;
  entrance?: boolean;
  onLongPress: () => void;
}) {
  return (
    <motion.div
      layoutId="record-ball"
      transition={SPRING}
      initial={!docked && entrance ? { scale: 0, opacity: 0 } : false}
      animate={{ scale: 1, opacity: 1 }}
      className="pointer-events-auto absolute z-10"
      style={{
        width: BALL_SIZE,
        height: BALL_SIZE,
        ...(docked
          ? { left: '50%', top: '50%', marginLeft: -BALL_SIZE / 2, marginTop: -BALL_SIZE / 2 }
          : { left: 'calc(100% + 12px)', top: '50%', marginTop: -BALL_SIZE / 2 }),
      }}
    >
      <BallCore onLongPress={onLongPress} />
    </motion.div>
  );
}

interface DockProps {
  currentTab: ViewType;
  split: boolean;
  ballDocked: boolean;
  /** 悬浮球是否播放入场动画（首次进入测试页；layoutId 衔接时必须关闭） */
  ballEntrance: boolean;
  /** 当前语言标签：memo 比较依赖——语言切换时本组件 props 其余不变，需此值触发页签文案重渲染 */
  langKey: string;
  /** 词典版本：编辑词条等不走语言切换的词典更新同样触发页签重渲染 */
  i18nVersion: number;
  slotRef: RefObject<HTMLDivElement | null>;
  onLongPress: () => void;
}

/**
 * 底栏本体（memo：模式扇形的打开/关闭不会触发底栏重渲染，
 * 避免 framer layout 在 CSS/弹簧动画进行中被重新快照造成二次移动）。
 */
const Dock = memo(function Dock({
  currentTab,
  split,
  ballDocked,
  ballEntrance,
  langKey,
  i18nVersion,
  slotRef,
  onLongPress,
}: DockProps) {
  const setTab = useStore((s) => s.setTab);
  const isTest = currentTab === 'test';

  const renderTab = (tab: (typeof TABS)[number]) => {
    const active = currentTab === tab.id;
    const Icon = tab.icon;
    const label = t(tab.labelKey);
    return (
      <motion.button
        key={tab.id}
        layout
        onClick={() => setTab(tab.id)}
        whileTap={{ scale: 0.9 }}
        className="relative flex items-center rounded-2xl px-3.5 py-2.5"
        aria-label={label}
      >
        {/* 选中胶囊（跨页签平滑滑动） */}
        {active && (
          <motion.span
            layoutId="nav-pill"
            transition={SPRING}
            className="absolute inset-0 rounded-2xl bg-accent-soft"
          />
        )}
        <motion.span
          className="relative z-10 grid place-items-center"
          animate={active ? { scale: [1, 1.28, 1] } : { scale: 1 }}
          transition={{ duration: 0.38, ease: 'easeOut' }}
        >
          <Icon
            size={21}
            strokeWidth={active ? 2.4 : 2}
            className={cn('transition-colors duration-200', active ? 'text-accent' : 'text-ink-2')}
          />
        </motion.span>
        {/*
          标签宽度必须瞬间到位、不做 width 动画：
          若宽度逐帧展开，底栏的真实布局会每帧重新居中，
          与 layout FLIP 动画叠加产生"二次移动"。
          宽度瞬变让小球退场 + 标签挂载合并为一次重排，
          底栏只做一次纯净的滑动；文字用快速淡入消除突现感。
        */}
        {active && !isTest && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.14 }}
            className="relative z-10 whitespace-nowrap pl-[7px] text-sm font-medium text-on-accent-soft"
          >
            {label}
          </motion.span>
        )}
      </motion.button>
    );
  };

  return (
    <motion.div
      animate={{ x: ballDocked ? 0 : isTest ? -(BALL_SIZE + 12) / 2 : 0 }}
      transition={SPRING}
      className="pointer-events-auto relative flex items-center"
    >
      <motion.nav
        layout
        lang={langKey}
        data-i18n-version={i18nVersion}
        transition={SPRING}
        className="app-chrome flex items-center gap-0.5 rounded-[24px] bg-card p-1.5 shadow-[0_12px_40px_-8px_rgba(28,25,45,0.18),0_3px_12px_rgba(28,25,45,0.06)]"
      >
        {/* 左组：测试 / 分析 */}
        <div className="flex items-center gap-0.5">{TABS.slice(0, 2).map(renderTab)}</div>

        {/* 中缝：长按/录音时张开，圆球落座于此 */}
        <motion.div
          ref={slotRef}
          initial={false}
          animate={{ width: split ? BALL_SLOT_W : 0 }}
          transition={SPRING}
          className="relative shrink-0"
        >
          {isTest && ballDocked && <RecordBall docked onLongPress={onLongPress} />}
        </motion.div>

        {/* 右组：历史 / 设置 */}
        <div className="flex items-center gap-0.5">{TABS.slice(2).map(renderTab)}</div>
      </motion.nav>

      {/* 悬浮圆球：仅测试页渲染，分体时让位给中缝里的圆球（layoutId 衔接飞行）。
          录音进行中离开测试页：录音在后台继续、自动停止照常触发；
          回到测试页时圆球由 isRecording 恢复「录音中」状态，进度无感衔接。 */}
      {isTest && !ballDocked && (
        <RecordBall docked={false} entrance={ballEntrance} onLongPress={onLongPress} />
      )}
    </motion.div>
  );
});

/**
 * 经典底栏：贯穿屏幕底部的纯导航（5 个页签），无录音球。
 */
function ClassicNav() {
  useI18n();
  const currentTab = useStore((s) => s.currentTab);
  const setTab = useStore((s) => s.setTab);
  return (
    <div className="app-chrome fixed inset-x-0 bottom-0 z-50 border-t border-black/[0.06] bg-card pb-[max(env(safe-area-inset-bottom),0.375rem)] shadow-[0_-8px_30px_-12px_rgba(28,25,45,0.18)]">
      <nav className="mx-auto grid h-16 w-full max-w-[560px] grid-cols-5 px-2">
        {NAV.map((id) => {
          const active = currentTab === id;
          const Icon = TAB_ICONS[id];
          const label = t(navLabelKey[id]);
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              aria-current={active ? 'page' : undefined}
              className="relative flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-ink-2"
            >
              <Icon
                size={21}
                strokeWidth={active ? 2.4 : 2}
                className={cn('transition-colors duration-200', active ? 'text-accent' : 'text-ink-2')}
              />
              <span className={cn('max-w-full truncate text-[10px] font-medium transition-colors duration-200', active ? 'text-accent' : 'text-ink-2')}>
                {label}
              </span>
              {active && (
                <motion.span
                  layoutId="classic-nav-underline"
                  transition={SPRING}
                  className="absolute bottom-[5px] h-[3px] w-5 rounded-full bg-accent"
                />
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

/**
 * 底部悬浮导航栏：状态编排（分体 = 长按选择中 或 录音中）
 */
function FloatingBottomBar() {
  useI18n(); // 语言切换时重渲染底栏文案
  const currentTab = useStore((s) => s.currentTab);
  const updateSettings = useStore((s) => s.updateSettings);
  const startRecording = useStore((s) => s.startRecording);
  const stopRecording = useStore((s) => s.stopRecording);
  const isRecording = useStore((s) => s.isRecording);
  const isTest = currentTab === 'test';

  const [menuOpen, setMenuOpen] = useState(false);
  const [fanCenter, setFanCenter] = useState<{ x: number; y: number } | null>(null);
  const [ballDocked, setBallDocked] = useState(false);
  // 圆球是否已经落座过：layoutId 衔接飞行时必须关闭悬浮球的入场动画
  const [everDocked, setEverDocked] = useState(false);
  const slotRef = useRef<HTMLDivElement>(null);
  const fanTimer = useRef<number | null>(null);

  // 分体布局：仅模式选择中（仅在测试页）；选定后立即合拢，
  // 圆球与背景模糊淡出同步飞回右缘，录音在右缘圆球上进行
  const split = isTest && menuOpen;

  // 圆球停靠位置（渲染期派生）：分体立即落座，退出立即飞回
  const [prevSplit, setPrevSplit] = useState(split);
  if (split !== prevSplit) {
    setPrevSplit(split);
    setBallDocked(split);
    if (split) setEverDocked(true);
  }

  // 切换页面时收起未完成的模式选择（渲染期派生）
  const [prevTest, setPrevTest] = useState(isTest);
  if (isTest !== prevTest) {
    setPrevTest(isTest);
    if (!isTest) {
      if (fanTimer.current !== null) {
        // eslint-disable-next-line react-hooks/refs -- 渲染期幂等取消挂起的定时器，与渲染输出无依赖
        window.clearTimeout(fanTimer.current);
        fanTimer.current = null;
      }
      setMenuOpen(false);
      setFanCenter(null);
    }
  }

  const openMenu = useCallback(() => {
    setMenuOpen(true);
    navigator.vibrate?.(12);
    // 等圆球落座、底栏分开后再唤出扇形选项
    fanTimer.current = window.setTimeout(() => {
      fanTimer.current = null;
      const r = slotRef.current?.getBoundingClientRect();
      if (r) setFanCenter({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    }, 320);
  }, []);

  const closeMenu = useCallback(() => {
    if (fanTimer.current !== null) {
      window.clearTimeout(fanTimer.current);
      fanTimer.current = null;
    }
    setMenuOpen(false);
    setFanCenter(null);
  }, []);

  const chooseMode = useCallback(
    async (mode: TestMode) => {
      if (fanTimer.current !== null) {
        window.clearTimeout(fanTimer.current);
        fanTimer.current = null;
      }
      // 分体立即收拢，圆球与背景模糊淡出同步飞回右缘（模糊盖住衔接细节），
      // 录音在右缘圆球上进行
      setMenuOpen(false);
      setFanCenter(null);
      updateSettings({ testMode: mode });
      try {
        await startRecording();
      } catch {
        toast.error(t('toast.micError'));
      }
    },
    [updateSettings, startRecording],
  );

  // 键盘等价操作（仅测试页；输入框/按钮聚焦或对话框打开时不接管）：
  // Space = 短按圆球（开始/停止录音），M = 长按圆球（唤出模式扇形）
  useEffect(() => {
    if (!isTest) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (
        target
        && (target.tagName === 'INPUT'
          || target.tagName === 'TEXTAREA'
          || target.tagName === 'SELECT'
          || target.tagName === 'BUTTON'
          || target.isContentEditable)
      ) return;
      // 对话框 / 浮层打开时交还给其内部焦点管理。
      // Radix 弹层带 data-state，自绘浮层（快捷键帮助 / 编辑词条 / 使用说明）只有
      // role="dialog" 本身——都按条件挂载，存在即打开，不能只认 [data-state="open"]
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      if (e.key === ' ') {
        e.preventDefault();
        if (menuOpen) return;
        if (isRecording) void stopRecording();
        else void startRecording().catch(() => toast.error(t('toast.micError')));
      } else if (e.key === 'm' || e.key === 'M') {
        if (menuOpen || isRecording) return;
        e.preventDefault();
        openMenu();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isTest, menuOpen, isRecording, openMenu, startRecording, stopRecording]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-5">
      {/*
        运动模型：
        - 分体时圆球在底栏中缝，整体由 justify-center 精确居中；
        - 非分体时圆球悬浮于右缘，整体用纯 transform 左移 (圆球+间距)/2
          （= 53px+12px 的一半 = 32.5px）使"底栏+小球"视觉居中；
        - 中缝宽度由 framer 弹簧驱动，页签组随文档流平滑滑开；
        - 圆球换位由 layoutId 共享元素动画完成，其余组件不为它重渲染
          （Dock memo），避免 layout 快照与进行中的动画叠加。
      */}
      <Dock
        currentTab={currentTab}
        split={split}
        ballDocked={ballDocked}
        ballEntrance={!everDocked}
        langKey={localeTag()}
        i18nVersion={getI18nVersion()}
        slotRef={slotRef}
        onLongPress={openMenu}
      />

      {/* 模式扇形（落座后唤出，渲染到 body） */}
      {fanCenter && <ModeFanSelector center={fanCenter} onClose={closeMenu} onChoose={chooseMode} />}
    </div>
  );
}

/** 底栏样式切换：悬浮胶囊保留原录音球；经典底栏是纯导航 + 测试页录音头 */
export function BottomBar() {
  const navStyle = useStore((s) => s.settings.navStyle);
  if (navStyle === 'ai') return null;
  return navStyle === 'classic' ? <ClassicNav /> : <FloatingBottomBar />;
}
