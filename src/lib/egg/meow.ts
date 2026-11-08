/**
 * 彩蛋「喵喵练声」的纯逻辑（无 React / DOM 依赖，便于单测）
 * - 目标音高序列：取用户「训练目标区间」的六等分，天然贴合每个人的音域
 * - 容差：约 ±10%（至少 12 Hz），保证好玩但不至于随便出声就过
 * - 八度折算：检测器偶发高/低八度时折回目标附近，避免明明唱对了却不判
 */

/** 一共六声（与「连点六下」的触发动作呼应） */
export const MEOW_ROUNDS = 6;
/** 单个音需要连续停留的时长（ms） */
export const MEOW_HOLD_MS = 380;
/** 命中后的冷却（ms）：避开合成喵叫与换气声被麦克风收回 */
export const MEOW_COOLDOWN_MS = 550;

const F0_MIN = 60;
const F0_MAX = 600;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * 由目标区间生成六个上行音高。
 * 入参异常（NaN / 0 / 反序）时退回 165–255 Hz，保证游戏总能开始。
 */
export function buildMeowTargets(minF0: number, maxF0: number, count = MEOW_ROUNDS): number[] {
  const a = Number.isFinite(minF0) && minF0 > 0 ? minF0 : 165;
  const b = Number.isFinite(maxF0) && maxF0 > 0 ? maxF0 : 255;
  const lo = clamp(Math.min(a, b), F0_MIN, F0_MAX - 30);
  const hi = clamp(Math.max(a, b), lo + 30, F0_MAX);
  if (count <= 1) return [Math.round(lo)];
  return Array.from({ length: count }, (_, i) => Math.round(lo + ((hi - lo) * i) / (count - 1)));
}

/** 目标音高的容差（±Hz） */
export function meowTolerance(target: number): number {
  return Math.max(12, Math.round(target * 0.1));
}

/** 把检测频率折到离目标最近的同名音（±1 个八度内） */
export function foldOctave(freq: number, target: number): number {
  if (!(freq > 0) || !(target > 0)) return freq;
  let best = freq;
  let bestDist = Math.abs(Math.log2(freq / target));
  for (const factor of [0.5, 2]) {
    const f = freq * factor;
    const d = Math.abs(Math.log2(f / target));
    if (d < bestDist) {
      best = f;
      bestDist = d;
    }
  }
  return best;
}

/** 折八度后与目标的距离（Hz） */
export function meowDistance(freq: number, target: number): number {
  return Math.abs(foldOctave(freq, target) - target);
}

/** 当前频率是否落在目标容差带内 */
export function inMeowBand(freq: number, target: number): boolean {
  return meowDistance(freq, target) <= meowTolerance(target);
}
