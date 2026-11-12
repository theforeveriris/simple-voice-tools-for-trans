/**
 * History 搜索框的 Lua 过滤器补全
 *
 * - 输入 `lua` → 补全 `lua:`
 * - 输入 `lua:` → 常用字段 + 示例表达式；继续输入字段前缀时按字段过滤
 * - 字段项带当前记录的示例值，方便判断字段含义
 * - 只替换表达式末尾正在输入的字段 token，保留前面的 `... and` 条件
 */

export type LuaCompletionKind = 'prefix' | 'field' | 'example';

export interface LuaFilterCompletion {
  key: string;
  /** 菜单显示文本（字段名或完整示例） */
  label: string;
  /** 选中后写入搜索框的完整文本 */
  insert: string;
  kind: LuaCompletionKind;
  /** 字段的当前记录示例值 */
  detail?: string;
}

/** 常用字段优先展示；其余字段仍可通过输入前缀检索 */
const COMMON_FIELDS = [
  'stats.avgF0',
  'stats.medianF0',
  'stats.minF0',
  'stats.maxF0',
  'stats.p10F0',
  'stats.p90F0',
  'stats.inTargetPct',
  'record.mode',
  'record.note',
  'record.durationSec',
  'record.dateStr',
];

const OTHER_FIELDS = [
  'stats.stdF0',
  'stats.malePct',
  'stats.femalePct',
  'stats.transitionPct',
  'stats.avgF1',
  'stats.avgF2',
  'stats.f2f1GapHz',
  'stats.avgDb',
  'stats.peakDb',
  'stats.jitterPct',
  'stats.shimmerPct',
  'stats.hnrDb',
  'stats.cppsDb',
  'stats.totalSamples',
  'stats.voicedSamples',
  'record.createdAt',
];

const ALL_FIELDS = [...COMMON_FIELDS, ...OTHER_FIELDS];

const EXAMPLES: { key: string; label: string }[] = [
  { key: 'ex-avg', label: 'lua:stats.avgF0 < 150' },
  { key: 'ex-mode', label: "lua:record.mode == 'sustained'" },
  { key: 'ex-target', label: 'lua:stats.inTargetPct >= 80' },
  { key: 'ex-note', label: "lua:string.find(record.note, '练习') ~= nil" },
];

/** 读取 `stats.avgF0` / `record.mode` 这类路径的值（示例对象本身就是 record 视图） */
function getPath(source: Record<string, unknown>, path: string): unknown {
  const keys = path.replace(/^record\./, '').split('.');
  return keys.reduce<unknown>((value, key) => (
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)[key]
      : undefined
  ), source);
}

/** 把示例值压成一行短文本 */
function formatSample(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'string') {
    const oneLine = value.replace(/\s+/g, ' ').trim();
    if (!oneLine) return undefined;
    return oneLine.length > 24 ? `${oneLine.slice(0, 23)}…` : oneLine;
  }
  return undefined;
}

/**
 * 根据输入生成补全项。
 * @param query 搜索框全文
 * @param sample 当前记录视图（recordView），用于字段示例值
 */
export function buildLuaFilterCompletions(
  query: string,
  sample?: Record<string, unknown>,
): LuaFilterCompletion[] {
  const q = query.trimStart();

  // 只输入 lua：补全前缀，同时给出示例
  if (/^lua$/i.test(q)) {
    return [
      { key: 'prefix', label: 'lua:', insert: 'lua:', kind: 'prefix' },
      ...EXAMPLES.map((ex) => ({
        key: ex.key,
        label: ex.label,
        insert: ex.label,
        kind: 'example' as const,
      })),
    ];
  }

  if (!/^lua:/i.test(q)) return [];
  const expr = q.slice(4);
  const token = expr.match(/([A-Za-z_][\w.]*)$/);
  const tokenText = token?.[1] ?? '';

  // 表达式末尾是空格 / 运算符 / 数字时不再弹字段菜单
  if (!tokenText && expr.trim() !== '') return [];

  const prefix = token ? expr.slice(0, token.index) : expr;
  const fields = tokenText
    ? ALL_FIELDS.filter((field) => field.toLowerCase().includes(tokenText.toLowerCase()))
    : ALL_FIELDS;

  const fieldItems: LuaFilterCompletion[] = fields.map((field) => ({
    key: `field:${field}`,
    label: field,
    insert: `lua:${prefix}${field} `,
    kind: 'field',
    detail: field === 'record.createdAt'
      ? undefined
      : formatSample(getPath(sample ?? {}, field)),
  }));

  if (tokenText) return fieldItems;

  return [
    ...EXAMPLES.map((ex) => ({
      key: ex.key,
      label: ex.label,
      insert: ex.label,
      kind: 'example' as const,
    })),
    ...fieldItems,
  ];
}
