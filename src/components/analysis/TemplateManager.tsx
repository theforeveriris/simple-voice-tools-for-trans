/**
 * 导出模板管理器（分析页导出弹窗内的折叠区）
 * 新建/编辑/删除模板、导入 .svt-template 分享文件、试预览（示例数据）、
 * 以及「用此模板导出当前记录」。模板语法见 lib/export/template.ts。
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, Download, Eye, FilePlus2, Pencil, Play, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { renderTemplate, type ExportTemplate } from '@/lib/export/template';
import { APP_ID } from '@/lib/appId';
import {
  deleteTemplate, importTemplate, listTemplates, putTemplate,
} from '@/lib/export/templateStore';
import { downloadText } from '@/lib/export/csv';
import type { AnalysisRecord } from '@/types';
import { cn } from '@/lib/utils';

/** 预览用的示例记录（与脚本中心 DEMO_STATS 同风格） */
function demoRecord(): AnalysisRecord {
  return {
    id: 'demo12345678',
    createdAt: 1735689600000,
    durationSec: 12.4,
    sampleHz: 30,
    series: { t: [], f0: [], rmsDb: [], f1: [], f2: [] },
    stats: {
      durationSec: 12.4, sampleHz: 30, totalSamples: 372, voicedSamples: 301,
      avgF0: 172.3, medianF0: 168, minF0: 118, maxF0: 245, p10F0: 142, p90F0: 208, stdF0: 18.2,
      malePct: 8.4, femalePct: 64.2, transitionPct: 27.4,
      avgF1: 610, avgF2: 1890, f1Range: [480, 760], f2Range: [1500, 2400],
      avgDb: -28.6, peakDb: -11.4,
      jitterPct: 0.86, shimmerPct: 4.1, hnrDb: 18.5, cppsDb: 14.2, inTargetPct: 78.6,
    },
    mode: 'reading',
    note: '',
  };
}

interface Draft {
  /** 编辑前的原名（重命名时用于覆盖旧条目）；null = 新建 */
  origName: string | null;
  name: string;
  body: string;
}

export function TemplateManager({ record, onDone }: { record: AnalysisRecord | null; onDone?: () => void }) {
  useI18n();
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<ExportTemplate[]>(() => listTemplates());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const reload = () => setTemplates(listTemplates());

  const saveDraft = () => {
    if (!draft) return;
    const name = draft.name.trim() || 'template';
    // 重命名时清掉旧名条目
    if (draft.origName && draft.origName !== name) deleteTemplate(draft.origName);
    putTemplate({ name, template: draft.body });
    toast.success(t('template.saved'));
    setDraft(null);
    reload();
  };

  const tryPreview = (body: string) => {
    const out = renderTemplate({ name: 'preview', template: body }, record ?? demoRecord());
    setPreview(out ?? '');
  };

  const doImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.svt-template,.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const tpl = importTemplate(await file.text());
      if (tpl) {
        toast.success(t('template.imported', { name: tpl.name }));
        reload();
      } else {
        toast.error(t('template.importFail'));
      }
    };
    input.click();
  };

  const doExportFile = (tpl: ExportTemplate) => {
    downloadText(`${tpl.name}.svt-template.json`, JSON.stringify({
      app: APP_ID, kind: 'template', version: 1, name: tpl.name, template: tpl.template,
    }, null, 2));
    toast.success(t('template.exported'));
  };

  const applyToRecord = (tpl: ExportTemplate) => {
    if (!record) {
      toast.info(t('template.needRecord'));
      return;
    }
    const out = renderTemplate(tpl, record);
    if (out == null) {
      toast.error(t('template.importFail'));
      return;
    }
    downloadText(`${tpl.name}-${record.id.slice(0, 8)}.txt`, out);
    toast.success(t('toast.templateExported'));
    onDone?.();
  };

  return (
    <div className="rounded-2xl border border-black/10 bg-surface/50">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={15} className="text-ink-2" /> : <ChevronRight size={15} className="text-ink-2" />}
        <span className="flex-1 text-sm font-medium text-ink">{t('template.title')}</span>
        {templates.length > 0 && (
          <span className="rounded-full bg-surface-hi px-2 py-0.5 text-[10px] text-ink-2">{templates.length}</span>
        )}
      </button>
      {open && (
        <div className="flex flex-col gap-2 px-4 pb-3">
          <p className="text-xs leading-relaxed text-ink-2">{t('template.desc')}</p>
          <p className="text-[11px] leading-relaxed text-ink-2/80">{t('template.fieldsHint')}</p>

          {templates.length === 0 && !draft && (
            <p className="rounded-xl bg-surface px-3 py-2 text-xs text-ink-2">{t('template.empty')}</p>
          )}

          {templates.map((tpl) => (
            <div key={tpl.name} className="flex items-center gap-1.5 rounded-xl bg-surface px-2.5 py-2">
              <span className="min-w-0 flex-1 truncate text-xs text-ink">{tpl.name}</span>
              <button
                onClick={() => applyToRecord(tpl)}
                aria-label={t('template.apply')}
                title={t('template.apply')}
                className="grid size-7 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-black/5 hover:text-accent"
              >
                <Play size={13} />
              </button>
              <button
                onClick={() => tryPreview(tpl.template)}
                aria-label={t('template.previewTitle')}
                title={t('template.previewTitle')}
                className="grid size-7 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-black/5 hover:text-accent"
              >
                <Eye size={13} />
              </button>
              <button
                onClick={() => setDraft({ origName: tpl.name, name: tpl.name, body: tpl.template })}
                aria-label={t('common.edit')}
                className="grid size-7 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-black/5 hover:text-accent"
              >
                <Pencil size={13} />
              </button>
              <button
                onClick={() => doExportFile(tpl)}
                aria-label={t('common.export')}
                className="grid size-7 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-black/5 hover:text-accent"
              >
                <Download size={13} />
              </button>
              <button
                onClick={() => {
                  if (confirm(t('template.deleteConfirm', { name: tpl.name }))) {
                    deleteTemplate(tpl.name);
                    toast.success(t('template.deleted'));
                    reload();
                  }
                }}
                aria-label={t('common.delete')}
                className="grid size-7 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-black/5 hover:text-[#D66E5B]"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}

          {preview != null && (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-xl bg-surface px-3 py-2 font-mono text-[11px] leading-relaxed text-ink">
              {preview || '—'}
            </pre>
          )}

          {draft && (
            <div className="flex flex-col gap-2 rounded-2xl border border-black/10 bg-surface-hi p-3">
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder={t('template.namePlaceholder')}
                className="rounded-xl border border-black/10 bg-card px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              />
              <textarea
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                spellCheck={false}
                rows={8}
                placeholder={t('template.bodyPlaceholder')}
                className="w-full resize-y rounded-xl border border-black/10 bg-card p-3 font-mono text-xs leading-relaxed text-ink outline-none focus:border-accent"
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={saveDraft}
                  className="rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-white transition-transform active:scale-95"
                >
                  {t('common.save')}
                </button>
                <button
                  onClick={() => tryPreview(draft.body)}
                  className="flex items-center gap-1.5 text-xs font-medium text-accent transition-opacity hover:opacity-70"
                >
                  <Eye size={12} />
                  {t('template.previewTitle')}
                </button>
                <button
                  onClick={() => { setDraft(null); setPreview(null); }}
                  className="ml-auto text-xs font-medium text-ink-2 transition-opacity hover:opacity-70"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          )}

          {!draft && (
            <div className="flex items-center gap-3 px-0.5">
              <button
                onClick={() => setDraft({ origName: null, name: '', body: '' })}
                className="flex items-center gap-1.5 text-xs font-medium text-accent transition-opacity hover:opacity-70"
              >
                <FilePlus2 size={13} />
                {t('common.new')}
              </button>
              <button
                onClick={doImport}
                className={cn('flex items-center gap-1.5 text-xs font-medium text-accent transition-opacity hover:opacity-70')}
              >
                <Upload size={13} />
                {t('common.import')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
