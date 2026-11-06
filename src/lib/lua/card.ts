/**
 * Lua 分享卡模板（实验性「脚本中心」消费方 #3）
 * 脚本定义 template(record) 返回绘制指令数组，宿主按序在 1080×1350 画布执行：
 *   {
 *   { op = "bg", color = "#201826" },                      -- 背景纯色
 *   { op = "bg", top = "#111", bottom = "#321" },          -- 背景竖向渐变
 *   { op = "text", x, y, text, size = 128, weight = 600, color = "#fff",
 *     align = "left"|"center"|"right", mono = true },      -- 文本
 *   { op = "rect", x, y, w, h, color, radius = 28, alpha = 0.2 },
 *   { op = "circle", cx, cy, r, color, alpha },
 *   { op = "line", x0, y0, x1, y1, color, width = 2 },
 *   { op = "pitch" },                                      -- 内置迷你音高曲线（面板几何同内置卡）
 *   { op = "ruler" },                                      -- 内置音域标尺
 *   { op = "qr" },                                         -- 内置页脚二维码+署名
 *   }
 * 坐标即像素（W=1080 H=1350 PAD=72 与内置卡一致）；颜色支持 #RRGGBB。
 * 脚本通过 record（含 stats）取数；指令数上限 500，超限截断。
 */

import type { AnalysisRecord } from '@/types';
import { runLuaFn } from './engine';
import { activeScriptOf } from './scripts';
import { recordView } from './filter';

export const CARD_W = 1080;
export const CARD_H = 1350;

/** 绘制指令（宽松类型：脚本产出经 normalize 校验） */
export interface CardOp {
  op: 'bg' | 'text' | 'rect' | 'circle' | 'line' | 'pitch' | 'ruler' | 'qr';
  x?: number; y?: number; w?: number; h?: number; x0?: number; y0?: number; x1?: number; y1?: number;
  cx?: number; cy?: number; r?: number;
  text?: string; size?: number; weight?: number; color?: string;
  align?: 'left' | 'center' | 'right';
  mono?: boolean;
  radius?: number; alpha?: number; width?: number;
  top?: string; bottom?: string;
}

const ALLOWED_OPS = new Set(['bg', 'text', 'rect', 'circle', 'line', 'pitch', 'ruler', 'qr']);

/** Lua 返回的表 → CardOp[]（逐条校验，坏条目丢弃） */
export function normalizeOps(value: unknown): CardOp[] {
  if (!Array.isArray(value)) return [];
  const ops: CardOp[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    if (typeof o.op !== 'string' || !ALLOWED_OPS.has(o.op)) continue;
    const op = o as unknown as CardOp;
    if (op.op === 'text' && typeof op.text !== 'string') continue;
    ops.push(op);
    if (ops.length >= 500) break;
  }
  return ops;
}

/** 颜色校验（#RRGGBB 或 #RRGGBBAA），非法回退墨色 */
export function safeColor(c: string | undefined, fallback: string): string {
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(c) ? c : fallback;
}

/**
 * 跑启用的 card 类脚本中生效的那个（单一消费方：同一方向只允许一个脚本生效）；
 * 返回绘制指令数组；无脚本/出错返回 null（调用方回退内置样式）。
 */
export async function luaCardOps(record: AnalysisRecord): Promise<CardOp[] | null> {
  const script = await activeScriptOf('card');
  if (!script) return null;
  const v = recordView(record);
  const res = await runLuaFn<unknown>(script.code, 'template', [v]);
  if (!res.ok) return null;
  const ops = normalizeOps(res.value);
  return ops.length > 0 ? ops : null;
}

/** 是否有启用的 card 脚本（分享弹层决定是否展示「Lua 模板」样式项） */
export async function luaCardEnabled(): Promise<boolean> {
  return (await activeScriptOf('card')) !== null;
}
