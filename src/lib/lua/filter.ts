/**
 * Lua 记录过滤器（实验性「脚本中心」消费方 #2）
 * History 搜索框以 `lua:` 开头时切换为表达式过滤：
 *   lua:stats.avgF0 < 150 and record.mode == 'sustained'
 * 表达式被包进 function(stats, record, note) ... end 执行，真值 = 命中。
 * stats = 统计字段（含 mode）；record = 记录级字段（id/createdAt/mode/note）。
 * 与建议脚本同一沙箱（500ms 看门狗 / 无 IO）；出错时显示错误并视为无命中。
 */

import type { AnalysisRecord } from '@/types';
import { runLuaFn } from './engine';

/** 搜索串是否为 Lua 过滤表达式 */
export function isLuaFilter(query: string): boolean {
  return query.trimStart().toLowerCase().startsWith('lua:');
}

/** 取 lua: 之后的表达式体 */
export function luaFilterExpr(query: string): string {
  return query.trimStart().slice(4).trim();
}

/** 过滤器脚本可见的 record 视图（可序列化、稳定形态） */
export function recordView(rec: AnalysisRecord): Record<string, unknown> {
  const d = new Date(rec.createdAt);
  return {
    id: rec.id,
    createdAt: rec.createdAt,
    /** 预格式化日期（宿主 locale）：分享卡模板直接展示用 */
    dateStr: `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
    durationSec: rec.durationSec,
    mode: rec.mode ?? 'reading',
    note: rec.note ?? '',
    stats: {
      durationSec: rec.stats.durationSec,
      avgF0: rec.stats.avgF0,
      medianF0: rec.stats.medianF0,
      minF0: rec.stats.minF0,
      maxF0: rec.stats.maxF0,
      p10F0: rec.stats.p10F0,
      p90F0: rec.stats.p90F0,
      stdF0: rec.stats.stdF0,
      malePct: rec.stats.malePct,
      femalePct: rec.stats.femalePct,
      transitionPct: rec.stats.transitionPct,
      avgF1: rec.stats.avgF1 ?? null,
      avgF2: rec.stats.avgF2 ?? null,
      f2f1GapHz: rec.stats.f2f1GapHz ?? null,
      avgDb: rec.stats.avgDb,
      peakDb: rec.stats.peakDb,
      jitterPct: rec.stats.jitterPct ?? null,
      shimmerPct: rec.stats.shimmerPct ?? null,
      hnrDb: rec.stats.hnrDb ?? null,
      cppsDb: rec.stats.cppsDb ?? null,
      inTargetPct: rec.stats.inTargetPct ?? null,
      totalSamples: rec.stats.totalSamples,
      voicedSamples: rec.stats.voicedSamples,
    },
  };
}

/**
 * 逐条执行过滤表达式。表达式以 stats 为主视角（最常用），
 * 另提供 record（含 id/mode/note/createdAt）。
 * 返回命中集合与首条错误（UI 展示）；表达式非法时全部不命中。
 */
export async function luaFilterRecords(
  records: AnalysisRecord[],
  expr: string,
): Promise<{ hits: Set<string>; error: string | null }> {
  const hits = new Set<string>();
  if (!expr) return { hits, error: null };
  // 安全包一层：表达式只在函数体内，return 其值；注释/多行都合法
  const code = `function __filter(stats, record, note) return (${expr}) end`;
  // 编译期校验一次（用第一条记录），失败直接整体报错
  for (const rec of records) {
    const v = recordView(rec);
    const res = await runLuaFn<unknown>(code, '__filter', [v.stats, v, rec.note ?? '']);
    if (!res.ok) {
      return { hits, error: res.error };
    }
    // Lua 真值语义：仅 false / nil 为假，数字、字符串、表等一律为真
    if (res.value !== false && res.value != null) hits.add(rec.id);
  }
  return { hits, error: null };
}
