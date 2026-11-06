/**
 * Lua 花朵生成脚本（实验性「脚本中心」消费方 #4）
 * 脚本定义 flower(stats) 返回与 Flower 相同结构的参数表：
 *   { petals = { { angleDeg, length, lightness, bandHz? }, ... },
 *     coreF1 = 0..1.2, baselineF2 = 0..1, tipSharpness = 0..1 }
 * 宿主把 stats（统计 + 频带能量摘要）交给脚本，返回值经 normalize 校验后
 * 覆盖 flowerOf() 的产出；脚本出错/未启用时回退内置算法（花永不失败）。
 * 花瓣数 clamp 到 96，防病态脚本撑爆 SVG。
 *
 * 同步消费：flowerOf 是花园虚拟滚动的同步热路径，不能 await。
 * 模式 = 「预计算 + 槽位」：GardenView 异步 computeLuaFlowers → applyLuaFlowers
 * 注入本模块持有的 Map → flowerOf（flower.ts）同步 luaTakeFlower 读。
 * 本模块只 import 类型（type-only），无运行时循环依赖。
 */

import type { Flower, Petal } from '@/lib/flower';
import type { AnalysisRecord } from '@/types';
import { runLuaFn } from './engine';
import { activeScriptOf } from './scripts';

/** 花瓣数与数值范围的安全钳制 */
const MAX_PETALS = 96;

function clamp(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === 'number' && isFinite(v) ? v : fallback;
  return Math.max(lo, Math.min(hi, n));
}

/** 脚本返回的花参数 → Flower（逐项校验，异常回退） */
export function normalizeFlower(value: unknown, fallbackBasis: Flower['basis']): Flower | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  const rawPetals = Array.isArray(o.petals) ? o.petals : null;
  if (!rawPetals || rawPetals.length === 0) return null;
  const petals: Petal[] = [];
  for (const raw of rawPetals.slice(0, MAX_PETALS)) {
    if (!raw || typeof raw !== 'object' || typeof (raw as Record<string, unknown>).length !== 'number') continue;
    const p = raw as Record<string, unknown>;
    const bandHz = typeof p.bandHz === 'number' && isFinite(p.bandHz) ? Math.round(p.bandHz) : null;
    petals.push({
      angleDeg: clamp(p.angleDeg, -360, 720, 0),
      length: clamp(p.length, 0.15, 1, 0.6),
      lightness: clamp(p.lightness, 0, 1, 0.5),
      bandHz,
    });
  }
  if (petals.length === 0) return null;
  return {
    petals,
    coreF1: clamp(o.coreF1, 0.3, 1.2, 0.8),
    baselineF2: clamp(o.baselineF2, 0.4, 1, 0.8),
    tipSharpness: clamp(o.tipSharpness, 0, 1, 0.5),
    basis: { ...fallbackBasis, facts: [...fallbackBasis.facts, 'Lua 脚本生成'] },
  };
}

/** 脚本可见的频带能量摘要（flower.ts bandEnergies 的输出形态） */
export interface BandSummary {
  hz: number[];
  energy: number[];
}

/* -------------------- 预计算槽位 -------------------- */

const luaFlowerSlots = new Map<string, Flower>();

/** 用预计算的 Lua 花填充槽位（花园渲染前调用；整表替换，clear 即回退内置） */
export function applyLuaFlowers(map: Map<string, Flower>): void {
  luaFlowerSlots.clear();
  for (const [id, f] of map) luaFlowerSlots.set(id, f);
}

/** 取该记录的 Lua 花（无则 null）——flower.ts 的 flowerOf 同步消费 */
export function luaTakeFlower(id: string): Flower | null {
  return luaFlowerSlots.get(id) ?? null;
}

/** 脚本可见的 stats 视图（统计 + 频带能量摘要） */
function buildStatsView(rec: AnalysisRecord, bands: BandSummary | null): Record<string, unknown> {
  const s = rec.stats;
  return {
    durationSec: s.durationSec,
    avgF0: s.avgF0,
    medianF0: s.medianF0,
    minF0: s.minF0,
    maxF0: s.maxF0,
    p10F0: s.p10F0,
    p90F0: s.p90F0,
    stdF0: s.stdF0,
    avgF1: s.avgF1 ?? null,
    avgF2: s.avgF2 ?? null,
    f2f1GapHz: s.f2f1GapHz ?? null,
    avgDb: s.avgDb,
    peakDb: s.peakDb,
    jitterPct: s.jitterPct ?? null,
    shimmerPct: s.shimmerPct ?? null,
    hnrDb: s.hnrDb ?? null,
    cppsDb: s.cppsDb ?? null,
    voicedSamples: s.voicedSamples,
    totalSamples: s.totalSamples,
    mode: rec.mode ?? 'reading',
    /** 频带能量摘要（无语谱为空表）：脚本可自定瓣数与瓣长映射 */
    bands: bands ? { hz: bands.hz, energy: bands.energy } : { hz: {}, energy: {} },
  };
}

/** 批量预计算：花园记录集逐条跑生效的 flower 脚本（无脚本/失败 = 空表） */
export async function computeLuaFlowers(
  records: AnalysisRecord[],
  bandOf: (r: AnalysisRecord) => BandSummary | null,
): Promise<Map<string, Flower>> {
  const out = new Map<string, Flower>();
  const script = await activeScriptOf('flower');
  if (!script) return out;
  for (const rec of records) {
    const res = await runLuaFn<unknown>(script.code, 'flower', [buildStatsView(rec, bandOf(rec))]);
    if (!res.ok) continue;
    const f = normalizeFlower(res.value, { petalsFrom: 'template', facts: [] });
    if (f) out.set(rec.id, f);
    if (out.size >= 500) break; // 单次预计算上限，防超长会话卡顿
  }
  return out;
}

