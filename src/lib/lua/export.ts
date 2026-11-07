/**
 * Lua 自定义导出脚本（实验性「脚本中心」消费方 #5：数据格式桥）
 * 脚本定义 export(record) 返回 { filename = "...", content = "..." }：
 *   - filename：建议的下载文件名（自动补全安全字符）
 *   - content：任意文本格式（Praat 脚本、MOR/CHAT、JSON、自定义 CSV 方言……）
 * 桥的本质：把记录的帧级序列（series）与统计交给脚本，让懂目标格式的用户
 * 自己写序列化——app 不必为每种生态维护导出器，Praat/Emu/其他语音学工具链
 * 的用户贴一段脚本即接入。内置示例给一个「Praat 脚本打包」模板。
 * 内容上限 4MB（防脚本生成病态大文本卡爆下载）。
 */

import type { AnalysisRecord } from '@/types';
import { runLuaFn } from './engine';
import { activeScriptOf } from './scripts';
import { recordView } from './filter';

const MAX_CONTENT = 4 * 1024 * 1024;

/** 导出桥的产出：建议文件名 + 文本内容 */
export interface LuaExportResult {
  filename: string;
  content: string;
}

/** 帧级序列视图（series 的安全拷贝；Lua 表 1 基索引不便——直接给数组，脚本用 ipairs） */
function seriesView(rec: AnalysisRecord): Record<string, unknown> {
  const { t, f0, rmsDb, f1, f2 } = rec.series;
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < t.length; i++) {
    rows.push({
      t: t[i],
      f0: f0[i] ?? null,
      rmsDb: rmsDb[i] ?? null,
      f1: f1[i] ?? null,
      f2: f2[i] ?? null,
    });
  }
  return { frames: rows };
}

/** 校验并清洗脚本产出：文件名安全化、内容上限 4MB、非法返回 null */
export function normalizeResult(value: unknown): LuaExportResult | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  if (typeof o.content !== 'string' || !o.content) return null;
  if (o.content.length > MAX_CONTENT) return null;
  const rawName = typeof o.filename === 'string' && o.filename.trim() ? o.filename.trim() : 'export';
  // 文件名安全化：去路径分隔与控制字符，限 120 字符
  // eslint-disable-next-line no-control-regex -- 控制字符正是要过滤的目标
  const filename = rawName.replace(/[/\\:*?"<>|\x00-\x1f]/g, '_').slice(0, 120);
  return { filename, content: o.content };
}

/**
 * 跑启用的 export 类脚本中生效的那个（单一消费方：同一方向只允许一个脚本生效）；
 * 无脚本/出错/产出非法 → null（调用方隐藏入口）。
 */
export async function luaExportOf(rec: AnalysisRecord): Promise<LuaExportResult | null> {
  const script = await activeScriptOf('export');
  if (!script) return null;
  const base = recordView(rec);
  // record 上补 series（帧级序列）——建议/过滤场景不需要，导出场景核心
  const view = { ...base, series: seriesView(rec) };
  const res = await runLuaFn<unknown>(script.code, 'export', [view]);
  if (!res.ok) return null;
  return normalizeResult(res.value);
}

/** 是否有启用的 export 脚本（导出菜单决定是否显示入口） */
export async function luaExportEnabled(): Promise<boolean> {
  return (await activeScriptOf('export')) !== null;
}
