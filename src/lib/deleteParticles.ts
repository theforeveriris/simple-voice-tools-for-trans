/**
 * 删除记录的「纸屑」碎裂效果（Telegram Dust-effect 风格）
 *
 * 不截图、不引入额外依赖：
 *  1. 把卡片 DOM 克隆成网格碎片（每片用 overflow 裁切同一份克隆），
 *     碎片拼起来与卡片完全一致，再一起向外散开、旋转、下坠、淡出；
 *  2. 叠加少量细尘粒子，遮住碎片之间的缝隙，让内容像被“打碎”而不是缩小。
 * 卡片本体同时立即隐藏，由碎片接管视觉，随后列表平滑补位。
 */

const MIN_DUST = 14;
const MAX_DUST = 36;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 把克隆里的 canvas（迷你波形）转成同尺寸背景图，cloneNode 不会复制画布像素 */
function freezeCanvases(source: HTMLElement, clone: HTMLElement): void {
  const srcCanvases = source.querySelectorAll('canvas');
  const dstCanvases = clone.querySelectorAll('canvas');
  dstCanvases.forEach((canvas, i) => {
    const sourceCanvas = srcCanvases[i] as HTMLCanvasElement | undefined;
    if (!sourceCanvas) return;
    try {
      const url = sourceCanvas.toDataURL();
      const replacement = document.createElement('div');
      replacement.className = canvas.className;
      const style = canvas.getAttribute('style');
      if (style) replacement.setAttribute('style', style);
      replacement.style.backgroundImage = `url(${url})`;
      replacement.style.backgroundSize = '100% 100%';
      replacement.style.backgroundRepeat = 'no-repeat';
      replacement.setAttribute('aria-hidden', 'true');
      canvas.replaceWith(replacement);
    } catch {
      // 画布被污染时保持透明，不影响文字碎片
    }
  });
}

export function spawnDeleteParticles(el: HTMLElement): void {
  if (prefersReducedMotion()) return;

  const rect = el.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return;

  // 克隆卡片：清掉 framer-motion 的临时内联样式，恢复成完整卡片尺寸
  const master = el.cloneNode(true) as HTMLElement;
  master.style.position = 'absolute';
  master.style.left = '0';
  master.style.top = '0';
  master.style.width = `${rect.width}px`;
  master.style.height = `${rect.height}px`;
  master.style.margin = '0';
  master.style.paddingTop = '';
  master.style.paddingBottom = '';
  master.style.transform = 'none';
  master.style.opacity = '1';
  master.style.filter = 'none';
  master.style.boxShadow = 'none';
  master.style.overflow = 'visible';
  master.style.pointerEvents = 'none';
  master.removeAttribute('role');
  master.removeAttribute('tabindex');
  master.setAttribute('aria-hidden', 'true');
  freezeCanvases(el, master);

  const layer = document.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  layer.setAttribute('inert', '');
  layer.style.cssText = [
    'position:fixed',
    `left:${rect.left}px`,
    `top:${rect.top}px`,
    `width:${rect.width}px`,
    `height:${rect.height}px`,
    'pointer-events:none',
    'z-index:80',
    'overflow:visible',
  ].join(';');
  document.body.appendChild(layer);

  const animations: Animation[] = [];
  const cols = rect.width > 760 ? 10 : rect.width > 500 ? 8 : 6;
  const rows = Math.max(4, Math.min(6, Math.round(rect.height / 16)));

  // 纸屑碎片：先完整拼回卡片，短暂停留后再向四周炸开
  for (let row = 0; row < rows; row += 1) {
    const y0 = Math.round((row * rect.height) / rows);
    const y1 = row === rows - 1 ? Math.round(rect.height) : Math.round(((row + 1) * rect.height) / rows);
    for (let col = 0; col < cols; col += 1) {
      const x0 = Math.round((col * rect.width) / cols);
      const x1 = col === cols - 1 ? Math.round(rect.width) : Math.round(((col + 1) * rect.width) / cols);

      const shard = document.createElement('div');
      shard.style.cssText = [
        'position:absolute',
        `left:${x0}px`,
        `top:${y0}px`,
        `width:${x1 - x0}px`,
        `height:${y1 - y0}px`,
        'overflow:hidden',
        'will-change:transform,opacity',
        'box-shadow:0 0 0 0.5px rgba(28,25,45,0.055)',
      ].join(';');
      const piece = master.cloneNode(true) as HTMLElement;
      piece.style.left = `${-x0}px`;
      piece.style.top = `${-y0}px`;
      shard.appendChild(piece);
      layer.appendChild(shard);

      const centerX = (x0 + x1) / 2 - rect.width / 2;
      const centerY = (y0 + y1) / 2 - rect.height / 2;
      const angle = Math.atan2(centerY, centerX) + (Math.random() - 0.5) * 0.7;
      const distance = 18 + Math.random() * 54 + Math.hypot(centerX, centerY) * 0.18;
      const dx = Math.cos(angle) * distance;
      // 纸屑主要向外/向下散，不往上方搜索栏扑
      const dy = Math.max(Math.sin(angle) * distance, -6);
      const rotation = (Math.random() - 0.5) * 160;
      const delay = 60 + Math.random() * 50;
      const duration = 360 + Math.random() * 180;

      animations.push(shard.animate(
        [
          {
            transform: 'translate3d(0,0,0) rotate(0deg)',
            opacity: 1,
            offset: 0,
          },
          {
            transform: `translate3d(${(dx * 0.5).toFixed(1)}px, ${(dy * 0.45 - 6).toFixed(1)}px, 0) rotate(${(rotation * 0.5).toFixed(1)}deg)`,
            opacity: 1,
            offset: 0.45,
          },
          {
            transform: `translate3d(${(dx + (Math.random() - 0.5) * 20).toFixed(1)}px, ${(dy * 0.55 + 26 + Math.random() * 24).toFixed(1)}px, 0) rotate(${rotation.toFixed(1)}deg)`,
            opacity: 0,
            offset: 1,
          },
        ],
        {
          duration,
          delay,
          easing: 'cubic-bezier(0.16, 0.74, 0.28, 1)',
          fill: 'forwards',
        },
      ));
    }
  }

  // 细尘：填补碎片缝隙，让消失更接近“化为纸屑”
  const styles = getComputedStyle(el);
  const bg = styles.backgroundColor || 'rgb(255,255,255)';
  const ink = styles.color || 'rgb(28,25,45)';
  const accentEl = el.querySelector('.text-accent');
  const accent = accentEl ? getComputedStyle(accentEl).color : ink;
  const dustCount = Math.max(
    MIN_DUST,
    Math.min(MAX_DUST, Math.round((rect.width * rect.height) / 2200)),
  );
  for (let i = 0; i < dustCount; i += 1) {
    const roll = Math.random();
    const color = roll < 0.72 ? bg : roll < 0.92 ? ink : accent;
    const w = 2 + Math.random() * 4;
    const h = 1.5 + Math.random() * 3;
    const x = Math.random() * Math.max(1, rect.width - w);
    const y = Math.random() * Math.max(1, rect.height - h);
    const dust = document.createElement('span');
    dust.style.cssText = [
      'position:absolute',
      `left:${x.toFixed(1)}px`,
      `top:${y.toFixed(1)}px`,
      `width:${w.toFixed(1)}px`,
      `height:${h.toFixed(1)}px`,
      `background:${color}`,
      'border-radius:1px',
      'opacity:0',
      'will-change:transform,opacity',
      'box-shadow:0 0 0 0.5px rgba(28,25,45,0.04)',
    ].join(';');
    layer.appendChild(dust);

    const angle = Math.atan2(y - rect.height / 2, x - rect.width / 2)
      + (Math.random() - 0.5) * 1.1;
    const distance = 14 + Math.random() * 64;
    const dx = Math.cos(angle) * distance;
    const dy = Math.max(Math.sin(angle) * distance, -6);
    const rotation = (Math.random() - 0.5) * 160;
    const delay = 50 + Math.random() * 60;
    const duration = 340 + Math.random() * 160;

    animations.push(dust.animate(
      [
        { transform: 'translate3d(0,0,0)', opacity: 0, offset: 0 },
        {
          transform: `translate3d(${(dx * 0.22).toFixed(1)}px, ${(dy * 0.18 - 2).toFixed(1)}px, 0) rotate(${(rotation * 0.18).toFixed(1)}deg)`,
          opacity: 1,
          offset: 0.2,
        },
        {
          transform: `translate3d(${(dx * 0.55).toFixed(1)}px, ${(dy * 0.55 - 10).toFixed(1)}px, 0) rotate(${(rotation * 0.55).toFixed(1)}deg)`,
          opacity: 0.9,
          offset: 0.55,
        },
        {
          transform: `translate3d(${(dx + (Math.random() - 0.5) * 24).toFixed(1)}px, ${(dy + 26 + Math.random() * 22).toFixed(1)}px, 0) rotate(${rotation.toFixed(1)}deg)`,
          opacity: 0,
          offset: 1,
        },
      ],
      {
        duration,
        delay,
        easing: 'cubic-bezier(0.16, 0.74, 0.28, 1)',
        fill: 'forwards',
      },
    ));
  }

  void Promise.allSettled(animations.map((animation) => animation.finished))
    .then(() => layer.remove());
}
