import { describe, expect, it } from 'vitest';
import { validateToolArgs } from './assistantToolValidation';
import type { LlmToolSpec } from './llm';

const spec: LlmToolSpec = {
  name: 'get_record',
  description: 'q',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 20 },
      mode: { type: 'string', enum: ['reading', 'sustained'] },
      ids: {
        type: 'array',
        minItems: 2,
        maxItems: 4,
        items: { type: 'string' },
      },
    },
    required: ['id'],
  },
};

describe('validateToolArgs', () => {
  it('accepts valid arguments', () => {
    expect(validateToolArgs(spec, { id: 'r1', limit: 3, mode: 'reading' })).toBeNull();
    expect(validateToolArgs(spec, { id: 'r1', ids: ['a', 'b'] })).toBeNull();
  });

  it('reports missing required fields', () => {
    expect(validateToolArgs(spec, {})).toContain('id 是必填项');
  });

  it('reports type, enum, range and array errors', () => {
    expect(validateToolArgs(spec, { id: 1 })).toContain('应为 string');
    expect(validateToolArgs(spec, { id: 'r1', mode: 'singing' })).toContain('只能是');
    expect(validateToolArgs(spec, { id: 'r1', limit: 0 })).toContain('不能小于 1');
    expect(validateToolArgs(spec, { id: 'r1', limit: 2.5 })).toContain('应为 integer');
    expect(validateToolArgs(spec, { id: 'r1', ids: ['a'] })).toContain('至少需要 2 项');
    expect(validateToolArgs(spec, { id: 'r1', ids: ['a', 'b', 3] })).toContain('ids[2]');
  });

  it('ignores unknown fields and empty schemas', () => {
    expect(validateToolArgs(spec, { id: 'r1', extra: true })).toBeNull();
    expect(validateToolArgs({ name: 'x', description: 'q', parameters: {} }, { any: 1 })).toBeNull();
  });
});
