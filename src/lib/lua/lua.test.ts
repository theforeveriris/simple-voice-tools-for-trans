/**
 * Lua 沙箱与建议引擎测试（node 环境跑真实 wasmoon wasm）
 */

import { describe, expect, it } from 'vitest';
import { runLuaFn, getLuaEngine } from './engine';
import { buildLuaAdvice, normalizeTips } from './advice';
import type { AnalysisRecord } from '@/types';

describe('lua engine', () => {
  it('runs a simple function and returns the value', async () => {
    const res = await runLuaFn<number>(
      'function double(x) return x * 2 end',
      'double',
      [21],
    );
    expect(res).toEqual({ ok: true, value: 42 });
  });

  it('reports syntax errors as { ok: false }', async () => {
    const res = await runLuaFn('function bad( end', 'bad', []);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBeTruthy();
  });

  it('missing global function is an error', async () => {
    const res = await runLuaFn('x = 1', 'nosuchfn', []);
    expect(res.ok).toBe(false);
  });

  it('dangerous libs are removed', async () => {
    const engine = await getLuaEngine();
    // os/io 清空后 global.get 返回 null（wasmoon 把不存在/nil 全局读作 null）
    expect(engine.global.get('os')).toBeFalsy();
    expect(engine.global.get('io')).toBeFalsy();
    expect(engine.global.get('require')).toBeFalsy();
    // 看门狗靠调试钩子实现：debug 能改钩子、coroutine 能另开无钩子线程，都必须移除
    expect(engine.global.get('debug')).toBeFalsy();
    expect(engine.global.get('coroutine')).toBeFalsy();
    expect(engine.global.get('package')).toBeFalsy();
  });

  it('null stats fields become nil (wasmoon null-push workaround)', async () => {
    const res = await runLuaFn<{ hasJitter: unknown; f0: number }>(
      'function probe(s) return { hasJitter = s.jitterPct, f0 = s.avgF0 } end',
      'probe',
      [{ avgF0: 120, jitterPct: null }],
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.hasJitter).toBeFalsy(); // nil → undefined/null 读回
      expect(res.value.f0).toBe(120);
    }
  });

  it('times out infinite loops instead of hanging', async () => {
    const res = await runLuaFn(
      'function spin() while true do end end',
      'spin',
      [],
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/timeout/i);
  }, 15000);

  it('顶层死循环同样会超时（doString 的顶层线程没有看门狗）', async () => {
    const res = await runLuaFn('while true do end', 'advise', []);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/timeout/i);
  }, 15000);

  it('脚本未定义目标函数时不会复用上一个脚本残留的同名函数', async () => {
    const first = await runLuaFn<number>('function advise() return 7 end', 'advise', []);
    expect(first).toEqual({ ok: true, value: 7 });
    // 共享 VM：若不清全局，这里会静默用旧脚本的函数跑新数据
    const second = await runLuaFn('x = 1', 'advise', []);
    expect(second.ok).toBe(false);
  });

  it('非法函数名直接拒绝（不拼接进 Lua 源码）', async () => {
    const res = await runLuaFn('x = 1', 'advise\nos = nil', []);
    expect(res.ok).toBe(false);
  });

  it('tables round-trip between js and lua', async () => {
    const res = await runLuaFn<{ a: number; b: string }>(
      'function pick(t) return { a = t.x * 2, b = "hi" } end',
      'pick',
      [{ x: 5 }],
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.a).toBe(10);
      expect(res.value.b).toBe('hi');
    }
  });
});

/** 最小可用记录（仅 Lua 建议用到的字段） */
function fakeRecord(over: Partial<AnalysisRecord['stats']> = {}): AnalysisRecord {
  return {
    id: 't1',
    createdAt: Date.now(),
    durationSec: 10,
    sampleHz: 30,
    series: { t: [], f0: [], rmsDb: [], f1: [], f2: [] },
    stats: {
      durationSec: 10,
      sampleHz: 30,
      totalSamples: 300,
      voicedSamples: 250,
      avgF0: 180,
      medianF0: 175,
      minF0: 120,
      maxF0: 240,
      p10F0: 140,
      p90F0: 220,
      stdF0: 20,
      malePct: 10,
      femalePct: 70,
      transitionPct: 20,
      avgF1: 600,
      avgF2: 1800,
      f2f1GapHz: 1200,
      avgDb: -30,
      peakDb: -12,
      ...over,
    },
    mode: 'reading',
  } as AnalysisRecord;
}

describe('lua advice', () => {
  it('builtin script produces tips for off-target f0', async () => {
    const rec = fakeRecord({ avgF0: 100, medianF0: 100 });
    const { tips, errors } = await buildLuaAdvice(rec, { enabled: true, min: 120, max: 220 });
    if (errors.length) console.log('lua advice errors:', errors);
    expect(errors).toEqual([]);
    expect(tips.length).toBeGreaterThan(0);
    expect(tips[0].text).toContain('低');
  });

  it('all-good stats produce the keep-it-up tip', async () => {
    const rec = fakeRecord();
    const { tips, errors } = await buildLuaAdvice(rec, { enabled: false, min: 120, max: 220 });
    expect(errors).toEqual([]);
    expect(tips.some((t) => t.text.includes('保持'))).toBe(true);
  });

  it('broken user scripts are skipped without killing others', async () => {
    // 直接调用引擎层验证容错（不污染用户存储）
    const res = await runLuaFn('function advise(s) error("boom") end', 'advise', [{}]);
    expect(res.ok).toBe(false);
  });
});

describe('normalizeTips', () => {
  it('接受 { text, level } 表（脚本中心预览据此显示文案而非 [object Object]）', () => {
    const tips = normalizeTips([{ text: '抬高音高', level: 'warn' }]);
    expect(tips).toEqual([{ text: '抬高音高', level: 'warn' }]);
  });

  it('接受纯字符串建议', () => {
    const tips = normalizeTips(['保持练习']);
    expect(tips).toEqual([{ text: '保持练习', level: 'info' }]);
  });

  it('丢弃非法条目，最多 3 条', () => {
    const tips = normalizeTips([
      { text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }, { nope: 1 },
    ]);
    expect(tips).toHaveLength(3);
    expect(tips.map((t) => t.text)).toEqual(['a', 'b', 'c']);
  });
});
