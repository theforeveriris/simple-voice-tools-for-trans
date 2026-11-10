/**
 * 自定义背景图片
 * 开启后背景层（body::before）被图片整体接管：pride 渐变、凌晨极光、莫奈纯色
 * 均被覆盖（index.css 的接管规则置于全部渐变规则之后，特异性压过旗帜与深色）。
 * 图片经降采样 + WebP 编码后存 IndexedDB kv（数百 KB 级），启动时异步预加载，
 * 就绪后借助 opacity 过渡淡入（首帧不等待、不闪烁）。
 *
 * 参数全部走 CSS 变量（applyBgImage 由 useStore 订阅与 App 主题 effect 调用）：
 *   --bg-image-url    图片 objectURL（未加载时为 none，层不可见）
 *   --bg-image-pos    object-position（九宫焦点）
 *   --bg-image-blur   模糊半径
 *   --bg-image-sat    饱和度倍率
 *   --bg-image-dim    压暗比例（深色模式下 CSS 自动加深 1.5 倍）
 *   --bg-image-alpha  存在感（与音量呼吸的 --pride-breath 相乘）
 */

import { idbDeleteKV, idbGetKV, idbPutKV } from '@/lib/storage/idb';
import { hasPageImage } from '@/lib/theme/customTheme';
import type { AppSettings, BgImageFocus } from '@/types';

/** 背景图片在 IndexedDB kv 仓库中的键名（ZIP 备份打包 / 恢复共用） */
export const BG_IMAGE_KV = 'bg-image';
/** 降采样上限（长边 px）：照片级分辨率足够铺满模糊背景，一张控制在数百 KB */
const MAX_EDGE = 2048;

/** 九宫焦点 → object-position */
const FOCUS_POS: Record<BgImageFocus, string> = {
  'top-left': '0% 0%',
  'top': '50% 0%',
  'top-right': '100% 0%',
  'left': '0% 50%',
  'center': '50% 50%',
  'right': '100% 50%',
  'bottom-left': '0% 100%',
  'bottom': '50% 100%',
  'bottom-right': '100% 100%',
};

let objectUrl: string | null = null;

/** 写入/清除背景图 objectURL（先前的 URL 释放） */
function setUrl(blob: Blob | null): void {
  const style = document.documentElement.style;
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  if (!blob) {
    style.removeProperty('--bg-image-url');
    return;
  }
  objectUrl = URL.createObjectURL(blob);
  style.setProperty('--bg-image-url', `url("${objectUrl}")`);
}

/** 当前背景图 objectURL（无图时 null；外观页缩略图与「移除」按钮状态用） */
export function getBgImageUrl(): string | null {
  return objectUrl;
}

/** 把背景图参数同步到 CSS 变量与开关类（不依赖深浅模式，压暗的深色加深在 CSS 内完成） */
export function applyBgImage(s: AppSettings): void {
  const el = document.documentElement;
  // 预设配色：image = 背景层由图片接管；custom 且页面背景选择「图片」时同样接管
  const dark = document.documentElement.classList.contains('dark');
  const active = s.huePreset === 'image'
    || (s.huePreset === 'custom' && hasPageImage(s.customTheme, dark));
  el.classList.toggle('bg-image', active);
  el.classList.toggle('bg-image-static', !s.bgImageDrift);
  const style = el.style;
  style.setProperty('--bg-image-pos', FOCUS_POS[s.bgImageFocus] ?? FOCUS_POS.center);
  style.setProperty('--bg-image-blur', `${Math.round(s.bgImageBlur)}px`);
  style.setProperty('--bg-image-sat', String(s.bgImageSaturation));
  style.setProperty('--bg-image-dim', String(s.bgImageDim));
  style.setProperty('--bg-image-alpha', active ? String(s.bgImageOpacity) : '0');
}

/** 启动预加载：读取 IndexedDB 中的背景图（幂等；已加载时直接返回） */
export async function loadBgImage(): Promise<void> {
  if (objectUrl) return;
  try {
    const blob = await idbGetKV<Blob>(BG_IMAGE_KV);
    if (blob) setUrl(blob);
  } catch {
    /* IndexedDB 不可用时保持无背景图 */
  }
}

/** 保存新背景图：入库 + 立即生效（配额满等错误向上抛由调用方提示） */
export async function saveBgImage(blob: Blob): Promise<void> {
  await idbPutKV(BG_IMAGE_KV, blob);
  setUrl(blob);
}

/** 移除背景图 */
export async function removeBgImage(): Promise<void> {
  await idbDeleteKV(BG_IMAGE_KV);
  setUrl(null);
}

/**
 * 图片处理管线：降采样到长边 ≤2048px，优先编码 WebP（q0.8），
 * 浏览器不支持 WebP 编码时回退 JPEG（q0.85）
 * @throws 非图片文件 / 解码失败 / 编码失败时抛错，由调用方提示
 */
export async function processImageFile(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d unavailable');
    ctx.drawImage(bitmap, 0, 0, w, h);
    let encoded = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.8));
    if (!encoded) {
      encoded = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    }
    if (!encoded) throw new Error('image encode failed');
    return encoded;
  } finally {
    bitmap.close();
  }
}
