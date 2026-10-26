/**
 * 分析报告分享图（PNG）
 * Canvas 手绘 1080×1350（4:5 竖版）品牌报告卡：
 * 应用署名 + 平均基频大字 + 音域标尺 + 迷你音高曲线 + 关键统计。
 * 支持四种样式（主题 / 暗色 / 浅色 / 极光），右下角带指向仓库的二维码；
 * 优先走系统分享（Web Share API），不支持时下载。
 */

import { encode as qrEncode } from 'uqr';
import { BAND_COLORS, getBandRanges, bandOf, freqToNote } from '@/constants';
import { flowerOf, rotationJitter } from '@/lib/flower';
// 该文件内 t 已被主题色板局部变量占用，i18n 翻译函数以 ti 引用
import { t as ti } from '@/i18n';
import type { AnalysisRecord, PitchBand } from '@/types';

/** 分享图样式：themed 跟随当前主题，其余为固定风格（accent 延续主题维持品牌感）；flower = 声之花卡；lua = 用户 Lua 模板（有启用 card 脚本时出现） */
export type ShareCardStyle = 'themed' | 'dark' | 'light' | 'aurora' | 'flower' | 'lua';

/** 二维码指向的仓库地址 */
const REPO_URL = 'https://github.com/theforeveriris/simple-voice-tools-for-trans';

/** 从文档根读取当前主题色（CSS 变量） */
function readTheme(): {
  card: string; surface: string; ink: string; ink2: string; accent: string; accent2: string; line: string;
} {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  return {
    card: v('--c-card', '#FFFEFB'),
    surface: v('--c-surface', '#F7F5F2'),
    ink: v('--c-ink', '#26242E'),
    ink2: v('--c-ink-2', '#6E6A78'),
    accent: v('--c-accent', '#5B5BD6'),
    accent2: v('--c-accent2', '#8B5BD6'),
    line: v('--c-line', '#E5E3EC'),
  };
}

interface Palette {
  card: string; surface: string; ink: string; ink2: string;
  accent: string; accent2: string; line: string;
  /** P10–P90 括条颜色（深浅样式不同） */
  bracket: string;
  /** 背景：纯色或 [顶部, 底部] 竖向渐变 */
  bg: string | [string, string];
}

function resolvePalette(style: ShareCardStyle): Palette {
  const t = readTheme();
  switch (style) {
    case 'dark':
      return {
        card: '#17151D', surface: '#211E2B', ink: '#F2F0F7', ink2: '#A9A4B8',
        accent: t.accent, accent2: t.accent2, line: '#34303F',
        bracket: 'rgba(255,255,255,0.28)', bg: '#17151D',
      };
    case 'light':
      return {
        card: '#FBF9F4', surface: '#F2EFE7', ink: '#2B2822', ink2: '#6E6A5E',
        accent: t.accent, accent2: t.accent2, line: '#E7E3D8',
        bracket: 'rgba(40,38,52,0.32)', bg: '#FBF9F4',
      };
    case 'aurora':
      // 极光：主题双 accent 的竖向渐变铺底，前景用白系保证对比
      return {
        card: '#1B1826', surface: 'rgba(255,255,255,0.10)', ink: '#FAF8FF',
        ink2: 'rgba(255,255,255,0.68)', accent: '#FFFFFF', accent2: '#FFE08A',
        line: 'rgba(255,255,255,0.24)', bracket: 'rgba(255,255,255,0.38)',
        bg: [t.accent, t.accent2],
      };
    default:
      return {
        card: t.card, surface: t.surface, ink: t.ink, ink2: t.ink2,
        accent: t.accent, accent2: t.accent2, line: t.line,
        bracket: 'rgba(40,38,52,0.32)', bg: t.card,
      };
  }
}

function paintBackground(ctx: CanvasRenderingContext2D, p: Palette): void {
  if (typeof p.bg === 'string') {
    ctx.fillStyle = p.bg;
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, p.bg[0]);
    g.addColorStop(1, p.bg[1]);
    ctx.fillStyle = g;
  }
  ctx.fillRect(0, 0, W, H);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexWithAlpha(hex: string, alpha: number): string {
  const m = hex.replace('#', '');
  if (m.length !== 6) return hex;
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const W = 1080;
const H = 1350;
const PAD = 72;

function posPct(f: number): number {
  const MIN = 60, MAX = 520;
  return (Math.log(Math.max(MIN, Math.min(MAX, f)) / MIN) / Math.log(MAX / MIN)) * 100;
}

/** 右下角二维码（指向仓库）+ 左下仓库署名。
 *  uqr 的 data 是二维布尔阵（data[row][col]）；底为透明，模块取 p.ink
 *  保证与卡片底色的局部对比（暗色/极光样式下为浅色模块，即反色码）。 */
function drawFooterQr(ctx: CanvasRenderingContext2D, p: Palette): void {
  const modulePx = 4; // 每模块 4px（35 模块 → 140px）
  const inset = 14;
  const { size, data } = qrEncode(REPO_URL, { ecc: 'M' });
  const backing = size * modulePx + inset * 2;
  const x = W - PAD - backing;
  const y = H - 60 - backing;
  ctx.fillStyle = p.ink;
  for (let r = 0; r < size; r++) {
    const row = data[r];
    for (let c = 0; c < size; c++) {
      if (row[c]) {
        ctx.fillRect(x + inset + c * modulePx, y + inset + r * modulePx, modulePx + 0.4, modulePx + 0.4);
      }
    }
  }
  ctx.fillStyle = p.ink2;
  ctx.font = '400 22px "Inter Tight", system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('github.com/theforeveriris/simple-voice-tools-for-trans', PAD, y + backing / 2);
}

/** 绘制完整报告卡 */
function drawCard(record: AnalysisRecord, t: Palette): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  const stats = record.stats;
  const band = bandOf(stats.avgF0);

  paintBackground(ctx, t);

  /* 页眉 */
  ctx.fillStyle = t.accent;
  ctx.beginPath();
  ctx.arc(PAD + 9, PAD + 14, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = t.ink2;
  ctx.font = '500 30px "Inter Tight", system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('Simple Voice Tool for Trans', PAD + 30, PAD + 15);
  const d = new Date(record.createdAt);
  const dateStr = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  ctx.textAlign = 'right';
  ctx.fillText(dateStr, W - PAD, PAD + 15);
  ctx.strokeStyle = t.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PAD, PAD + 58);
  ctx.lineTo(W - PAD, PAD + 58);
  ctx.stroke();

  /* 平均基频大字 + 音区徽标 */
  const numY = PAD + 190;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = t.ink;
  ctx.font = '600 128px "Inter Tight", system-ui, sans-serif';
  ctx.fillText(stats.avgF0.toFixed(1), PAD, numY);
  const numW = ctx.measureText(stats.avgF0.toFixed(1)).width;
  ctx.fillStyle = t.ink2;
  ctx.font = '400 40px "Inter Tight", system-ui, sans-serif';
  ctx.fillText('Hz', PAD + numW + 18, numY);
  ctx.fillStyle = t.accent;
  ctx.font = '600 44px "Inter Tight", system-ui, sans-serif';
  ctx.fillText(freqToNote(stats.avgF0).name, PAD + numW + 18 + 90, numY);

  // 音区徽标
  const chipX = W - PAD - 240;
  const chipColor = BAND_COLORS[band as PitchBand];
  ctx.fillStyle = hexWithAlpha(chipColor, 0.18);
  roundRect(ctx, chipX, numY - 62, 240, 62, 31);
  ctx.fill();
  ctx.fillStyle = t.ink;
  ctx.font = '600 30px "Inter Tight", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ti(`band.${band}`), chipX + 120, numY - 30);

  /* 音域标尺 */
  const rulerY = numY + 60;
  const rulerH = 22;
  const rulerX = PAD;
  const rulerW = W - PAD * 2;
  const bands: PitchBand[] = ['low', 'male', 'transition', 'female', 'high'];
  // 裁剪圆角后重绘色带
  ctx.save();
  roundRect(ctx, rulerX, rulerY, rulerW, rulerH, rulerH / 2);
  ctx.clip();
  for (let i = 0; i < bands.length; i++) {
    const [f0, f1] = bandRange(bands[i]);
    const x0 = (posPct(f0) / 100) * rulerW;
    const x1 = i === bands.length - 1 ? rulerW : (posPct(f1) / 100) * rulerW;
    ctx.fillStyle = hexWithAlpha(BAND_COLORS[bands[i]], 0.32);
    ctx.fillRect(rulerX + x0, rulerY, x1 - x0 + 1, rulerH);
  }
  // P10–P90 括条
  const px0 = rulerX + (posPct(stats.p10F0) / 100) * rulerW;
  const px1 = rulerX + (posPct(stats.p90F0) / 100) * rulerW;
  ctx.fillStyle = t.bracket;
  roundRect(ctx, px0, rulerY + 3, Math.max(8, px1 - px0), rulerH - 6, (rulerH - 6) / 2);
  ctx.fill();
  // 平均基频游标
  const cx = rulerX + (posPct(stats.avgF0) / 100) * rulerW;
  ctx.fillStyle = t.ink;
  roundRect(ctx, cx - 5, rulerY - 8, 10, rulerH + 16, 5);
  ctx.fill();
  ctx.restore();
  // 刻度
  ctx.fillStyle = t.ink2;
  ctx.font = '400 22px "Inter Tight", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (const f of [100, 200, 300, 400, 500]) {
    ctx.fillText(String(f), rulerX + (posPct(f) / 100) * rulerW, rulerY + rulerH + 30);
  }
  ctx.font = '400 24px "Inter Tight", system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(ti('share.rangeLine', { a: stats.p10F0.toFixed(0), b: stats.p90F0.toFixed(0) }), rulerX, rulerY + rulerH + 72);

  /* 迷你音高曲线 */
  const chartY = rulerY + rulerH + 110;
  const chartH = 330;
  ctx.fillStyle = t.surface;
  roundRect(ctx, PAD, chartY, W - PAD * 2, chartH, 28);
  ctx.fill();
  drawMiniPitch(ctx, record, PAD + 16, chartY + 16, W - PAD * 2 - 32, chartH - 32);

  /* 统计网格 */
  const statY = chartY + chartH + 64;
  const items: [string, string][] = [
    [ti('analysis.statF1'), stats.avgF1 != null ? `${stats.avgF1.toFixed(0)} Hz` : '—'],
    [ti('analysis.statF2'), stats.avgF2 != null ? `${stats.avgF2.toFixed(0)} Hz` : '—'],
    [ti('analysis.statDuration'), `${stats.durationSec.toFixed(1)} ${ti('analysis.unitSec')}`],
    [ti('analysis.statDb'), `${stats.avgDb.toFixed(1)} dB`],
  ];
  if (stats.jitterPct != null) items.push(['Jitter', `${stats.jitterPct.toFixed(2)} %`]);
  if (stats.shimmerPct != null) items.push(['Shimmer', `${stats.shimmerPct.toFixed(2)} %`]);
  if (stats.hnrDb != null) items.push(['HNR', `${stats.hnrDb.toFixed(1)} dB`]);
  const colW = (W - PAD * 2) / 4;
  items.slice(0, 8).forEach(([label, value], i) => {
    const x = PAD + (i % 4) * colW;
    const y = statY + Math.floor(i / 4) * 96;
    ctx.textAlign = 'left';
    ctx.fillStyle = t.ink2;
    ctx.font = '400 24px "Inter Tight", system-ui, sans-serif';
    ctx.fillText(label, x, y);
    ctx.fillStyle = t.ink;
    ctx.font = '600 36px "Inter Tight", system-ui, sans-serif';
    ctx.fillText(value, x, y + 44);
  });

  drawFooterQr(ctx, t);

  return canvas;
}

function bandRange(band: PitchBand): [number, number] {
  return getBandRanges()[band];
}

/** 迷你音高曲线（分区间着色） */
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

  // 区间背景
  for (const band of ['low', 'male', 'transition', 'female', 'high'] as PitchBand[]) {
    const [f0, f1] = bandRange(band);
    const yTop = yOf(Math.min(f1, fMax));
    const yBot = yOf(Math.max(f0, fMin));
    ctx.fillStyle = hexWithAlpha(BAND_COLORS[band], 0.14);
    ctx.fillRect(x0, yTop, w, yBot - yTop);
  }

  // 曲线
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

/** 画布 → PNG → 系统分享（可用时）或下载 */
export async function shareOrDownload(canvas: HTMLCanvasElement, filename: string): Promise<'shared' | 'downloaded'> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG export failed');
  const file = new File([blob], filename, { type: 'image/png' });

  if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: ti('share.shareTitle') });
    return 'shared';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return 'downloaded';
}

/** 按样式渲染单条记录分享卡（样式选择弹层的预览与导出共用） */
export function renderShareCard(record: AnalysisRecord, style: ShareCardStyle): HTMLCanvasElement {
  if (style === 'flower') return drawFlowerCard(record);
  return drawCard(record, resolvePalette(style));
}

/* ================================ 声之花卡 ================================ */

/** 有机花瓣（Canvas 贝塞尔，与 FlowerSvg 同几何、不同宿主） */
function canvasPetal(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, R: number,
  angleDeg: number, len: number, tipSharpness: number,
  fill: string, stroke: string,
): void {
  const a = ((angleDeg - 90) * Math.PI) / 180; // 0° = 正上
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const tipX = cx + dx * len * R;
  const tipY = cy + dy * len * R;
  const midLen = len * R * 0.55;
  const ctrl = len * R * 0.30;
  const advance = midLen + (len * R - midLen) * tipSharpness * 0.85;
  const c1x = cx + dx * advance + -dy * ctrl;
  const c1y = cy + dy * advance + dx * ctrl;
  const c2x = cx + dx * advance - (-dy * ctrl);
  const c2y = cy + dy * advance - dx * ctrl;
  const sx = cx + dx * R * 0.06;
  const sy = cy + dy * R * 0.06;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.quadraticCurveTo(c1x, c1y, tipX, tipY);
  ctx.quadraticCurveTo(c2x, c2y, sx, sy);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/** 主题色相（与 FlowerSvg 同源：设置 hue；无 DOM 回退 285） */
/** 主题色相：从持久化设置读（与 store 同一 localStorage 键；解析失败回退 285）。
 *  不 import useStore——shareCard 保持与 React/store 解耦（e2e/离线渲染也可用） */
function themeHue(): number {
  try {
    const raw = localStorage.getItem('svt:settings:v1');
    if (raw) {
      const parsed = JSON.parse(raw) as { state?: { settings?: { hue?: number } } };
      const hue = parsed.state?.settings?.hue;
      if (typeof hue === 'number' && isFinite(hue)) return hue;
    }
  } catch { /* fallthrough */ }
  return 285;
}

/** 声之花卡：俯视频谱指纹大花居中 + 「花语」关键数字行 + QR */
function drawFlowerCard(record: AnalysisRecord): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  const p = resolvePalette('themed');
  paintBackground(ctx, p);

  // 页眉（与主卡同款）
  ctx.fillStyle = p.accent;
  ctx.beginPath();
  ctx.arc(PAD + 9, PAD + 14, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = p.ink2;
  ctx.font = '500 30px "Inter Tight", system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('Simple Voice Tool for Trans', PAD + 30, PAD + 15);
  const d = new Date(record.createdAt);
  ctx.textAlign = 'right';
  ctx.fillText(ti('share.flowerTitle'), W - PAD, PAD + 15);
  ctx.strokeStyle = p.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PAD, PAD + 58);
  ctx.lineTo(W - PAD, PAD + 58);
  ctx.stroke();

  // 大花：占卡片中心 65% 空间 —— 俯视频谱指纹（与 FlowerSvg 同几何）
  // 可用高度 = 页眉线(58) 到数字行上方；花外接圆直径 = min(可用高, 可用宽) × 0.65
  const f = flowerOf(record);
  const headerBottom = PAD + 58;
  const factTop = 960;
  const availH = factTop - headerBottom;
  const availW = W - PAD * 2;
  const flowerDiameter = Math.min(availH, availW) * 0.65;
  const R = flowerDiameter / 2;
  const cx = W / 2;
  const cy = headerBottom + availH / 2;
  const hue = themeHue();
  const rot = rotationJitter(record.id);
  const coreR = flowerDiameter * 0.10 * f.coreF1;
  const baseline = f.baselineF2;

  // 花瓣（低频正上顺时针；明度低频亮 → 高频深；瓣尖尖锐度 = F2；整体旋转 rot）
  // 注意：canvasPetal 内部会乘 R（与 FlowerSvg 的 viewBox 几何一致），此处传系数不传像素
  for (const pt of f.petals) {
    const len = baseline * 0.55 + pt.length * baseline * 0.45;
    const light = 82 - pt.lightness * 34;
    canvasPetal(
      ctx, cx, cy, R,
      pt.angleDeg + rot, len, f.tipSharpness,
      `hsl(${hue} ${Math.round(55 - pt.lightness * 20)}% ${Math.round(light)}% / 0.85)`,
      `hsl(${hue} 45% ${Math.round(light - 18)}% / 0.6)`,
    );
  }

  // 花心（F1）
  ctx.fillStyle = `hsl(${hue} 60% 62%)`;
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `hsl(${hue} 55% 80% / 0.85)`;
  ctx.beginPath();
  ctx.arc(cx - coreR * 0.25, cy - coreR * 0.3, coreR * 0.35, 0, Math.PI * 2);
  ctx.fill();

  // 花语（关键数字行）
  const factY = 1010;
  ctx.textAlign = 'center';
  ctx.fillStyle = p.ink;
  ctx.font = '600 44px "Inter Tight", system-ui, sans-serif';
  ctx.fillText(`${sAvg(record)} Hz`, W / 2, factY);
  ctx.fillStyle = p.ink2;
  ctx.font = '400 30px "Inter Tight", system-ui, sans-serif';
  ctx.fillText(
    ti('share.flowerLine', {
      date: `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`,
      mode: record.mode ? ti(`mode.${record.mode}`) : '',
    }),
    W / 2, factY + 62,
  );

  drawFooterQr(ctx, p);
  return canvas;
}

function sAvg(record: AnalysisRecord): string {
  return record.stats.avgF0.toFixed(1);
}

/** 单条记录分享图文件名 */
export function shareImageFilename(record: AnalysisRecord): string {
  const d = new Date(record.createdAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `voice-report-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.png`;
}

/** 对比分享图文件名 */
export function shareCompareFilename(a: AnalysisRecord): string {
  const d = new Date(a.createdAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `voice-compare-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.png`;
}

/* ================================ 对比分享卡 ================================ */

/** A/B 双方概要块的行高基准 */
const CMP_TOP = PAD + 96;

/** 对比 Δ 指标表行：[指标, A 值, B 值, Δ] */
function compareRows(a: AnalysisRecord, b: AnalysisRecord): [string, string, string, string][] {
  const sa = a.stats;
  const sb = b.stats;
  const sign = (v: number, digits = 1) => `${v > 0 ? '+' : ''}${v.toFixed(digits)}`;
  const delta = (x: number | null | undefined, y: number | null | undefined, digits = 1) =>
    x == null || y == null ? '—' : `${sign(y - x, digits)}`;
  const fmt = (v: number | null | undefined, digits = 1, unit = ' Hz') =>
    v == null ? '—' : `${v.toFixed(digits)}${unit}`;

  const rows: [string, string, string, string][] = [
    [ti('analysis.rowAvgF0'), fmt(sa.avgF0), fmt(sb.avgF0), `${delta(sa.avgF0, sb.avgF0)} Hz`],
    [ti('compare.medianF0'), fmt(sa.medianF0), fmt(sb.medianF0), `${delta(sa.medianF0, sb.medianF0)} Hz`],
    [
      ti('compare.rangeP10P90'),
      `${sa.p10F0.toFixed(0)}–${sa.p90F0.toFixed(0)}`,
      `${sb.p10F0.toFixed(0)}–${sb.p90F0.toFixed(0)}`,
      `${delta(sa.p10F0, sb.p10F0, 0)} / ${delta(sa.p90F0, sb.p90F0, 0)} Hz`,
    ],
    [ti('compare.stdF0'), fmt(sa.stdF0), fmt(sb.stdF0), `${delta(sa.stdF0, sb.stdF0)} Hz`],
    [ti('analysis.rowAvgF1'), fmt(sa.avgF1, 0), fmt(sb.avgF1, 0), `${delta(sa.avgF1, sb.avgF1, 0)} Hz`],
    [ti('analysis.rowAvgF2'), fmt(sa.avgF2, 0), fmt(sb.avgF2, 0), `${delta(sa.avgF2, sb.avgF2, 0)} Hz`],
    [ti('compare.avgDb'), fmt(sa.avgDb, 1, ' dB'), fmt(sb.avgDb, 1, ' dB'), `${delta(sa.avgDb, sb.avgDb)} dB`],
  ];
  // 嗓音质量（任一方有值才显示，最多补两行保证排版）
  const vq: [string, number | null | undefined, number | null | undefined, number, string][] = [
    ['Jitter', sa.jitterPct, sb.jitterPct, 2, ' %'],
    ['Shimmer', sa.shimmerPct, sb.shimmerPct, 2, ' %'],
    ['HNR', sa.hnrDb, sb.hnrDb, 1, ' dB'],
    ['CPPS', sa.cppsDb, sb.cppsDb, 1, ' dB'],
  ].filter(([, x, y]) => x != null || y != null) as [string, number | null | undefined, number | null | undefined, number, string][];
  for (const [label, x, y, digits, unit] of vq.slice(0, 2)) {
    rows.push([label, fmt(x, digits, unit), fmt(y, digits, unit), `${delta(x, y, digits)}${unit}`]);
  }
  return rows;
}

/** 绘制 A vs B 对比报告卡（双曲线叠加 + Δ 指标表 + 各自音域） */
function drawCompareCard(a: AnalysisRecord, b: AnalysisRecord, t: Palette): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  const ranges = getBandRanges();
  const fmtDate = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  // 背景 + 页眉
  paintBackground(ctx, t);
  ctx.fillStyle = t.accent;
  ctx.beginPath();
  ctx.arc(PAD + 9, PAD + 14, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = t.ink2;
  ctx.font = '500 30px "Inter Tight", system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('Simple Voice Tool for Trans', PAD + 30, PAD + 15);
  ctx.textAlign = 'right';
  ctx.fillText(ti('share.compareTitle'), W - PAD, PAD + 15);
  ctx.strokeStyle = t.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PAD, PAD + 58);
  ctx.lineTo(W - PAD, PAD + 58);
  ctx.stroke();

  /* A / B 概要块 */
  const colW = (W - PAD * 2 - 48) / 2;
  const sides: { tag: string; rec: AnalysisRecord; color: string; x: number }[] = [
    { tag: 'A', rec: a, color: t.accent, x: PAD },
    { tag: 'B', rec: b, color: t.accent2, x: PAD + colW + 48 },
  ];
  for (const { tag, rec, color, x } of sides) {
    const stats = rec.stats;
    // 标签圆点 + 日期
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + 21, CMP_TOP + 21, 21, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = t.card;
    ctx.font = '700 26px "Inter Tight", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tag, x + 21, CMP_TOP + 23);
    ctx.fillStyle = t.ink2;
    ctx.font = '400 26px "Inter Tight", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(fmtDate(rec.createdAt), x + 56, CMP_TOP + 24);

    // 平均基频大字
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = t.ink;
    ctx.font = '600 84px "Inter Tight", system-ui, sans-serif';
    const numStr = stats.avgF0.toFixed(1);
    ctx.fillText(numStr, x, CMP_TOP + 150);
    const numW = ctx.measureText(numStr).width;
    ctx.fillStyle = t.ink2;
    ctx.font = '400 32px "Inter Tight", system-ui, sans-serif';
    ctx.fillText('Hz', x + numW + 14, CMP_TOP + 150);
    ctx.fillStyle = color;
    ctx.font = '600 38px "Inter Tight", system-ui, sans-serif';
    ctx.fillText(freqToNote(stats.avgF0).name, x + numW + 14 + 62, CMP_TOP + 150);

    // 音区徽标
    const band = bandOf(stats.avgF0);
    const bandLabel = ti(`band.${band}`);
    ctx.font = '600 26px "Inter Tight", system-ui, sans-serif';
    const chipW = ctx.measureText(bandLabel).width + 44;
    ctx.fillStyle = hexWithAlpha(BAND_COLORS[band], 0.18);
    roundRect(ctx, x, CMP_TOP + 178, chipW, 50, 25);
    ctx.fill();
    ctx.fillStyle = t.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(bandLabel, x + chipW / 2, CMP_TOP + 204);

    // 音域行（P10–P90）
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = t.ink2;
    ctx.font = '400 26px "Inter Tight", system-ui, sans-serif';
    ctx.fillText(
      ti('share.rangeLine', { a: stats.p10F0.toFixed(0), b: stats.p90F0.toFixed(0) }),
      x, CMP_TOP + 282,
    );
  }

  // 分隔线
  ctx.strokeStyle = t.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PAD, CMP_TOP + 320);
  ctx.lineTo(W - PAD, CMP_TOP + 320);
  ctx.stroke();

  /* Δ 指标表 */
  const rows = compareRows(a, b);
  const headY = CMP_TOP + 352;
  const rowH = 42;
  const labelX = PAD;
  const aRight = PAD + 500;
  const bRight = PAD + 710;
  const dRight = W - PAD;
  ctx.textBaseline = 'alphabetic';
  ctx.font = '500 24px "Inter Tight", system-ui, sans-serif';
  ctx.fillStyle = t.ink2;
  ctx.textAlign = 'left';
  ctx.fillText(ti('compare.colMetric'), labelX, headY);
  ctx.textAlign = 'right';
  ctx.fillStyle = t.accent;
  ctx.fillText('A', aRight, headY);
  ctx.fillStyle = t.accent2;
  ctx.fillText('B', bRight, headY);
  ctx.fillStyle = t.ink2;
  ctx.fillText(ti('compare.colDelta'), dRight, headY);

  rows.forEach(([label, va, vb, vd], i) => {
    const y = headY + 34 + i * rowH;
    ctx.strokeStyle = t.line;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(PAD, y - rowH / 2 + 4);
    ctx.lineTo(W - PAD, y - rowH / 2 + 4);
    ctx.stroke();
    ctx.fillStyle = t.ink2;
    ctx.textAlign = 'left';
    ctx.font = '400 25px "Inter Tight", system-ui, sans-serif';
    ctx.fillText(label, labelX, y);
    ctx.fillStyle = t.ink;
    ctx.font = '600 25px "Inter Tight", system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(va, aRight, y);
    ctx.fillText(vb, bRight, y);
    ctx.fillText(vd, dRight, y);
  });
  const tableEnd = headY + 34 + rows.length * rowH;

  /* 双曲线叠加图（x 按各自时长归一化对齐）；底部让位给二维码行 */
  const chartY = tableEnd + 36;
  const chartH = Math.max(128, Math.min(H - PAD - 28 - chartY, 1106 - chartY));
  ctx.fillStyle = t.surface;
  roundRect(ctx, PAD, chartY, W - PAD * 2, chartH, 28);
  ctx.fill();

  const fMin = 50;
  const fMax = 520;
  const inX = PAD + 20;
  const inW = W - PAD * 2 - 40;
  const inY = chartY + 20;
  const inH = chartH - 40;
  const xOf = (tt: number, dur: number) => inX + (tt / Math.max(dur, 0.01)) * inW;
  const yOf = (f: number) => inY + inH - ((Math.max(fMin, Math.min(fMax, f)) - fMin) / (fMax - fMin)) * inH;

  // 音区背景
  for (const band of ['low', 'male', 'transition', 'female', 'high'] as PitchBand[]) {
    const [f0, f1] = ranges[band];
    ctx.fillStyle = hexWithAlpha(BAND_COLORS[band], 0.14);
    ctx.fillRect(inX, yOf(f1), inW, yOf(f0) - yOf(f1));
  }

  // 两条曲线（区间着色淡化为主题色，A/B 色差优先）
  for (const { rec, color } of [{ rec: a, color: t.accent }, { rec: b, color: t.accent2 }]) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    let open = false;
    for (let i = 0; i < rec.series.t.length; i++) {
      const f = rec.series.f0[i];
      if (f == null || !isFinite(f)) {
        open = false;
        continue;
      }
      const x = xOf(rec.series.t[i], rec.durationSec);
      const y = yOf(f);
      if (!open) {
        ctx.moveTo(x, y);
        open = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  // 图例（自右向左排布，最终视觉顺序 A → B）
  ctx.font = '600 26px "Inter Tight", system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  let legendX = W - PAD - 20 - ctx.measureText('B').width - 46;
  for (const [tag, color] of [['B', t.accent2], ['A', t.accent]] as const) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(legendX + 10, chartY + 30, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = t.ink;
    ctx.textAlign = 'left';
    ctx.fillText(tag, legendX + 28, chartY + 31);
    legendX -= 56;
  }

  drawFooterQr(ctx, t);

  return canvas;
}

/** 按样式渲染 A vs B 对比分享卡 */
export function renderShareCompareCard(a: AnalysisRecord, b: AnalysisRecord, style: ShareCardStyle): HTMLCanvasElement {
  return drawCompareCard(a, b, resolvePalette(style));
}
