/**
 * 同步信令二维码
 * - 把 offer / answer 文本渲染成二维码（uqr，画到 canvas，按设备像素比放大）
 * - 固定黑码白底 + 4 模块静区：相机识别最稳，不跟随深浅色主题反色
 * - 内容超出二维码容量时不渲染半个码，改为提示改用复制粘贴
 */

import { useEffect, useRef } from 'react';
import { encode as qrEncode } from 'uqr';
import { t } from '@/i18n';

/** 二维码字节模式的理论上限（version 40，ECC L） */
const MAX_BYTES = 2900;
/** 静区宽度（模块数），扫描器识别所需 */
const QUIET = 4;

export function SyncQr({ value, size = 200 }: { value: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // 字节数用 UTF-8 计算，避免中文设备名把容量算少；渲染前就能判定，不必进 effect
  const tooLong = Boolean(value) && new TextEncoder().encode(value).length > MAX_BYTES;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !value || tooLong) return;
    let alive = true;
    try {
      const { size: modules, data } = qrEncode(value, { ecc: 'L' });
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const px = Math.round(size * dpr);
      canvas.width = px;
      canvas.height = px;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const total = modules + QUIET * 2;
      const cell = px / total;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, px, px);
      ctx.fillStyle = '#0A0A0A';
      for (let r = 0; r < modules; r++) {
        if (!alive) return;
        const row = data[r];
        for (let c = 0; c < modules; c++) {
          if (row[c]) {
            ctx.fillRect(
              Math.floor((c + QUIET) * cell),
              Math.floor((r + QUIET) * cell),
              Math.ceil(cell),
              Math.ceil(cell),
            );
          }
        }
      }
    } catch {
      /* 容量或编码异常：保持空白，外层仍可用复制粘贴 */
    }
    return () => {
      alive = false;
    };
  }, [value, size, tooLong]);

  if (tooLong) {
    return <p className="max-w-[240px] text-center text-[11px] leading-relaxed text-ink-2">{t('lanSync.qrTooLong')}</p>;
  }
  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size }}
      className="rounded-xl border border-line/60"
      aria-label={t('lanSync.qrHint')}
    />
  );
}
