/**
 * Lua 模板分享卡渲染（lib/lua/card.ts 的指令 → Canvas 执行器）
 * 无 DOM 依赖外的状态；指令来自沙箱脚本，坐标/颜色经 normalize 校验。
 * 内置子绘制（pitch/ruler/qr）复用 shareCard.ts 的私有实现（本文件内重导出）。
 */

import { BAND_COLORS, getBandRanges, bandOf } from '@/constants';
import type { AnalysisRecord, PitchBand } from '@/types';
import { luaCardOps, CARD_W, CARD_H, safeColor, type CardOp } from '@/lib/lua/card';
import { encode as qrEncode } from 'uqr';

const PAD = 72;
const INK_FALLBACK = '#26242E';
const INK2_FALLBACK = '#6E6A78';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function posPct(f: number): number {
  const MIN = 60, MAX = 520;
  return (Math.log(Math.max(MIN, Math.min(MAX, f)) / MIN) / Math.log(MAX / MIN)) * 100;
}

function hexWithAlpha(hex: string, alpha: number): string {
  const m = hex.replace('#', '');
  if (m.length !== 6) return hex;
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** 执行一条指令；ctx 状态每条指令前复位（align/font 由指令自带，不跨指令泄漏） */
function execOp(
  ctx: CanvasRenderingContext2D,
  op: CardOp,
  record: AnalysisRecord,
): void {
  switch (op.op) {
    case 'bg': {
      if (typeof op.top === 'string' && typeof op.bottom === 'string') {
        const g = ctx.createLinearGradient(0, 0, 0, CARD_H);
        g.addColorStop(0, safeColor(op.top, INK_FALLBACK));
        g.addColorStop(1, safeColor(op.bottom, INK_FALLBACK));
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = safeColor(op.color, INK_FALLBACK);
      }
      ctx.fillRect(0, 0, CARD_W, CARD_H);
      break;
    }
    case 'text': {
      const size = Math.max(8, Math.min(400, op.size ?? 32));
      const weight = Math.max(100, Math.min(900, op.weight ?? 400));
      ctx.fillStyle = safeColor(op.color, INK_FALLBACK);
      ctx.font = `${weight} ${size}px ${op.mono ? '"Roboto Mono", monospace' : '"Inter Tight", system-ui, sans-serif'}`;
      ctx.textAlign = op.align === 'center' ? 'center' : op.align === 'right' ? 'right' : 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(String(op.text ?? ''), op.x ?? PAD, op.y ?? PAD);
      break;
    }
    case 'rect': {
      ctx.fillStyle = safeColor(op.color, INK_FALLBACK);
      ctx.globalAlpha = Math.max(0, Math.min(1, op.alpha ?? 1));
      roundRect(ctx, op.x ?? 0, op.y ?? 0, op.w ?? 0, op.h ?? 0, op.radius ?? 0);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case 'circle': {
      ctx.fillStyle = safeColor(op.color, INK_FALLBACK);
      ctx.globalAlpha = Math.max(0, Math.min(1, op.alpha ?? 1));
      ctx.beginPath();
      ctx.arc(op.cx ?? 0, op.cy ?? 0, Math.max(0, op.r ?? 0), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case 'line': {
      ctx.strokeStyle = safeColor(op.color, INK_FALLBACK);
      ctx.lineWidth = Math.max(1, op.width ?? 2);
      ctx.globalAlpha = Math.max(0, Math.min(1, op.alpha ?? 1));
      ctx.beginPath();
      ctx.moveTo(op.x0 ?? 0, op.y0 ?? 0);
      ctx.lineTo(op.x1 ?? 0, op.y1 ?? 0);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }
    case 'pitch':
      drawMiniPitch(ctx, record, PAD + 16, CARD_H - 460, CARD_W - PAD * 2 - 32, 330);
      break;
    case 'ruler':
      drawRuler(ctx, record, CARD_H - 700);
      break;
    case 'qr':
      drawFooterQr(ctx);
      break;
  }
}

/** 内置音域标尺（几何与内置卡一致，色随当前主题常量） */
function drawRuler(ctx: CanvasRenderingContext2D, record: AnalysisRecord, rulerY: number): void {
  const rulerH = 22;
  const rulerX = PAD;
  const rulerW = CARD_W - PAD * 2;
  const stats = record.stats;
  const bands: PitchBand[] = ['low', 'male', 'transition', 'female', 'high'];
  const ranges = getBandRanges();
  ctx.save();
  roundRect(ctx, rulerX, rulerY, rulerW, rulerH, rulerH / 2);
  ctx.clip();
  for (let i = 0; i < bands.length; i++) {
    const [f0, f1] = ranges[bands[i]];
    const x0 = (posPct(f0) / 100) * rulerW;
    const x1 = i === bands.length - 1 ? rulerW : (posPct(f1) / 100) * rulerW;
    ctx.fillStyle = hexWithAlpha(BAND_COLORS[bands[i]], 0.32);
    ctx.fillRect(rulerX + x0, rulerY, x1 - x0 + 1, rulerH);
  }
  const px0 = rulerX + (posPct(stats.p10F0) / 100) * rulerW;
  const px1 = rulerX + (posPct(stats.p90F0) / 100) * rulerW;
  ctx.fillStyle = 'rgba(40,38,52,0.32)';
  roundRect(ctx, px0, rulerY + 3, Math.max(8, px1 - px0), rulerH - 6, (rulerH - 6) / 2);
  ctx.fill();
  const cx = rulerX + (posPct(stats.avgF0) / 100) * rulerW;
  ctx.fillStyle = INK_FALLBACK;
  roundRect(ctx, cx - 5, rulerY - 8, 10, rulerH + 16, 5);
  ctx.fill();
  ctx.restore();
}

/** 内置迷你音高曲线 */
function drawMiniPitch(
  ctx: CanvasRenderingContext2D,
  record: AnalysisRecord,
  x0: number, y0: number, w: number, h: number,
): void {
  const { series } = record;
  const tMax = Math.max(0.001, record.durationSec);
  const fMin = 50, fMax = 520;
  const xOf = (t: number) => x0 + (t / tMax) * w;
  const yOf = (f: number) => y0 + h - ((f - fMin) / (fMax - fMin)) * h;
  const ranges = getBandRanges();
  for (const band of ['low', 'male', 'transition', 'female', 'high'] as PitchBand[]) {
    const [f0, f1] = ranges[band];
    const yTop = yOf(Math.min(f1, fMax));
    const yBot = yOf(Math.max(f0, fMin));
    ctx.fillStyle = hexWithAlpha(BAND_COLORS[band], 0.14);
    ctx.fillRect(x0, yTop, w, yBot - yTop);
  }
  ctx.save();
  ctx.lineWidth = 5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  let open = false;
  let strokeBand: PitchBand | null = null;
  for (let i = 0; i < series.t.length; i++) {
    const f = series.f0[i];
    if (f == null || !isFinite(f)) {
      if (open) { ctx.stroke(); open = false; strokeBand = null; }
      continue;
    }
    const band = bandOf(f);
    const x = xOf(series.t[i]);
    const y = yOf(f);
    if (!open || band !== strokeBand) {
      if (open) ctx.stroke();
      ctx.beginPath();
      ctx.strokeStyle = BAND_COLORS[band];
      ctx.moveTo(x, y);
      open = true;
      strokeBand = band;
    } else {
      ctx.lineTo(x, y);
    }
  }
  if (open) ctx.stroke();
  ctx.restore();
}

/** 内置页脚二维码 + 署名（uqr 顶层静态 import 即可，包体极小） */
function drawFooterQr(ctx: CanvasRenderingContext2D): void {
  const encode = qrEncode;
  const modulePx = 4;
  const inset = 14;
  const { size, data } = encode('https://github.com/theforeveriris/simple-voice-tools-for-trans', { ecc: 'M' });
  const backing = size * modulePx + inset * 2;
  const x = CARD_W - PAD - backing;
  const y = CARD_H - 60 - backing;
  ctx.fillStyle = INK_FALLBACK;
  for (let r = 0; r < size; r++) {
    const row = data[r];
    for (let c = 0; c < size; c++) {
      if (row[c]) ctx.fillRect(x + inset + c * modulePx, y + inset + r * modulePx, modulePx + 0.4, modulePx + 0.4);
    }
  }
  ctx.fillStyle = INK2_FALLBACK;
  ctx.font = '400 22px "Inter Tight", system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('github.com/theforeveriris/simple-voice-tools-for-trans', PAD, y + backing / 2);
}

/**
 * 按给定绘制指令渲染画布（脚本中心预览 / renderLuaCard 共用）。
 * 脚本未画背景时先铺白底，避免透明 PNG；单条指令失败跳过。
 */
export function renderCardOps(ops: CardOp[], record: AnalysisRecord): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  for (const op of ops) {
    try {
      execOp(ctx, op, record);
    } catch {
      /* 单条指令失败跳过（脚本产出可能缺字段） */
    }
  }
  return canvas;
}

/**
 * 渲染 Lua 模板卡：无启用 card 脚本或全部出错时返回 null（调用方回退内置样式）。
 */
export async function renderLuaCard(record: AnalysisRecord): Promise<HTMLCanvasElement | null> {
  const ops = await luaCardOps(record);
  if (!ops) return null;
  return renderCardOps(ops, record);
}
