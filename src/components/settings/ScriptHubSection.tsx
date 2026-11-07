/**
 * 脚本中心（实验性功能子区块）
 * 管理 Lua 脚本：内置脚本（可停用）/ 用户脚本（增删改、导入导出 JSON 分享）。
 *
 * 生效规则（同一方向多个脚本怎么办）：
 *   - advice（建议）：可同时启用多个，运行时逐脚本执行后合并（每脚本至多 3 条、总计至多 3 条）；
 *   - card / flower / export（分享卡 / 声之花 / 导出桥）：单一消费方，同一方向同一时间只允许
 *     一个脚本生效——启用新脚本会自动停用该方向的其他脚本。
 *
 * 排版：四个方向各一组折叠标题；展开后脚本以**胶囊**铺开（与 AI 助手页的快捷提问同款）。
 *   - 点胶囊：切换启用态，启用时填充主题强调色；
 *   - 长按胶囊：弹出详情窗（简介 / 源码 / 试跑预览），右键同样可开。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Braces, Download, FileDown, FilePlus2, Flower2, Image,
  Lightbulb, Pencil, Play, Trash2, Upload, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import {
  deleteUserScript, exportScripts, importAny, inferScriptKind, listScripts,
  putUserScript, setScriptEnabled, type LuaScriptView, type ScriptKind,
} from '@/lib/lua/scripts';
import { runLuaFn } from '@/lib/lua/engine';
import { normalizeTips } from '@/lib/lua/advice';
import { normalizeOps } from '@/lib/lua/card';
import { renderCardOps } from '@/lib/lua/cardRender';
import { normalizeFlower } from '@/lib/lua/flower';
import { recordView } from '@/lib/lua/filter';
import { createDemoRecord } from '@/lib/audio/demo';
import { FlowerSvg } from '@/components/flowers/FlowerSvg';
import type { Flower } from '@/lib/flower';
import type { AdviceTarget } from '@/lib/advice';
import type { AnalysisRecord, VoiceStats } from '@/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui';
import { InfoTip } from './InfoTip';
import { cn } from '@/lib/utils';

/** 方向元数据：图标 / 本地化标签 / 是否单一生效 */
const KINDS: {
  kind: ScriptKind;
  icon: LucideIcon;
  labelKey: 'labs.scriptKindAdvice' | 'labs.scriptKindCard' | 'labs.scriptKindFlower' | 'labs.scriptKindExport';
  single: boolean;
}[] = [
  { kind: 'advice', icon: Lightbulb, labelKey: 'labs.scriptKindAdvice', single: false },
  { kind: 'card', icon: Image, labelKey: 'labs.scriptKindCard', single: true },
  { kind: 'flower', icon: Flower2, labelKey: 'labs.scriptKindFlower', single: true },
  { kind: 'export', icon: FileDown, labelKey: 'labs.scriptKindExport', single: true },
];

/** 方向 → 本地化标签键 */
function kindLabelKey(kind: ScriptKind): 'labs.scriptKindAdvice' | 'labs.scriptKindCard' | 'labs.scriptKindFlower' | 'labs.scriptKindExport' {
  return KINDS.find((k) => k.kind === kind)?.labelKey ?? 'labs.scriptKindAdvice';
}

/** 单一消费方方向（同一时间只允许一个脚本生效） */
function isSingleKindOf(kind: ScriptKind): boolean {
  return kind !== 'advice';
}

/** 每个方向对应脚本需定义的全局函数名 */
const FN_NAME: Record<ScriptKind, string> = {
  advice: 'advise',
  card: 'template',
  flower: 'flower',
  export: 'export',
};

/** 试运行用的示例统计（与真实 VoiceStats 同形） */
const DEMO_STATS: VoiceStats = {
  durationSec: 12.4,
  sampleHz: 30,
  totalSamples: 372,
  voicedSamples: 301,
  avgF0: 172.3,
  medianF0: 168,
  minF0: 118,
  maxF0: 245,
  p10F0: 142,
  p90F0: 208,
  stdF0: 18.2,
  malePct: 8.4,
  femalePct: 64.2,
  transitionPct: 27.4,
  avgF1: 610,
  avgF2: 1890,
  f2f1GapHz: 1280,
  f2f1GapMedianHz: 1310,
  spectralTiltDbOct: -6.2,
  f1Range: [480, 760],
  f2Range: [1500, 2400],
  avgDb: -28.6,
  peakDb: -11.4,
  jitterPct: 0.86,
  shimmerPct: 4.1,
  hnrDb: 18.5,
  cppsDb: 14.2,
  inTargetPct: 78.6,
};

const DEMO_TARGET: AdviceTarget = { enabled: true, min: 130, max: 210 };

/** 预览用示例记录（懒生成一次；复用真实 demo 管线，分享卡/音高指令才有内容） */
let demoRecord: AnalysisRecord | null = null;
function demoOf(): AnalysisRecord {
  return (demoRecord ??= createDemoRecord());
}

/** 按方向构造喂给脚本的 demo 参数（与各消费方的真实入参形态一致） */
function demoArgs(kind: ScriptKind, demo: AnalysisRecord): unknown {
  switch (kind) {
    case 'advice':
      return { ...DEMO_STATS, target: DEMO_TARGET };
    case 'card':
      return recordView(demo);
    case 'flower':
      return {
        ...DEMO_STATS, f2f1GapHz: null, jitterPct: null, shimmerPct: null, hnrDb: null, cppsDb: null,
        bands: { hz: {}, energy: {} },
      };
    case 'export': {
      const view = recordView(demo);
      return {
        ...view,
        series: {
          frames: demo.series.t
            .slice(0, 400)
            .map((tt, i) => ({
              t: tt,
              f0: demo.series.f0[i],
              rmsDb: demo.series.rmsDb[i],
              f1: demo.series.f1[i],
              f2: demo.series.f2[i],
            })),
        },
      };
    }
  }
}

/** 新建脚本模板（按方向给出最小可运行示例，用户直接改） */
const TEMPLATE: Record<ScriptKind, string> = {
  advice: [
    '-- 新建议脚本：返回 { text, level } 数组（最多 3 条）',
    '-- level: "info"（普通）或 "warn"（强调）',
    'function advise(stats)',
    '  local tips = {}',
    '  if stats.avgF0 and stats.avgF0 < 150 then',
    '    table.insert(tips, { level = "warn", text = "试着把音高整体抬高一点" })',
    '  end',
    '  return tips',
    'end',
    '',
  ].join('\n'),
  card: [
    '-- 新分享卡模板：返回绘制指令数组',
    '-- 可用指令：bg / text / rect / circle / line / pitch / ruler / qr',
    '-- 画布 1080×1350，安全边距 72px；record.stats 取统计字段',
    'function template(record)',
    '  local s = record.stats',
    '  return {',
    '    { op = "bg", color = "#141024" },',
    '    { op = "text", x = 72, y = 300, text = string.format("%.1f", s.avgF0), size = 100, color = "#F2F0F7" },',
    '  }',
    'end',
    '',
  ].join('\n'),
  flower: [
    '-- 新花朵脚本：返回 { petals, coreF1, baselineF2, tipSharpness }',
    '-- petals: { { angleDeg, length, lightness, bandHz }, ... }（length 0.15–1，lightness 0–1）',
    'function flower(stats)',
    '  local petals = {}',
    '  for i = 1, 12 do',
    '    table.insert(petals, { angleDeg = (i - 1) * 30, length = 0.6, lightness = i / 12 })',
    '  end',
    '  return { petals = petals, coreF1 = 0.8, baselineF2 = 0.8, tipSharpness = 0.5 }',
    'end',
    '',
  ].join('\n'),
  export: [
    '-- 新导出桥：返回 { filename, content }（content 为任意文本格式）',
    '-- record.series.frames 提供帧级序列：t / f0 / rmsDb / f1 / f2',
    'function export(record)',
    '  return { filename = "export.txt", content = "hello" }',
    'end',
    '',
  ].join('\n'),
};

/** 编辑器展开态的本地草稿 */
interface Draft {
  id: string | null; // null = 新建
  name: string;
  code: string;
  kind: ScriptKind;
}

/** 长按详情窗：脚本本体 + 试跑结果 */
interface DetailState {
  script: LuaScriptView;
  status: 'loading' | 'ok' | 'error';
  error?: string;
  advice?: string[];
  flower?: Flower | null;
  cardUrl?: string;
  exportName?: string;
  exportContent?: string;
}

export function ScriptHubSection() {
  useI18n();
  const [scripts, setScripts] = useState<LuaScriptView[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [testing, setTesting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [detail, setDetail] = useState<DetailState | null>(null);

  const reload = () => void listScripts().then(setScripts);
  useEffect(reload, []);

  /** 启用/停用脚本：单一方向自动停用同方向其他脚本，并在 UI 明确告知 */
  const onToggle = async (s: LuaScriptView) => {
    const res = await setScriptEnabled(s.id, !s.enabled);
    if (res.displaced.length > 0) {
      toast.info(t('labs.scriptDisplaced', { name: res.displaced.join('、') }));
    }
    reload();
  };

  /** 打开详情窗：立即显示简介与源码，异步跑一次试跑预览填进下半部分 */
  const openDetail = async (script: LuaScriptView) => {
    setDetail({ script, status: 'loading' });
    const demo = demoOf();
    try {
      if (script.kind === 'advice') {
        const res = await runLuaFn<unknown>(script.code, 'advise', [demoArgs(script.kind, demo)]);
        if (!res.ok) { setDetail({ script, status: 'error', error: res.error }); return; }
        // 与运行时同一套规范化：脚本返回 { text, level } 表时不能显示成 [object Object]
        setDetail({ script, status: 'ok', advice: normalizeTips(res.value).map((tip) => tip.text) });
        return;
      }
      if (script.kind === 'card') {
        const res = await runLuaFn<unknown>(script.code, 'template', [demoArgs(script.kind, demo)]);
        if (!res.ok) { setDetail({ script, status: 'error', error: res.error }); return; }
        const ops = normalizeOps(res.value);
        const canvas = ops.length > 0 ? renderCardOps(ops, demo) : null;
        setDetail({ script, status: 'ok', cardUrl: canvas?.toDataURL('image/png') });
        return;
      }
      if (script.kind === 'flower') {
        const res = await runLuaFn<unknown>(script.code, 'flower', [demoArgs(script.kind, demo)]);
        if (!res.ok) { setDetail({ script, status: 'error', error: res.error }); return; }
        setDetail({ script, status: 'ok', flower: normalizeFlower(res.value, { petalsFrom: 'template', facts: [] }) });
        return;
      }
      const res = await runLuaFn<unknown>(script.code, 'export', [demoArgs(script.kind, demo)]);
      if (!res.ok) { setDetail({ script, status: 'error', error: res.error }); return; }
      const value = res.value;
      if (!value || typeof value !== 'object') {
        setDetail({ script, status: 'ok' });
        return;
      }
      const o = value as { filename?: unknown; content?: unknown };
      if (typeof o.content !== 'string' || !o.content) {
        setDetail({ script, status: 'ok' });
        return;
      }
      setDetail({
        script,
        status: 'ok',
        exportName: typeof o.filename === 'string' ? o.filename : 'export',
        exportContent: o.content.slice(0, 4000),
      });
    } catch (err) {
      setDetail({ script, status: 'error', error: String(err) });
    }
  };

  /** 编辑器内的试运行：按方向校验脚本产出 */
  const testRun = async (code: string, kind: ScriptKind) => {
    setTesting(true);
    const demo = demoOf();
    try {
      if (kind === 'advice') {
        const res = await runLuaFn<unknown>(code, 'advise', [demoArgs(kind, demo)]);
        if (res.ok && Array.isArray(res.value)) {
          toast.success(t('labs.scriptTestOk', { n: res.value.length }));
        } else {
          toast.error(`${t('labs.scriptTestFail')}${res.ok ? '' : `：${res.error}`}`);
        }
        return;
      }
      if (kind === 'card') {
        const res = await runLuaFn<unknown>(code, 'template', [demoArgs(kind, demo)]);
        const ops = res.ok ? normalizeOps(res.value) : [];
        if (ops.length > 0) {
          toast.success(t('labs.scriptTestOkCard', { n: ops.length }));
        } else {
          toast.error(`${t('labs.scriptTestFail')}${res.ok ? '' : `：${res.error}`}`);
        }
        return;
      }
      if (kind === 'flower') {
        const res = await runLuaFn<unknown>(code, 'flower', [demoArgs(kind, demo)]);
        const petals = res.ok && res.value && typeof res.value === 'object'
          && Array.isArray((res.value as { petals?: unknown[] }).petals)
          ? (res.value as { petals: unknown[] }).petals.length : 0;
        if (petals > 0) {
          toast.success(t('labs.scriptTestOkFlower', { n: petals }));
        } else {
          toast.error(`${t('labs.scriptTestFail')}${res.ok ? '' : `：${res.error}`}`);
        }
        return;
      }
      const res = await runLuaFn<unknown>(code, 'export', [demoArgs(kind, demo)]);
      const value = res.ok && res.value && typeof res.value === 'object'
        ? (res.value as { content?: unknown })
        : null;
      if (value && typeof value.content === 'string' && value.content) {
        toast.success(t('labs.scriptTestOkExport', { n: value.content.length }));
      } else {
        toast.error(`${t('labs.scriptTestFail')}${res.ok ? '' : `：${res.error}`}`);
      }
    } finally {
      setTesting(false);
    }
  };

  /**
   * 保存草稿。
   * 生效规则：
   *   - 新建的单一方向脚本 → 保存即生效（停用同方向旧脚本）；
   *   - 编辑已有脚本、且方向改成单一消费方 → 原先启用中的保持在用（停用同方向旧脚本），
   *     原先停用的保持停用，不因为改了方向就被悄悄点亮。
   */
  const saveDraft = async () => {
    if (!draft) return;
    const name = draft.name.trim() || t('labs.scriptUntitled');
    const isNew = draft.id === null;
    const id = draft.id ?? `lua-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const prev = isNew ? undefined : scripts.find((s) => s.id === id);
    const kindChanged = !prev || prev.kind !== draft.kind;
    const wasEnabled = isNew || (prev?.enabled ?? false);
    await putUserScript({ id, name, kind: draft.kind, code: draft.code, createdAt: 0, updatedAt: 0 });
    if (isSingleKindOf(draft.kind) && kindChanged && wasEnabled) {
      await setScriptEnabled(id, true);
    }
    toast.success(t('labs.scriptSaved'));
    setDraft(null);
    reload();
  };

  const doImport = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.lua,.json,text/plain,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const content = await file.text();
        const kind = inferScriptKind(content);
        const n = await importAny(file.name, content);
        if (n > 0) {
          const isLua = /\.lua$/i.test(file.name);
          toast.success(
            isLua
              ? t('labs.scriptImportedKind', { n, kind: t(kindLabelKey(kind)) })
              : t('labs.scriptImported', { n }),
          );
        } else {
          toast.error(t('labs.scriptImportFail'));
        }
        reload();
      } catch {
        toast.error(t('labs.scriptImportFail'));
      }
    };
    input.click();
  };

  const doExport = async () => {
    const all = await listScripts();
    const payload = exportScripts(all);
    const blob = new Blob([payload], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'simple-voice-tool-scripts.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /** 全量自检：把启用中的脚本逐个用 demo 数据跑一遍，报告成功/失败数量 */
  const selfCheck = async () => {
    setChecking(true);
    const demo = demoOf();
    try {
      const enabled = (await listScripts()).filter((s) => s.enabled);
      let ok = 0;
      let fail = 0;
      for (const s of enabled) {
        const res = await runLuaFn<unknown>(s.code, FN_NAME[s.kind], [demoArgs(s.kind, demo)]);
        if (res.ok) ok += 1;
        else fail += 1;
      }
      const total = ok + fail;
      if (total === 0) {
        toast.info(t('labs.scriptSelfCheckNone'));
      } else if (fail === 0) {
        toast.success(t('labs.scriptSelfCheckOk', { ok: total, total }));
      } else {
        toast.error(t('labs.scriptSelfCheckFail', { ok, total, fail }));
      }
    } finally {
      setChecking(false);
    }
  };

  /**
   * 各方向的脚本（按方向分组渲染）。
   */
  const groups = useMemo(
    () => KINDS.map((k) => {
      const list = scripts.filter((s) => s.kind === k.kind);
      const active = list.filter((s) => s.enabled);
      return { ...k, list, active };
    }),
    [scripts],
  );

  return (
    <div className="card-surface p-5">
      {/* 头部：标题 + ⓘ 说明 + 自检 */}
      <div className="mb-1 flex items-center gap-2">
        <Braces size={15} className="text-accent" />
        <span className="text-sm font-semibold text-ink">
          <InfoTip label={t('labs.scripts')} text={t('labs.scriptsDesc')} />
        </span>
        <button
          onClick={() => void selfCheck()}
          disabled={checking}
          className="ml-auto flex items-center gap-1.5 rounded-full bg-surface-hi px-3 py-1 text-[11px] font-medium text-ink-2 transition-colors hover:bg-surface disabled:opacity-50"
        >
          <Play size={11} className={checking ? 'animate-pulse' : ''} />
          {t('labs.scriptSelfCheck')}
        </button>
      </div>

      {/* 四个方向：小标签 + 胶囊（常驻展开） */}
      {groups.map((g) => (
        <div key={g.kind} className="mt-3 first:mt-2">
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-ink-2">
            <g.icon size={11} />
            {t(g.labelKey)}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {g.list.map((s) => (
              <ScriptChip
                key={s.id}
                script={s}
                onToggle={() => void onToggle(s)}
                onDetail={() => void openDetail(s)}
              />
            ))}
            {g.list.length === 0 && (
              <p className="py-1 text-[11px] text-ink-2">{t('labs.scriptNoScripts')}</p>
            )}
          </div>
        </div>
      ))}

      {/* 工具行 */}
      <div className="mt-1 flex items-center gap-3 border-t border-black/[0.04] pt-3">
        <button
          onClick={() => setDraft({ id: null, name: '', code: TEMPLATE.advice, kind: 'advice' })}
          className="flex items-center gap-1.5 text-xs font-medium text-accent transition-opacity hover:opacity-70"
        >
          <FilePlus2 size={13} />
          {t('labs.scriptNew')}
        </button>
        <button onClick={doImport} className="flex items-center gap-1.5 text-xs font-medium text-accent transition-opacity hover:opacity-70">
          <Upload size={13} />
          {t('labs.scriptImport')}
        </button>
        <button onClick={doExport} className="flex items-center gap-1.5 text-xs font-medium text-accent transition-opacity hover:opacity-70">
          <Download size={13} />
          {t('labs.scriptExport')}
        </button>
        <span className="ml-auto flex items-center gap-2 text-[10px] text-ink-2">
          <span>{t('labs.scriptLongPressHint')}</span>
          <span className="tabular-nums">{t('labs.scriptCount', { n: scripts.length })}</span>
        </span>
      </div>

      {/* 编辑器 */}
      {draft && (
        <div className="mt-3 flex flex-col gap-2 rounded-2xl border border-black/10 bg-surface-hi p-3">
          <div className="flex items-center gap-2">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder={t('labs.scriptNamePlaceholder')}
              className="min-w-0 flex-1 rounded-xl border border-black/10 bg-card px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
            <Select value={draft.kind} onValueChange={(v) => setDraft({ ...draft, kind: v as ScriptKind })}>
              <SelectTrigger className="h-8 w-28 rounded-xl border border-black/10 bg-card text-xs font-medium text-ink outline-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="rounded-2xl border-0 bg-card shadow-lg">
                {KINDS.map((k) => (
                  <SelectItem key={k.kind} value={k.kind}>
                    {t(k.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <textarea
            value={draft.code}
            onChange={(e) => setDraft({ ...draft, code: e.target.value })}
            spellCheck={false}
            rows={14}
            className="w-full resize-y rounded-xl border border-black/10 bg-card p-3 font-mono text-xs leading-relaxed text-ink outline-none focus:border-accent"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={() => void saveDraft()}
              className="rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-white transition-transform active:scale-95"
            >
              {t('common.save')}
            </button>
            <button
              onClick={() => void testRun(draft.code, draft.kind)}
              disabled={testing}
              className="flex items-center gap-1.5 text-xs font-medium text-accent transition-opacity hover:opacity-70 disabled:opacity-40"
            >
              <Play size={12} />
              {t('labs.scriptTest')}
            </button>
            <button
              onClick={() => setDraft(null)}
              className="ml-auto text-xs font-medium text-ink-2 transition-opacity hover:opacity-70"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* 长按详情窗：简介 + 源码 + 试跑预览 */}
      {detail && (
        <div
          className="fixed inset-0 z-[80] grid place-items-center bg-black/30 px-6 backdrop-blur-sm"
          onClick={() => setDetail(null)}
        >
          <div
            className="card-surface relative flex max-h-[82dvh] w-full max-w-md flex-col overflow-y-auto p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setDetail(null)}
              aria-label={t('common.close')}
              className="absolute right-3 top-3 grid size-8 place-items-center rounded-full text-ink-2 hover:bg-surface-hi"
            >
              <X size={15} />
            </button>

            <p className="max-w-[80%] truncate text-sm font-semibold text-ink">{detail.script.name}</p>
            <div className="mb-3 mt-1 flex flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-surface-hi px-1.5 py-px text-[9.5px] text-ink-2">
                {t(kindLabelKey(detail.script.kind))}
              </span>
              <span className="rounded-full bg-surface-hi px-1.5 py-px text-[9.5px] text-ink-2">
                {detail.script.builtin ? t('labs.scriptBuiltin') : t('labs.scriptUser')}
              </span>
              {detail.script.enabled && (
                <span className="rounded-full bg-accent px-1.5 py-px text-[9.5px] font-medium text-on-accent">
                  {t('labs.scriptDetailOn')}
                </span>
              )}
            </div>

            {/* 简介 */}
            {detail.script.description && (
              <>
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-ink-2">
                  {t('labs.scriptDetailDesc')}
                </p>
                <p className="mb-3 text-[11.5px] leading-relaxed text-ink">{detail.script.description}</p>
              </>
            )}

            {/* 源码 */}
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-ink-2">
              {t('labs.scriptDetailSource')}
            </p>
            <pre className="mb-3 max-h-52 w-full overflow-auto rounded-xl bg-surface-hi p-3 font-mono text-[10px] leading-relaxed text-ink-2">
              {detail.script.code}
            </pre>

            {/* 试跑预览 */}
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-ink-2">
              {t('labs.scriptDetailPreview')}
            </p>
            {detail.status === 'loading' && <p className="py-4 text-xs text-ink-2">…</p>}
            {detail.status === 'error' && (
              <p className="py-2 text-[11px] leading-relaxed text-[#B0532F]">
                {t('labs.scriptTestFail')}{detail.error ? `：${detail.error}` : ''}
              </p>
            )}
            {detail.status === 'ok' && detail.script.kind === 'advice' && (
              (detail.advice?.length ?? 0) > 0 ? (
                <ul className="space-y-1">
                  {detail.advice!.map((a, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-2">
                      <span className="mt-[6px] size-1 shrink-0 rounded-full bg-accent/70" />{a}
                    </li>
                  ))}
                </ul>
              ) : <p className="py-3 text-xs text-ink-2">{t('labs.previewEmpty')}</p>
            )}
            {detail.status === 'ok' && detail.script.kind === 'card' && (
              detail.cardUrl
                ? <img src={detail.cardUrl} alt={t('labs.scriptDetailPreview')} className="w-full rounded-xl" />
                : <p className="py-3 text-xs text-ink-2">{t('labs.previewEmpty')}</p>
            )}
            {detail.status === 'ok' && detail.script.kind === 'flower' && (
              detail.flower
                ? <FlowerSvg flower={detail.flower} rotation={0} className="mx-auto h-40 w-40" />
                : <p className="py-3 text-xs text-ink-2">{t('labs.previewEmpty')}</p>
            )}
            {detail.status === 'ok' && detail.script.kind === 'export' && (
              detail.exportContent
                ? (
                  <>
                    <p className="mb-1 text-[10px] text-ink-2">{detail.exportName}</p>
                    <pre className="max-h-40 w-full overflow-auto rounded-xl bg-surface-hi p-3 font-mono text-[10px] leading-relaxed text-ink-2">
                      {detail.exportContent}
                    </pre>
                  </>
                )
                : <p className="py-3 text-xs text-ink-2">{t('labs.previewEmpty')}</p>
            )}

            {/* 用户脚本：编辑 / 删除 */}
            {!detail.script.builtin && (
              <div className="mt-4 flex items-center gap-2 border-t border-black/[0.06] pt-3">
                <button
                  onClick={() => {
                    const s = detail.script;
                    setDraft({ id: s.id, name: s.name, code: s.code, kind: s.kind });
                    setDetail(null);
                  }}
                  className="flex items-center gap-1.5 rounded-full bg-surface-hi px-3 py-1.5 text-[11px] font-medium text-ink transition-colors hover:bg-surface"
                >
                  <Pencil size={12} />
                  {t('labs.scriptEdit')}
                </button>
                <button
                  onClick={() => {
                    const s = detail.script;
                    if (confirm(t('labs.scriptDeleteConfirm', { name: s.name }))) {
                      void deleteUserScript(s.id).then(() => {
                        toast.success(t('labs.scriptDeleteDone'));
                        setDetail(null);
                        reload();
                      });
                    }
                  }}
                  className="flex items-center gap-1.5 rounded-full bg-surface-hi px-3 py-1.5 text-[11px] font-medium text-[#B0532F] transition-colors hover:bg-surface"
                >
                  <Trash2 size={12} />
                  {t('labs.scriptDelete')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** 长按触发阈值（ms） */
const LONG_PRESS_MS = 450;
/** 手指移动超过该距离视为滚动，取消长按 */
const LONG_PRESS_SLOP = 8;

/**
 * 脚本胶囊（与 AI 助手页的快捷提问同款）
 * - 点一下：切换启用态，启用时填充主题强调色；
 * - 长按 / 右键：打开详情窗（简介 / 源码 / 预览）。
 */
function ScriptChip({
  script,
  onToggle,
  onDetail,
}: {
  script: LuaScriptView;
  onToggle: () => void;
  onDetail: () => void;
}) {
  const timer = useRef<number | null>(null);
  /** 最近一次长按触发的时间（用时间戳而非布尔标志：松手时若浏览器没补发 click，
   *  布尔标志会残留，把之后一次正常点击吞掉） */
  const longPressAt = useRef(0);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
  };

  const start = (e: React.PointerEvent) => {
    clear();
    origin.current = { x: e.clientX, y: e.clientY };
    timer.current = window.setTimeout(() => {
      timer.current = null;
      longPressAt.current = Date.now();
      onDetail();
    }, LONG_PRESS_MS);
  };

  /** 移动超出容差 → 当作滚动，取消长按 */
  const move = (e: React.PointerEvent) => {
    const o = origin.current;
    if (!o) return;
    if (Math.abs(e.clientX - o.x) > LONG_PRESS_SLOP || Math.abs(e.clientY - o.y) > LONG_PRESS_SLOP) {
      clear();
    }
  };

  useEffect(() => () => clear(), []);

  return (
    <button
      type="button"
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={clear}
      onPointerLeave={clear}
      onPointerCancel={clear}
      onClick={() => {
        // 长按刚触发过详情：这次收尾的 click 不再切换启用态
        if (Date.now() - longPressAt.current < 700) return;
        onToggle();
      }}
      onContextMenu={(e) => { e.preventDefault(); onDetail(); }}
      className={cn(
        'max-w-full select-none rounded-full border px-3 py-1.5 text-[11px] font-medium',
        'transition-colors active:scale-[0.98]',
        script.enabled
          ? 'border-accent bg-accent text-on-accent'
          : 'border-line/70 bg-ink/[0.04] text-ink-2 hover:border-line hover:bg-ink/[0.07] hover:text-ink',
      )}
      title={script.description || script.name}
    >
      <span className="flex items-center gap-1.5">
        {!script.builtin && (
          <span
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              script.enabled ? 'bg-on-accent/80' : 'bg-accent/60',
            )}
          />
        )}
        <span className="truncate">{script.name}</span>
      </span>
    </button>
  );
}
