/**
 * 工具参数的轻量 JSON Schema 校验
 *
 * 只覆盖本项目工具实际用到的子集：object / required / properties / type /
 * enum / array items / min-max / minimum-maximum。不是通用 JSON Schema 实现，
 * 目的是在本地尽早发现模型传来的坏参数，避免把错误拖到执行器里。
 */
import type { LlmToolSpec } from './llm';

type Schema = Record<string, unknown>;

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  const actual = typeOf(value);
  if (type === 'number') return actual === 'number' || actual === 'integer';
  return actual === type;
}

function validateValue(value: unknown, schema: Schema, path: string): string | null {
  const rawType = schema.type;
  const types = Array.isArray(rawType)
    ? rawType.filter((t): t is string => typeof t === 'string')
    : typeof rawType === 'string'
      ? [rawType]
      : [];
  if (types.length > 0 && !types.some((type) => matchesType(value, type))) {
    return `${path} 应为 ${types.join(' / ')}，实际是 ${typeOf(value)}`;
  }

  if (Array.isArray(schema.enum)) {
    const values = schema.enum;
    if (!values.some((item) => item === value)) {
      return `${path} 只能是：${values.map((item) => String(item)).join(' / ')}`;
    }
  }

  if (typeof value === 'string') {
    const minLength = typeof schema.minLength === 'number' ? schema.minLength : null;
    const maxLength = typeof schema.maxLength === 'number' ? schema.maxLength : null;
    if (minLength != null && value.length < minLength) return `${path} 太短（至少 ${minLength} 字）`;
    if (maxLength != null && value.length > maxLength) return `${path} 太长（最多 ${maxLength} 字）`;
  }

  if (typeof value === 'number') {
    const minimum = typeof schema.minimum === 'number' ? schema.minimum : null;
    const maximum = typeof schema.maximum === 'number' ? schema.maximum : null;
    if (minimum != null && value < minimum) return `${path} 不能小于 ${minimum}`;
    if (maximum != null && value > maximum) return `${path} 不能大于 ${maximum}`;
  }

  if (Array.isArray(value)) {
    const minItems = typeof schema.minItems === 'number' ? schema.minItems : null;
    const maxItems = typeof schema.maxItems === 'number' ? schema.maxItems : null;
    if (minItems != null && value.length < minItems) return `${path} 至少需要 ${minItems} 项`;
    if (maxItems != null && value.length > maxItems) return `${path} 最多 ${maxItems} 项`;
    const itemSchema = schema.items;
    if (itemSchema && typeof itemSchema === 'object') {
      for (let i = 0; i < value.length; i++) {
        const err = validateValue(value[i], itemSchema as Schema, `${path}[${i}]`);
        if (err) return err;
      }
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties;
    if (properties && typeof properties === 'object') {
      const props = properties as Record<string, Schema>;
      const required = Array.isArray(schema.required)
        ? schema.required.filter((key): key is string => typeof key === 'string')
        : [];
      for (const key of required) {
        if (!(key in (value as Record<string, unknown>))) return `${path}.${key} 是必填项`;
      }
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        const childSchema = props[key];
        if (!childSchema) continue;
        const err = validateValue(child, childSchema, `${path}.${key}`);
        if (err) return err;
      }
    }
  }

  return null;
}

/** 返回第一条可读错误；合法时返回 null */
export function validateToolArgs(
  spec: LlmToolSpec,
  args: Record<string, unknown>,
): string | null {
  const schema = spec.parameters;
  if (!schema || typeof schema !== 'object') return null;
  return validateValue(args, schema as Schema, '参数');
}
