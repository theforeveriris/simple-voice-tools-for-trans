/**
 * 脚本仓库数据层测试：
 *   - 单文件导入的方向推断（不再一律当成 advice）；
 *   - 单一方向（card/flower/export）互斥：启用新脚本自动停用旧的；
 *   - 历史脏数据归一化：同一方向多个启用 → 只保留第一个；
 *   - 多建议脚本轮转合并（不因默认脚本一次塞满而饿死其他脚本）。
 */

import { describe, expect, it } from 'vitest';
import { buildLuaAdvice } from './advice';
import { BUILTIN_SCRIPTS } from './builtins';
import { runLuaFn } from './engine';
import { recordView } from './filter';
import {
  importLuaFile, inferScriptKind, listScripts, putUserScript, setScriptEnabled,
} from './scripts';
import type { AnalysisRecord } from '@/types';

describe('inferScriptKind', () => {
  it('默认按 advice 识别', () => {
    expect(inferScriptKind('function advise(stats) return {} end')).toBe('advice');
  });
  it('template → card', () => {
    expect(inferScriptKind('function template(record) return {} end')).toBe('card');
  });
  it('flower → flower', () => {
    expect(inferScriptKind('function flower(stats) return { petals = {} } end')).toBe('flower');
  });
  it('export → export', () => {
    expect(inferScriptKind('function export(record) return { filename = "a", content = "b" } end')).toBe('export');
  });
});

describe('importLuaFile', () => {
  it('按内容推断方向（导出脚本导入后不再是 advice）', async () => {
    const n = await importLuaFile('my-export.lua', 'function export(record) return { filename = "x", content = "y" } end');
    expect(n).toBe(1);
    const all = await listScripts();
    const mine = all.find((s) => s.name === 'my-export');
    expect(mine?.kind).toBe('export');
    expect(mine?.enabled).toBe(true); // 用户脚本默认启用
  });
});

describe('单一方向互斥', () => {
  it('启用第二个 card 脚本会自动停用第一个，并返回被停用名单', async () => {
    // 先确保只有内置暗色极简卡启用
    await setScriptEnabled('builtin-card-light-minimal', false);
    await setScriptEnabled('builtin-card-aurora-glow', false);
    const before = await listScripts();
    expect(before.find((s) => s.id === 'builtin-card-dark-minimal')?.enabled).toBe(true);

    const res = await setScriptEnabled('builtin-card-light-minimal', true);
    expect(res.displaced.length).toBeGreaterThan(0);
    expect(res.displaced.some((n) => n.includes('暗色'))).toBe(true);

    const after = await listScripts();
    const enabledCards = after.filter((s) => s.kind === 'card' && s.enabled);
    expect(enabledCards.map((s) => s.id)).toEqual(['builtin-card-light-minimal']);

    // 恢复默认暗色极简卡
    await setScriptEnabled('builtin-card-dark-minimal', true);
  });

  it('导出/花朵方向同样只允许一个生效', async () => {
    const all = await listScripts();
    const exportIds = all.filter((s) => s.kind === 'export').map((s) => s.id);
    expect(exportIds).toContain('builtin-export-praat-bundle');
    expect(exportIds).toContain('builtin-export-csv-frames');

    const res = await setScriptEnabled('builtin-export-csv-frames', true);
    expect(res.displaced.length).toBeGreaterThan(0);
    const after = await listScripts();
    const enabledExports = after.filter((s) => s.kind === 'export' && s.enabled);
    expect(enabledExports.map((s) => s.id)).toEqual(['builtin-export-csv-frames']);

    await setScriptEnabled('builtin-export-praat-bundle', true);
  });
});

describe('历史脏数据归一化', () => {
  it('同一方向多个启用（用户脚本默认启用）只保留第一个', async () => {
    // 关掉内置卡，只留用户脚本验证「保留第一个用户脚本」
    for (const id of ['builtin-card-dark-minimal', 'builtin-card-light-minimal', 'builtin-card-aurora-glow']) {
      await setScriptEnabled(id, false);
    }
    // putUserScript 不设置启用态 → 两个用户卡脚本默认都启用（历史脏数据形态）
    await putUserScript({ id: 'card-a', name: 'card-a', kind: 'card', code: 'function template(record) return {} end', createdAt: 0, updatedAt: 0 });
    await putUserScript({ id: 'card-b', name: 'card-b', kind: 'card', code: 'function template(record) return {} end', createdAt: 0, updatedAt: 0 });

    const all = await listScripts();
    const userCards = all.filter((s) => s.kind === 'card' && !s.builtin);
    expect(userCards.map((s) => s.id)).toEqual(['card-a', 'card-b']);
    const enabled = userCards.filter((s) => s.enabled);
    expect(enabled.length).toBe(1);
    expect(enabled[0].id).toBe('card-a'); // 保留先写入的那个
  });
});

/** 最小建议记录（仅 Lua 建议用到的字段） */
function fakeRecord(): AnalysisRecord {
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
      f1Range: [480, 760],
      f2Range: [1500, 2400],
      avgDb: -30,
      peakDb: -12,
    },
    mode: 'reading',
  } as AnalysisRecord;
}

describe('多建议脚本轮转合并', () => {
  it('默认脚本与用户脚本按轮次交错，不被默认脚本一次塞满', async () => {
    // 确保默认建议脚本启用、其他内置建议停用
    await setScriptEnabled('builtin-advice-default', true);
    for (const id of [
      'builtin-advice-strict-resonance',
      'builtin-advice-voice-rest',
      'builtin-advice-sustained-smooth',
      'builtin-advice-breath-support',
      'builtin-advice-vowel-shape',
    ]) {
      await setScriptEnabled(id, false);
    }

    // 追加一个用户建议脚本：返回固定 3 条
    await importLuaFile('extra-tips.lua', [
      'function advise(stats)',
      '  return { "附加1", "附加2", "附加3" }',
      'end',
    ].join('\n'));

    const { tips, errors } = await buildLuaAdvice(fakeRecord(), { enabled: false, min: 0, max: 500 });
    expect(errors).toEqual([]);
    // 默认脚本 1 条 + 用户脚本 2 条（轮转后总计 3 条，默认与用户交替出现）
    expect(tips.length).toBe(3);
    expect(tips[0].text).toContain('保持'); // 默认脚本第一条
    expect(tips[1].text).toBe('附加1'); // 用户脚本第一条
    expect(tips[2].text).toBe('附加2'); // 用户脚本第二条（默认已无更多）
  });
});

describe('内置脚本可执行', () => {
  it('每个内置脚本用 demo 数据跑一遍都不报错（回归：曾用 + 拼字符串导致导出脚本运行失败）', async () => {
    const rec = fakeRecord();
    const stats = { ...rec.stats, target: { enabled: false, min: 0, max: 500 } };
    for (const b of BUILTIN_SCRIPTS) {
      let args: unknown;
      let fn = 'advise';
      if (b.kind === 'advice') {
        args = stats;
        fn = 'advise';
      } else if (b.kind === 'card') {
        args = recordView(rec);
        fn = 'template';
      } else if (b.kind === 'flower') {
        args = { ...stats, bands: { hz: [], energy: [] } };
        fn = 'flower';
      } else {
        args = {
          ...recordView(rec),
          // 含缺失值的帧：生产数据里 f0/f1/f2 常为 null，导出脚本必须容错
          series: {
            frames: [
              { t: 0, f0: 180, rmsDb: -30, f1: 600, f2: 1800 },
              { t: 1, f0: null, rmsDb: null, f1: null, f2: null },
            ],
          },
        };
        fn = 'export';
      }
      const res = await runLuaFn<unknown>(b.code, fn, [args]);
      expect(res.ok, `${b.name}（${b.kind}）运行失败：${res.ok ? '' : res.error}`).toBe(true);
    }
  });

  it('导出脚本对缺失值产出空字段而非报错或 nil', async () => {
    const rec = fakeRecord();
    const res = await runLuaFn<{ filename?: unknown; content?: unknown }>(
      BUILTIN_SCRIPTS.find((b) => b.id === 'builtin-export-csv-frames')!.code,
      'export',
      [{
        ...recordView(rec),
        series: {
          frames: [
            { t: 0, f0: 180, rmsDb: -30, f1: 600, f2: 1800 },
            { t: 1, f0: null, rmsDb: null, f1: null, f2: null },
          ],
        },
      }],
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const content = String(res.value.content ?? '');
    // 表头 + 两行数据
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('t,f0_hz,rms_db,f1_hz,f2_hz');
    // 完整帧：各字段都有值（f0 / rms 保留一位小数，f1 / f2 取整）
    expect(lines[1]).toBe('0.000,180.0,-30.0,600,1800');
    // 缺失帧：t 之后的 4 个字段全部留空（不是 nil / 字符串 "nil"）
    expect(lines[2]).toBe('1.000,,,,');
  });
});
