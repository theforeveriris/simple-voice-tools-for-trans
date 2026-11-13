/**
 * 语言（设置的子页面）
 * - 界面语言：内置语言（zh-CN / zh-TW / en / ja / 文言）+ AI 翻译语言（已生成时）
 * - AI 翻译（实验性）：用 实验性功能 → 大模型配置 的接口把基准词典翻译成
 *   任意目标语言；支持增量补全缺失词条、术语表、编辑词条、词典分享。
 *   未覆盖词条回退简体中文，自定义词条（编辑词条）优先级最高。
 */

import { useRef, useState, useSyncExternalStore } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft, ChevronDown, Download, Languages, Loader2, Pencil, Trash2, Sparkles, Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { LOCALES, localeRemark, localeTag, t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import {
  loadAiCache, clearAiCache, hydrateAiLocale,
  missingKeys, cacheCoverage, buildAiLocalePayload, parseAiLocalePayload, importAiCache,
} from '@/i18n/aiLocale';
import { subscribeAITask, getAITaskState, startAITask, cancelAITask } from '@/i18n/aiTranslateTask';
import { downloadBlob } from '@/lib/file';
import type { AppSettings, Locale } from '@/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '@/components/ui';
import { SettingsSection, SettingRow, SELECT_TRIGGER_CLASS } from './rows';
import { InfoTip } from './InfoTip';
import { EditStringsSheet } from './EditStringsSheet';
import { cn } from '@/lib/utils';
import { MOTION } from '@/lib/motion';

export function LanguagePage({
  settings,
  update,
  onBack,
}: {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  /** 返回设置主视图（languageOpen 由父组件持有，不持久化） */
  onBack: () => void;
}) {
  useI18n();
  const [draft, setDraft] = useState(settings.aiLanguage ?? '');
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  // 翻译任务在模块级运行（后台不中断），这里经 useSyncExternalStore 订阅其状态
  const task = useSyncExternalStore(subscribeAITask, getAITaskState);
  const busy = task.status === 'running';
  const pct = task.progress ? Math.round(task.progress.frac * 100) : 0;

  const aiEnabled = settings.aiTranslateEnabled;
  const cache = settings.aiLanguage ? loadAiCache(settings.aiLanguage) : null;
  const aiItemVisible = aiEnabled && cache != null;
  // 覆盖率与缺失词条数（缓存存在时；渲染期读取，生成/导入后经重渲染自动刷新）
  const coverage = settings.aiLanguage ? cacheCoverage(settings.aiLanguage) : null;
  const missing = settings.aiLanguage ? missingKeys(settings.aiLanguage).length : 0;

  /** 切换语言（AI 项需先确保词典已注册） */
  const setLanguage = (v: Locale) => {
    if (v === 'ai') {
      const c = settings.aiLanguage ? loadAiCache(settings.aiLanguage) : null;
      if (!c) {
        toast.error(t('toast.aiCacheMissing'));
        return;
      }
      // registerAiDict 幂等；词典就绪后切语言（useI18n 随 settings 变化同步 locale）
      hydrateAiLocale(c.label);
      update({ language: 'ai' });
      return;
    }
    update({ language: v });
  };

  /** 生成（全量）/ 补全（仅缺失词条）：交给后台任务管理器，换页不中断 */
  const onGenerate = async (missingOnly: boolean) => {
    if (busy) return;
    const label = draft.trim();
    if (!label) return;
    const result = await startAITask(label, missingOnly);
    // no-config 已由任务自身提示（缺大模型配置），此处只在「真的有任务在跑」时提示
    if (result === 'busy') {
      toast.info(t('toast.aiTaskBusy'));
      return;
    }
    if (result !== 'started') return;
    setDraft(label);
  };

  /** 清除 AI 语言缓存（当前正在使用时回退默认英文） */
  const onClear = () => {
    if (!settings.aiLanguage) return;
    clearAiCache(settings.aiLanguage);
    if (settings.language === 'ai') update({ language: 'en' });
    update({ aiLanguage: undefined });
    toast.success(t('toast.aiCleared'));
  };

  /** 导出当前 AI 词典为 JSON（分享 / 备份） */
  const onExport = () => {
    if (!cache) return;
    const payload = buildAiLocalePayload(cache);
    downloadBlob(
      `voice-ai-locale-${cache.label.toLowerCase()}.json`,
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    );
    toast.success(t('toast.settingsExported'));
  };

  /** 导入词典分享 JSON（写入缓存并注册；当前语言为 AI 时立即生效） */
  const onImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = parseAiLocalePayload(String(reader.result));
        importAiCache(imported);
        update({ aiLanguage: imported.label });
        toast.success(t('toast.aiImported', { label: imported.label, n: Object.keys(imported.dict).length }));
      } catch {
        toast.error(t('toast.aiImportFail'));
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex flex-col gap-3.5 pb-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={MOTION.page}
        className="flex flex-col gap-3.5"
      >
        {/* 子页面头：返回 + 标题 */}
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            aria-label={t('common.back')}
            className="grid size-10 place-items-center rounded-full bg-card text-ink shadow-[0_2px_14px_rgba(28,25,45,0.05),0_1px_3px_rgba(28,25,45,0.04)] transition-transform active:scale-90"
          >
            <ArrowLeft size={18} />
          </button>
          <p className="text-base font-semibold text-ink">{t('settings.language')}</p>
        </div>

        {/* 界面语言 + AI 翻译（同一区块） */}
        <SettingsSection icon={Languages} title={t('settings.language')}>
          <SettingRow
            label={<InfoTip label={t('settings.language')} text={t('settings.languageDesc')} />}
          >
            <Select
              value={settings.language}
              onValueChange={(v) => setLanguage(v as Locale)}
            >
              <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="rounded-2xl border-0 bg-card shadow-lg">
                {LOCALES.map((l) => {
                  const remark = localeRemark(l, t('settings.languageMachine'));
                  // 机器翻译文案自带括号；自定义备注在此补齐同款括号
                  const text = remark && l.note ? `（${remark}）` : remark;
                  return (
                    <SelectItem key={l.id} value={l.id}>
                      {l.label}
                      {text ? (
                        <span className="ml-1.5 text-[10px] text-ink-2">{text}</span>
                      ) : null}
                    </SelectItem>
                  );
                })}
                {aiItemVisible && (
                  <SelectItem value="ai">
                    <span className="flex items-center gap-1.5">
                      <Sparkles size={12} className="text-accent" />
                      {t('settings.aiLocaleItem', { label: cache!.label })}
                    </span>
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow label={<InfoTip label={t('settings.aiTranslate')} text={t('settings.aiTranslateDesc')} />}>
            <Switch
              checked={aiEnabled}
              onCheckedChange={(v) => update({ aiTranslateEnabled: v })}
            />
          </SettingRow>
          {aiEnabled && (
            <>
              <SettingRow stacked label={t('settings.aiLanguageLabel')}>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={t('settings.aiLanguagePlaceholder')}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={busy}
                  className="w-full rounded-xl border border-black/10 bg-surface-hi px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-2/50 focus:border-accent disabled:opacity-60"
                />
                {cache && coverage && (
                  <p className="px-0.5 text-[10px] leading-relaxed text-ink-2">
                    {t('settings.aiGeneratedInfo', {
                      label: cache.label,
                      covered: coverage.covered,
                      total: coverage.total,
                      pct: Math.round((coverage.covered / Math.max(1, coverage.total)) * 100),
                      model: cache.model,
                    })}
                  </p>
                )}
              </SettingRow>
              <SettingRow
                label={busy ? t('settings.aiGenerating', { pct }) : t('settings.aiGenerate')}
              >
                <div className="flex items-center gap-3">
                  {cache && missing > 0 && !busy && (
                    <button
                      onClick={() => onGenerate(false)}
                      className="px-1 py-2 text-xs font-medium text-ink-2 transition-opacity hover:opacity-70"
                    >
                      {t('settings.aiRegenAll')}
                    </button>
                  )}
                  <button
                    onClick={() => onGenerate(cache != null && missing > 0)}
                    disabled={busy || (cache == null && !draft.trim())}
                    className="flex items-center gap-1.5 px-1 py-2 text-xs font-medium text-accent transition-opacity hover:opacity-70 disabled:opacity-50"
                  >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    {busy
                      ? t('settings.aiWorking')
                      : cache && missing > 0
                        ? t('settings.aiMissing', { n: missing })
                        : cache ? t('settings.aiRegenerate') : t('settings.aiGenerate')}
                  </button>
                </div>
              </SettingRow>
              {/* 翻译任务卡：进度条 + 批次明细 + 日志（后台运行，离开页面不中断） */}
              {busy && task.progress && (
                <div className="px-0.5 pb-1">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hi">
                    <div
                      className="h-full rounded-full bg-accent transition-[width] duration-700 ease-out"
                      style={{ width: `${Math.max(3, pct)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[10px] tabular-nums text-ink-2">
                    {t('settings.aiProgressDetail', {
                      batch: task.progress.batch + 1,
                      total: task.progress.totalBatches,
                      done: task.progress.entriesDone,
                      all: task.progress.entriesTotal,
                    })}
                    <span className="mx-1.5 opacity-40">·</span>
                    {t('settings.aiTaskHint')}
                  </p>
                </div>
              )}
              {task.log.length > 0 && (
                <SettingRow stacked label={<InfoTip label={t('settings.aiTaskLog')} text={t('settings.aiTaskLogDesc')} />}>
                  <div className="max-h-28 overflow-y-auto rounded-xl bg-surface-hi/70 px-3 py-2 font-mono text-[10px] leading-relaxed text-ink-2">
                    {task.log.map((l, i) => (
                      <p key={`${l.at}-${i}`} className="whitespace-pre-wrap">
                        <span className="opacity-50">[{new Date(l.at).toLocaleTimeString(localeTag(), { hour12: false })}]</span> {l.text}
                      </p>
                    ))}
                  </div>
                  {busy && (
                    <button
                      onClick={cancelAITask}
                      className="mt-1 w-fit px-1 py-1 text-[11px] font-medium text-red-500 transition-opacity hover:opacity-70"
                    >
                      {t('settings.aiCancel')}
                    </button>
                  )}
                </SettingRow>
              )}
              {/* 翻译术语表（可折叠） */}
              <SettingRow label={<InfoTip label={t('settings.aiGlossary')} text={t('settings.aiGlossaryDesc')} />}>
                <button
                  onClick={() => setGlossaryOpen((v) => !v)}
                  aria-expanded={glossaryOpen}
                  className="flex items-center gap-0.5 px-1 py-2 text-xs font-medium text-accent transition-opacity hover:opacity-70"
                >
                  {glossaryOpen ? t('common.close') : t('settings.aiGlossaryOpen')}
                  <ChevronDown size={13} className={cn('transition-transform', glossaryOpen && 'rotate-180')} />
                </button>
              </SettingRow>
              {glossaryOpen && (
                <SettingRow stacked label={t('settings.aiGlossary')}>
                  <textarea
                    value={settings.aiGlossary ?? ''}
                    onChange={(e) => update({ aiGlossary: e.target.value })}
                    placeholder={t('settings.aiGlossaryPlaceholder')}
                    rows={3}
                    spellCheck={false}
                    className="w-full resize-y rounded-xl border border-black/10 bg-surface-hi px-3 py-2 font-mono text-xs text-ink outline-none placeholder:text-ink-2/50 focus:border-accent"
                  />
                </SettingRow>
              )}
              {/* 编辑词条（自定义覆盖，优先于词典） */}
              <SettingRow label={<InfoTip label={t('settings.aiEditStrings')} text={t('settings.aiEditStringsDesc')} />}>
                <button
                  onClick={() => setEditOpen(true)}
                  className="flex items-center gap-1.5 px-1 py-2 text-xs font-medium text-accent transition-opacity hover:opacity-70"
                >
                  <Pencil size={13} />
                  {t('settings.editOpen')}
                </button>
              </SettingRow>
              {/* 分享词典（导出 / 导入） */}
              {cache && (
                <SettingRow label={t('settings.aiShare')}>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={onExport}
                      className="flex items-center gap-1.5 px-1 py-2 text-xs font-medium text-accent transition-opacity hover:opacity-70"
                    >
                      <Download size={13} />
                      {t('common.export')}
                    </button>
                    <button
                      onClick={() => importInputRef.current?.click()}
                      className="flex items-center gap-1.5 px-1 py-2 text-xs font-medium text-accent transition-opacity hover:opacity-70"
                    >
                      <Upload size={13} />
                      {t('common.import')}
                    </button>
                  </div>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) onImportFile(file);
                      e.target.value = '';
                    }}
                  />
                </SettingRow>
              )}
              {cache && (
                <SettingRow label={t('settings.aiClear')}>
                  <button
                    onClick={onClear}
                    className="flex items-center gap-1.5 px-1 py-2 text-xs font-medium text-red-500 transition-opacity hover:opacity-70"
                  >
                    <Trash2 size={14} />
                    {t('settings.aiClear')}
                  </button>
                </SettingRow>
              )}
            </>
          )}
        </SettingsSection>

        {/* 编辑词条浮层 */}
        {editOpen && <EditStringsSheet onClose={() => setEditOpen(false)} />}
      </motion.div>
    </div>
  );
}
