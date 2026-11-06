/**
 * 脚本中心（实验性功能子区块）
 * 管理 Lua 脚本：内置脚本（可停用）/ 用户脚本（增删改、导入导出 JSON 分享），
 * 每条可试运行（拿 demo 数据喂对应全局函数）验证脚本正确性。
 *
 * 生效规则（同一方向多个脚本怎么办）：
 *   - advice（建议）：可同时启用多个，运行时逐脚本执行后合并（每脚本至多 3 条、总计至多 3 条）；
 *   - card / flower / export（分享卡 / 声之花 / 导出桥）：单一消费方，同一方向同一时间只允许
 *     一个脚本生效——启用新脚本会自动停用该方向的其他脚本，界面标注「生效中」，避免「启用了却没跑」。
 */

import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Braces, Check, Download, Eye, FileDown, FilePlus2, Flower2, Image, Lightbulb,
  Pencil, Play, Trash2, Upload, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import {
  deleteUserScript, exportScripts, importAny, inferScriptKind, isSingleKind, listScripts,
  putUserScript, setScriptEnabled, type LuaScriptView, type ScriptKind,
} from '@/lib/lua/scripts';
import { runLuaFn } from '@/lib/lua/engine';
import { normalizeOps } from '@/lib/lua/card';
import { renderCardOps } from '@/lib/lua/cardRender';
import { normalizeFlower } from '@/lib/lua/flower';
import { recordView } from '@/lib/lua/filter';
import { createDemoRecord } from '@/lib/audio/demo';
import { FlowerSvg } from '@/components/flowers/FlowerSvg';
import type { Flower } from '@/lib/flower';
import type { AdviceTarget } from '@/lib/advice';
import type { AnalysisRecord, VoiceStats } from '@/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '../ui';
import { cn } from '@/lib/utils';

/** 方向元数据：图标 / 本地化标签 / 生效规则提示 */
const KINDS: {
  kind: ScriptKind;
  icon: LucideIcon;
  labelKey: 'labs.scriptKindAdvice' | 'labs.scriptKindCard' | 'labs.scriptKindFlower' | 'labs.scriptKindExport';
  hintKey: 'labs.scriptMultiTip' | 'labs.scriptSingleTip';
}[] = [
  { kind: 'advice', icon: Lightbulb, labelKey: 'labs.scriptKindAdvice', hintKey: 'labs.scriptMultiTip' },
  { kind: 'card', icon: Image, labelKey: 'labs.scriptKindCard', hintKey: 'labs.scriptSingleTip' },
  { kind: 'flower', icon: Flower2, labelKey: 'labs.scriptKindFlower', hintKey: 'labs.scriptSingleTip' },
  { kind: 'export', icon: FileDown, labelKey: 'labs.scriptKindExport', hintKey: 'labs.scriptSingleTip' },
];

/** 方向本地化标签键 */
const KIND_LABEL_KEY: Record<ScriptKind, 'labs.scriptKindAdvice' | 'labs.scriptKindCard' | 'labs.scriptKindFlower' | 'labs.scriptKindExport'> = {
  advice: 'labs.scriptKindAdvice',
  card: 'labs.scriptKindCard',
  flower: 'labs.scriptKindFlower',
  export: 'labs.scriptKindExport',
};

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

/** 试跑预览状态（按脚本种类承载不同产物） */
interface PreviewState {
  name: string;
  kind: ScriptKind;
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
  const [preview, setPreview] = useState<PreviewState | null>(null);
  /** 方向筛选：全部 / 单一方向 */
  const [filter, setFilter] = useState<'all' | ScriptKind>('all');

  const reload = () => void listScripts().then(setScripts);
  useEffect(reload, []);

  /** 开启脚本：单一方向自动停用同方向其他脚本，并在 UI 明确告知 */
  const onToggle = async (s: LuaScriptView) => {
    const res = await setScriptEnabled(s.id, !s.enabled);
    if (res.displaced.length > 0) {
      toast.info(t('labs.scriptDisplaced', { name: res.displaced.join('、') }));
    }
    reload();
  };

  /** 试跑预览：用示例数据跑一遍脚本并把产物渲染出来（点击才跑，不自动全跑） */
  const runPreview = async (script: LuaScriptView) => {
    const base = { name: script.name, kind: script.kind };
    setPreview({ ...base, status: 'loading' });
    const demo = demoOf();
    try {
      if (script.kind === 'advice') {
        const res = await runLuaFn<unknown>(script.code, 'advise', [demoArgs(script.kind, demo)]);
        if (!res.ok) { setPreview({ ...base, status: 'error', error: res.error }); return; }
        const list = Array.isArray(res.value) ? res.value.map((x) => String(x)) : [];
        setPreview({ ...base, status: 'ok', advice: list });
        return;
      }
      if (script.kind === 'card') {
        const res = await runLuaFn<unknown>(script.code, 'template', [demoArgs(script.kind, demo)]);
        if (!res.ok) { setPreview({ ...base, status: 'error', error: res.error }); return; }
        const ops = normalizeOps(res.value);
        const canvas = ops.length > 0 ? renderCardOps(ops, demo) : null;
        setPreview({ ...base, status: 'ok', cardUrl: canvas?.toDataURL('image/png') });
        return;
      }
      if (script.kind === 'flower') {
        const res = await runLuaFn<unknown>(script.code, 'flower', [demoArgs(script.kind, demo)]);
        if (!res.ok) { setPreview({ ...base, status: 'error', error: res.error }); return; }
        setPreview({ ...base, status: 'ok', flower: normalizeFlower(res.value, { petalsFrom: 'template', facts: [] }) });
        return;
      }
      // export：喂样例记录视图（含 series.frames）
      const res = await runLuaFn<unknown>(script.code, 'export', [demoArgs(script.kind, demo)]);
      if (!res.ok) { setPreview({ ...base, status: 'error', error: res.error }); return; }
      const value = res.value;
      if (!value || typeof value !== 'object') {
        setPreview({ ...base, status: 'ok' });
        return;
      }
      const o = value as { filename?: unknown; content?: unknown };
      if (typeof o.content !== 'string' || !o.content) {
        setPreview({ ...base, status: 'ok' });
        return;
      }
      setPreview({
        ...base,
        status: 'ok',
        exportName: typeof o.filename === 'string' ? o.filename : 'export',
        exportContent: o.content.slice(0, 4000),
      });
    } catch (err) {
      setPreview({ ...base, status: 'error', error: String(err) });
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
      // export：校验产出 { filename, content }
      const res = await runLuaFn<unknown>(code, 'export', [demoArgs(kind, demo)]);
      const value = res.ok ? (res.value as { content?: unknown; filename?: unknown }) : null;
      if (value && typeof value.content === 'string' && value.content) {
        toast.success(t('labs.scriptTestOkExport', { n: value.content.length }));
      } else {
        toast.error(`${t('labs.scriptTestFail')}${res.ok ? '' : `：${res.error}`}`);
      }
    } finally {
      setTesting(false);
    }
  };

  /** 保存草稿：新建的单一方向脚本自动生效（停用同方向旧脚本） */
  const saveDraft = async () => {
    if (!draft) return;
    const name = draft.name.trim() || t('labs.scriptUntitled');
    const isNew = draft.id === null;
    const id = draft.id ?? `lua-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // 编辑现有脚本：若方向改到单一消费方，保存即生效（停用同方向旧脚本）
    const prev = isNew ? undefined : scripts.find((s) => s.id === id);
    const kindChanged = !prev || prev.kind !== draft.kind;
    await putUserScript({ id, name, kind: draft.kind, code: draft.code, createdAt: 0, updatedAt: 0 });
    if (isSingleKind(draft.kind) && (isNew || kindChanged)) {
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
              ? t('labs.scriptImportedKind', { n, kind: t(KIND_LABEL_KEY[kind]) })
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

  return (
    <div className="card-surface p-5">
      {/* 头部 */}
      <div className="mb-1 flex items-center gap-2">
        <Braces size={15} className="text-accent" />
        <p className="text-sm font-semibold text-ink">{t('labs.scripts')}</p>
        <button
          onClick={() => void selfCheck()}
          disabled={checking}
          className="ml-auto flex items-center gap-1.5 rounded-full bg-surface-hi px-3 py-1 text-[11px] font-medium text-ink-2 transition-colors hover:bg-surface disabled:opacity-50"
        >
          <Play size={11} className={checking ? 'animate-pulse' : ''} />
          {t('labs.scriptSelfCheck')}
        </button>
      </div>
      <p className="mb-3 px-0.5 text-[11px] leading-relaxed text-ink-2">{t('labs.scriptsDesc')}</p>

      {/* 方向筛选 */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        <button
          onClick={() => setFilter('all')}
          className={cn(
            'rounded-full px-3 py-1 text-xs font-medium transition-colors',
            filter === 'all' ? 'bg-accent text-white' : 'bg-surface text-ink-2 hover:bg-surface-hi',
          )}
        >
          {t('labs.scriptKindAll')}
        </button>
        {KINDS.map((k) => (
          <button
            key={k.kind}
            onClick={() => setFilter(k.kind)}
            className={cn(
              'flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors',
              filter === k.kind ? 'bg-accent text-white' : 'bg-surface text-ink-2 hover:bg-surface-hi',
            )}
          >
            <k.icon size={12} />
            {t(k.labelKey)}
          </button>
        ))}
      </div>

      {/* 按方向分组的脚本列表 */}
      {KINDS.map((k) => {
        const list = scripts.filter((s) => s.kind === k.kind);
        const active = list.filter((s) => s.enabled).length;
        const show = filter === 'all' || filter === k.kind;
        if (!show) return null;
        return (
          <div key={k.kind} className="mb-5 last:mb-0">
            <div className="mb-2 flex items-center gap-2">
              <k.icon size={14} className="text-accent" />
              <p className="text-sm font-semibold text-ink">{t(k.labelKey)}</p>
              <span className="text-[10px] text-ink-2">{t(k.hintKey)}</span>
              <span className="ml-auto rounded-full bg-surface-hi px-2 py-0.5 text-[10px] tabular-nums text-ink-2">
                {active}/{list.length}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {list.map((s) => {
                const isActive = isSingleKind(s.kind) && s.enabled;
                return (
                  <div
                    key={s.id}
                    className={cn(
                      'rounded-2xl border p-3 transition-colors',
                      isActive ? 'border-accent/40 bg-accent-soft/30' : 'border-black/10 bg-surface/50',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <k.icon size={15} className="shrink-0 text-ink-2" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-ink">{s.name}</span>
                          <span className={cn(
                            'shrink-0 rounded-full px-1.5 py-0.5 text-[10px]',
                            s.builtin ? 'bg-surface-hi text-ink-2' : 'bg-accent-soft text-on-accent-soft',
                          )}>
                            {s.builtin ? t('labs.scriptBuiltin') : t('labs.scriptUser')}
                          </span>
                          {isActive && (
                            <span className="flex shrink-0 items-center gap-1 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                              <Check size={9} />
                              {t('labs.scriptActive')}
                            </span>
                          )}
                          {!isActive && s.enabled && (
                            <span className="shrink-0 rounded-full bg-surface-hi px-1.5 py-0.5 text-[10px] text-ink-2">
                              {t('labs.scriptEnabled')}
                            </span>
                          )}
                        </div>
                        {s.description && (
                          <p className="mt-0.5 truncate text-[11px] text-ink-2">{s.description}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => void runPreview(s)}
                          aria-label={t('labs.preview')}
                          title={t('labs.preview')}
                          className="grid size-7 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-black/5 hover:text-accent"
                        >
                          <Eye size={13} />
                        </button>
                        {!s.builtin && (
                          <>
                            <button
                              onClick={() => setDraft({ id: s.id, name: s.name, code: s.code, kind: s.kind })}
                              aria-label={t('labs.scriptEdit')}
                              className="grid size-7 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-black/5 hover:text-accent"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => {
                                if (confirm(t('labs.scriptDeleteConfirm', { name: s.name }))) {
                                  void deleteUserScript(s.id).then(() => {
                                    toast.success(t('labs.scriptDeleteDone'));
                                    reload();
                                  });
                                }
                              }}
                              aria-label={t('labs.scriptDelete')}
                              className="grid size-7 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-black/5 hover:text-[#D66E5B]"
                            >
                              <Trash2 size={13} />
                            </button>
                          </>
                        )}
                        <Switch checked={s.enabled} onCheckedChange={() => void onToggle(s)} />
                      </div>
                    </div>
                  </div>
                );
              })}
              {list.length === 0 && (
                <p className="rounded-2xl border border-dashed border-black/10 px-3 py-4 text-center text-[11px] text-ink-2">
                  {t('labs.scriptNoScripts')}
                </p>
              )}
            </div>
          </div>
        );
      })}

      {/* 工具行 */}
      <div className="mt-2 flex items-center gap-3 border-t border-black/5 pt-3">
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
        <span className="ml-auto text-[10px] text-ink-2">
          {t('labs.scriptCount', { n: scripts.length })}
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

      {/* 试跑预览（点击才跑，不自动全跑）：按脚本种类渲染不同产物 */}
      {preview && (
        <div
          className="fixed inset-0 z-[80] grid place-items-center bg-black/30 px-6 backdrop-blur-sm"
          onClick={() => setPreview(null)}
        >
          <div
            className="card-surface relative flex max-h-[80dvh] w-full max-w-sm flex-col items-center overflow-y-auto p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setPreview(null)}
              aria-label={t('common.close')}
              className="absolute right-3 top-3 grid size-8 place-items-center rounded-full text-ink-2 hover:bg-surface-hi"
            >
              <X size={15} />
            </button>
            <p className="max-w-[80%] truncate text-sm font-semibold text-ink">{preview.name}</p>
            <p className="mb-2 text-[10px] text-ink-2">
              {KINDS.find((k) => k.kind === preview.kind)?.labelKey && t(KINDS.find((k) => k.kind === preview.kind)!.labelKey)}
            </p>

            {preview.status === 'loading' && <p className="py-6 text-xs text-ink-2">…</p>}

            {preview.status === 'error' && (
              <p className="py-3 text-center text-[11px] leading-relaxed text-[#B0532F]">
                {t('labs.scriptTestFail')}{preview.error ? `：${preview.error}` : ''}
              </p>
            )}

            {preview.status === 'ok' && preview.kind === 'advice' && (
              (preview.advice?.length ?? 0) > 0 ? (
                <ul className="w-full space-y-1">
                  {preview.advice!.map((a, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-2">
                      <span className="mt-[6px] size-1 shrink-0 rounded-full bg-accent/70" />{a}
                    </li>
                  ))}
                </ul>
              ) : <p className="py-6 text-xs text-ink-2">{t('labs.previewEmpty')}</p>
            )}

            {preview.status === 'ok' && preview.kind === 'card' && (
              preview.cardUrl
                ? <img src={preview.cardUrl} alt={t('labs.preview')} className="w-full rounded-xl" />
                : <p className="py-6 text-xs text-ink-2">{t('labs.previewEmpty')}</p>
            )}

            {preview.status === 'ok' && preview.kind === 'flower' && (
              preview.flower
                ? <FlowerSvg flower={preview.flower} rotation={0} className="h-44 w-44" />
                : <p className="py-6 text-xs text-ink-2">{t('labs.previewEmpty')}</p>
            )}

            {preview.status === 'ok' && preview.kind === 'export' && (
              preview.exportContent
                ? (
                  <>
                    <p className="mb-1 text-[10px] text-ink-2">{preview.exportName}</p>
                    <pre className="w-full max-h-56 overflow-auto rounded-xl bg-card p-3 font-mono text-[10px] leading-relaxed text-ink-2">
                      {preview.exportContent}
                    </pre>
                  </>
                )
                : <p className="py-6 text-xs text-ink-2">{t('labs.previewEmpty')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
