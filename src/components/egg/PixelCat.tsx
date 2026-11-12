/**
 * 彩蛋「喵喵练声」的像素猫（粉团子）
 * 像素块由 lib/egg/catSprite 生成；尾巴与眼睛单独成组，
 * 用 CSS 动画摇尾 / 眨眼（遵循 prefers-reduced-motion）。
 */
import { memo, useMemo } from 'react';
import { buildPixelCat, CAT_VIEW, type CatMood } from '@/lib/egg/catSprite';
import { cn } from '@/lib/utils';

const { rects } = buildPixelCat();
const body = rects.filter((r) => r.part === 'body');
const tail = rects.filter((r) => r.part === 'tail');
const eyes = rects.filter((r) => r.part === 'eye');

function Rect({ x, y, size, fill }: { x: number; y: number; size: number; fill: string }) {
  return <rect x={x} y={y} width={size} height={size} fill={fill} />;
}

export const PixelCat = memo(function PixelCat({
  mood,
  reduce,
  className,
}: {
  mood: CatMood;
  reduce: boolean;
  className?: string;
}) {
  const fastTail = mood === 'win';

  const bodyRects = useMemo(() => body.map((r, i) => <Rect key={i} {...r} />), []);
  const tailRects = useMemo(() => tail.map((r, i) => <Rect key={i} {...r} />), []);
  const eyeRects = useMemo(() => eyes.map((r, i) => <Rect key={i} {...r} />), []);

  return (
    <svg viewBox={`0 0 ${CAT_VIEW} ${CAT_VIEW}`} className={className} aria-hidden>
      <ellipse cx="100" cy="178" rx="62" ry="7" fill="#000" opacity=".2" />
      <g shapeRendering="crispEdges">
        {reduce ? (
          <g>{tailRects}</g>
        ) : (
          <g
            className={cn('meow-tail', fastTail && 'meow-tail-fast')}
            style={{ transformBox: 'view-box', transformOrigin: '144px 163px' }}
          >
            {tailRects}
          </g>
        )}
        {bodyRects}
        <g
          className={cn(!reduce && 'meow-eyes')}
          style={{ transformBox: 'view-box', transformOrigin: '100px 69px' }}
        >
          {eyeRects}
        </g>
      </g>
    </svg>
  );
});
