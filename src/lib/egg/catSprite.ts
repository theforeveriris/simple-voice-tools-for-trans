/**
 * 彩蛋「喵喵练声」的像素猫（用户选定的粉团子配色）
 *
 * 用 44×40 的像素网格描述一只坐着的猫：身体/头/耳朵用椭圆与三角形光栅化，
 * 尾巴用粗描边曲线，最后统一向外扩 1px 描边。渲染成 SVG rect（crispEdges），
 * 同时把尾巴与眼睛拆成独立图层，供组件做摇尾 / 眨眼动画。
 */

export type CatMood = 'idle' | 'listening' | 'happy' | 'win';
export type CatPart = 'body' | 'tail' | 'eye';

export interface CatRect {
  x: number;
  y: number;
  /** 像素边长（SVG 用户单位） */
  size: number;
  fill: string;
  part: CatPart;
}

export const CAT_VIEW = 200;
export const CAT_CELL = 4.4;
const OX = 3.2;
const OY = 5;

const W = 44;
const H = 40;

const PAL = {
  o: '#2a171b', // 描边
  f: '#ff9dae', // 头部
  s: '#ee8a9d', // 身体 / 尾巴
  h: '#c9768a', // 耳内
  w: '#f6e7e9', // 胸腹 / 爪子 / 胡须 / 高光
  e: '#2a171b', // 眼睛
  n: '#8f3f52', // 鼻子
  a: '#ff7d93', // 腮红
} as const;

type Cell = keyof typeof PAL;

/** 把形状光栅化到网格，再统一描边 */
function buildGrid(): (Cell | '.')[] {
  const g: (Cell | '.')[][] = Array.from({ length: H }, () => Array<Cell | '.'>(W).fill('.'));
  const set = (x: number, y: number, c: Cell) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi >= 0 && xi < W && yi >= 0 && yi < H) g[yi][xi] = c;
  };

  const ellipse = (cx: number, cy: number, rx: number, ry: number, c: Cell) => {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) set(x, y, c);
      }
    }
  };

  const tri = (p1: number[], p2: number[], p3: number[], c: Cell) => {
    const sign = (a: number[], b: number[], p: number[]) =>
      (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
    const minX = Math.floor(Math.min(p1[0], p2[0], p3[0]));
    const maxX = Math.ceil(Math.max(p1[0], p2[0], p3[0]));
    const minY = Math.floor(Math.min(p1[1], p2[1], p3[1]));
    const maxY = Math.ceil(Math.max(p1[1], p2[1], p3[1]));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const p = [x + 0.5, y + 0.5];
        const d1 = sign(p1, p2, p);
        const d2 = sign(p2, p3, p);
        const d3 = sign(p3, p1, p);
        const neg = d1 < 0 || d2 < 0 || d3 < 0;
        const pos = d1 > 0 || d2 > 0 || d3 > 0;
        if (!(neg && pos)) set(x, y, c);
      }
    }
  };

  const disc = (cx: number, cy: number, r: number, c: Cell) => ellipse(cx, cy, r, r, c);
  const stroke = (points: number[][], r: number, c: Cell) => {
    for (let i = 0; i < points.length - 1; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[i + 1];
      const n = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2);
      for (let k = 0; k <= n; k++) {
        disc(x1 + ((x2 - x1) * k) / n, y1 + ((y2 - y1) * k) / n, r, c);
      }
    }
  };

  // 尾巴（先画，后被身体盖住底部）
  stroke([[32, 36], [37, 35], [39, 28], [38, 23]], 2.2, 's');
  // 身体与头
  ellipse(22, 34, 12, 11, 's');
  ellipse(22, 26, 9, 8, 's');
  ellipse(22, 15, 12, 10, 'f');
  // 耳朵
  tri([11, 8], [13, -1], [21, 7], 'f');
  tri([23, 7], [31, -1], [33, 8], 'f');
  tri([14, 6], [15, 1], [19, 6], 'h');
  tri([25, 6], [29, 1], [30, 6], 'h');
  // 爪子与胸口
  ellipse(15, 38, 4.2, 2, 'w');
  ellipse(29, 38, 4.2, 2, 'w');
  ellipse(22, 30, 4, 4.5, 'w');

  // 向外扩 1px 描边
  const out = g.map((row) => row.slice());
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (g[y][x] !== '.') continue;
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const nx = x + dx;
        const ny = y + dy;
        return nx >= 0 && nx < W && ny >= 0 && ny < H && g[ny][nx] !== '.';
      });
      if (near) out[y][x] = 'o';
    }
  }

  const put = (x: number, y: number, c: Cell) => {
    if (x >= 0 && x < W && y >= 0 && y < H) out[y][x] = c;
  };
  // 眼睛（4×4，含高光）
  for (let y = 13; y <= 16; y++) {
    for (let x = 16; x <= 19; x++) put(x, y, 'e');
    for (let x = 25; x <= 28; x++) put(x, y, 'e');
  }
  put(16, 13, 'w');
  put(28, 13, 'w');
  // 鼻子 / 嘴 / 腮红
  for (const x of [21, 22, 23]) put(x, 20, 'n');
  for (const x of [21, 22, 23]) put(x, 22, 'o');
  for (const [x, y] of [[13, 19], [14, 19], [13, 20], [14, 20], [30, 19], [31, 19], [30, 20], [31, 20]] as const) {
    put(x, y, 'a');
  }
  // 胡须
  for (const [x1, x2, y] of [[6, 9, 17], [5, 9, 20], [35, 38, 17], [35, 39, 20]] as const) {
    for (let x = x1; x <= x2; x++) put(x, y, 'w');
  }

  return out.flat();
}

/**
 * 生成可直接渲染的像素块。尾巴（x≥35 且 y≥21）与眼睛单独分组，
 * 其余为身体；坐标已换算到 200×200 的 viewBox。
 */
export function buildPixelCat(): { rects: CatRect[] } {
  const grid = buildGrid();
  const rects: CatRect[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cell = grid[y * W + x];
      if (cell === '.') continue;
      const eye = y >= 13 && y <= 16 && ((x >= 16 && x <= 19) || (x >= 25 && x <= 28));
      const part: CatPart = eye ? 'eye' : x >= 35 && y >= 21 ? 'tail' : 'body';
      rects.push({
        x: OX + x * CAT_CELL,
        y: OY + y * CAT_CELL,
        size: CAT_CELL,
        fill: PAL[cell],
        part,
      });
    }
  }

  return { rects };
}
