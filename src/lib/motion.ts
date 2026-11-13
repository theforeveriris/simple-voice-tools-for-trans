/**
 * 全局动效 token
 *
 * 所有 framer-motion 过渡优先从这里取，避免各组件各写一套时长/曲线。
 * 时长单位是秒（framer-motion 约定）；CSS 侧对应变量见 index.css。
 */

import type { Transition } from 'framer-motion';

type Bezier = [number, number, number, number];

/** 进入 / 常规位移曲线：快出慢停 */
export const EASE_ENTER: Bezier = [0.2, 0, 0, 1];
/** 退出曲线：加速离开，不拖泥带水 */
export const EASE_EXIT: Bezier = [0.4, 0, 1, 1];
/** 高度收拢 / 布局补位：先快后缓，避免突然停住 */
export const EASE_SETTLE: Bezier = [0.32, 0.72, 0, 1];

export const DURATION = {
  /** 按压、图标、tooltip 等即时反馈 */
  fast: 0.12,
  /** 菜单、消息、普通开关内容 */
  base: 0.18,
  /** 页面、弹层、列表补位 */
  page: 0.24,
  /** 空态、首次揭示、强调动作 */
  emphasis: 0.32,
} as const;

export const MOTION = {
  fast: { duration: DURATION.fast, ease: EASE_ENTER },
  base: { duration: DURATION.base, ease: EASE_ENTER },
  page: { duration: DURATION.page, ease: EASE_ENTER },
  emphasis: { duration: DURATION.emphasis, ease: EASE_ENTER },
  exit: { duration: DURATION.fast, ease: EASE_EXIT },
  /** 删除后的高度收拢 / 列表补位 */
  reflow: { duration: DURATION.page, ease: EASE_SETTLE },
  /** 录音徽标、选中态等有弹性的小元素 */
  springSnappy: { type: 'spring', stiffness: 420, damping: 26 },
  /** 花朵详情、浮层等内容块 */
  springSoft: { type: 'spring', stiffness: 380, damping: 28 },
  /** 底栏圆球与导航胶囊 */
  springNav: { type: 'spring', stiffness: 380, damping: 32, mass: 0.9 },
} satisfies Record<string, Transition>;
