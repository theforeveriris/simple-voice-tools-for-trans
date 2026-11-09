/**
 * 配置档案区（大模型子页面 · v0.9.0 方案 A：档案即数据源）
 * - 卡片列表：点按 = 切换使用中；铅笔 = 编辑
 * - 新建 / 编辑共用一个表单弹窗：测试连接 / 保存 / 创建副本 / 删除（两步确认）
 * - 档案本体存 IndexedDB（llm:profiles，含 API Key，不进 localStorage）；
 *   活动指针 = settings.llmActiveProfileId
 */

import { useRef, useState } from 'react';
import { Copy, Eye, EyeOff, Layers, Loader2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import type { AppSettings } from '@/types';
import type { LlmProtocol } from '@/lib/llm';
import { cn } from '@/lib/utils';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch,
} from '@/components/ui';
import { SettingsSection } from './rows';
import { InfoTip } from './InfoTip';
import {
  addProfile, deleteProfile, duplicateProfile, updateProfile, useLlmProfiles,
  DEFAULT_CONTEXT_TOKENS, MAX_CONTEXT_TOKENS, type LlmProfile,
} from '@/lib/llmProfiles';
import { resolveLlmConfig, testLlmConnection } from '@/lib/llm';
import {
  contextTokensForModel, fetchLlmModels, formatContextTokens, type LlmModelInfo,
} from '@/lib/llmModels';

/** baseUrl → 展示用主机名（无协议等非法输入时退化为去头后的首段） */
function hostOf(url: string): string {
  const s = url.trim();
  if (!s) return '—';
  try {
    return new URL(s).host;
  } catch {
    return s.replace(/^https?:\/\//, '').split('/')[0] || '—';
  }
}

export function LlmProfilesSection({
  settings,
  update,
}: {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
}) {
  useI18n();
  const profiles = useLlmProfiles();
  const activeId = settings.llmActiveProfileId;
  /** null = 关闭；{ mode: 'new' } = 新建；{ mode: 'edit', id } = 编辑既有档案 */
  const [sheet, setSheet] = useState<{ mode: 'new' } | { mode: 'edit'; id: string } | null>(null);

  const activate = (p: LlmProfile) => {
    if (p.id === activeId) return;
    update({ llmActiveProfileId: p.id });
    toast.success(t('toast.llmProfileApplied', { name: p.name }));
  };

  return (
    <SettingsSection icon={Layers} title={t('settings.llmProfiles')}>
      {profiles == null ? null : profiles.length === 0 ? (
        <p className="py-2 text-xs leading-relaxed text-ink-2">{t('settings.llmProfileEmpty')}</p>
      ) : (
        profiles.map((p) => {
          const active = p.id === activeId;
          return (
            <div
              key={p.id}
              className={cn(
                'flex items-center gap-1 rounded-2xl px-2.5 py-1.5',
                active && 'bg-accent/10',
              )}
            >
              <button onClick={() => activate(p)} className="min-w-0 flex-1 py-1 text-left">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-ink">{p.name}</span>
                  {active && (
                    <span className="shrink-0 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">
                      {t('settings.llmProfileActiveBadge')}
                    </span>
                  )}
                </span>
                <span className="block truncate text-[11px] text-ink-2">
                  {hostOf(p.baseUrl)} · {p.modelId || '—'}
                </span>
              </button>
              <button
                onClick={() => setSheet({ mode: 'edit', id: p.id })}
                aria-label={t('settings.llmProfileEdit')}
                className="grid size-8 shrink-0 place-items-center rounded-full text-ink-2 transition-transform active:scale-90"
              >
                <Pencil size={14} />
              </button>
            </div>
          );
        })
      )}
      <button
        onClick={() => setSheet({ mode: 'new' })}
        className="mt-1 flex items-center justify-center gap-1.5 rounded-2xl border border-dashed border-black/10 py-2 text-xs font-medium text-ink-2 transition-transform active:scale-[0.99]"
      >
        <Plus size={14} />
        {t('settings.llmProfileNew')}
      </button>

      {profiles != null && profiles.length > 0 && (
        <div className="mt-1 flex items-center justify-between gap-2 rounded-2xl bg-surface-hi/50 px-2.5 py-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-ink">{t('settings.llmAuxProfile')}</p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-ink-2">
              {t('settings.llmAuxProfileDesc')}
            </p>
          </div>
          <select
            value={settings.llmAuxProfileId ?? ''}
            onChange={(e) => update({ llmAuxProfileId: e.target.value || undefined })}
            aria-label={t('settings.llmAuxProfile')}
            className="max-w-32 shrink-0 rounded-xl border border-black/10 bg-card px-2 py-1.5 text-[11px] text-ink outline-none"
          >
            <option value="">{t('settings.llmAuxProfileSame')}</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}

      {sheet && (
        <ProfileSheet
          profile={sheet.mode === 'edit' ? profiles?.find((p) => p.id === sheet.id) ?? null : null}
          activeId={activeId}
          update={update}
          onClose={() => setSheet(null)}
        />
      )}
    </SettingsSection>
  );
}

/** 新建 / 编辑档案的表单弹窗（含连接测试、副本、两步删除） */
function ProfileSheet({
  profile,
  activeId,
  update,
  onClose,
}: {
  profile: LlmProfile | null;
  activeId: string | undefined;
  update: (patch: Partial<AppSettings>) => void;
  onClose: () => void;
}) {
  useI18n();
  const [name, setName] = useState(profile?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(profile?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState(profile?.apiKey ?? '');
  const [modelId, setModelId] = useState(profile?.modelId ?? '');
  const [protocol, setProtocol] = useState<LlmProtocol>(profile?.protocol ?? 'openai');
  const [contextTokens, setContextTokens] = useState(String(
    profile?.contextTokens ?? DEFAULT_CONTEXT_TOKENS,
  ));
  const [stream, setStream] = useState(profile?.stream !== false);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [delArmed, setDelArmed] = useState(false);
  const [models, setModels] = useState<LlmModelInfo[] | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  /** 最近一次自动识别的上下文长度（用于提示；用户手改后清空） */
  const [contextAuto, setContextAuto] = useState<number | null>(null);
  /** 用户是否手动改过上下文长度：编辑既有档案时默认保留原值 */
  const [contextDirty, setContextDirty] = useState(profile != null);
  /** 请求序号：Base URL / Key / 协议变化后，丢弃旧端点的迟到响应 */
  const modelsSeq = useRef(0);

  const inputCls =
    'w-full rounded-xl border border-black/10 bg-surface-hi px-3 py-2 font-mono text-xs text-ink outline-none placeholder:text-ink-2/50 focus:border-accent';

  // 未手动改过时，保存/测试也用自动识别的值——避免「输入框失焦后立刻点保存」竞态。
  // contextAuto 来自接口元数据或「自动识别」；autoContext 是当前模型 ID 的目录兜底。
  const autoContext = contextDirty ? null : contextTokensForModel(modelId);
  const effectiveContext = (contextDirty ? null : (contextAuto ?? autoContext))
    || Number(contextTokens)
    || DEFAULT_CONTEXT_TOKENS;

  const formCfg = resolveLlmConfig({
    llmBaseUrl: baseUrl,
    llmApiKey: apiKey,
    llmModelId: modelId,
    protocol,
    stream,
    contextTokens: effectiveContext,
  });

  const collect = () => ({
    name: name.trim(),
    baseUrl: baseUrl.trim(),
    apiKey: apiKey.trim(),
    modelId: modelId.trim(),
    protocol,
    stream,
    contextTokens: Math.max(1024, Math.min(effectiveContext, MAX_CONTEXT_TOKENS)),
  });

  const onTest = () => {
    if (testing) return;
    if (!formCfg) {
      toast.error(t('toast.llmTestFail', { msg: t('settings.llmIncomplete') }));
      return;
    }
    setTesting(true);
    testLlmConnection(formCfg)
      .then((reply) => toast.success(t('toast.llmTestOk', { model: reply })))
      .catch((err: unknown) =>
        toast.error(t('toast.llmTestFail', { msg: err instanceof Error ? err.message : String(err) })))
      .finally(() => setTesting(false));
  };

  const resetModels = () => {
    modelsSeq.current += 1;
    setModelsLoading(false);
    setModels(null);
    setModelsError(null);
  };

  const onFetchModels = () => {
    if (modelsLoading) return;
    const base = baseUrl.trim();
    const key = apiKey.trim();
    if (!base || !key) {
      toast.error(t('settings.llmModelsNeedConfig'));
      return;
    }
    setModelsLoading(true);
    setModels(null);
    setModelsError(null);
    const seq = ++modelsSeq.current;
    fetchLlmModels({ baseUrl: base, apiKey: key, protocol })
      .then((list) => {
        if (modelsSeq.current !== seq) return;
        setModels(list);
        if (list.length === 0) {
          setModelsError(t('settings.llmModelsEmpty'));
        } else {
          toast.success(t('settings.llmModelsFetched', { n: list.length }));
        }
      })
      .catch((err: unknown) => {
        if (modelsSeq.current !== seq) return;
        const raw = err instanceof Error ? err.message : String(err);
        const network = /Failed to fetch|NetworkError|Load failed|fetch failed/i.test(raw);
        setModelsError(t('settings.llmModelsFailed', {
          msg: network ? t('settings.llmModelsNetwork') : raw,
        }));
      })
      .finally(() => {
        if (modelsSeq.current === seq) setModelsLoading(false);
      });
  };

  /** 选中已拉取的模型：优先用接口元数据里的上下文长度，其次内置目录 */
  const chooseModel = (id: string) => {
    setModelId(id);
    const detected = models?.find((m) => m.id === id)?.contextTokens
      ?? contextTokensForModel(id);
    if (detected) {
      setContextTokens(String(detected));
      setContextAuto(detected);
      setContextDirty(false);
    } else {
      setContextAuto(null);
      toast.info(t('settings.llmContextUnknown'));
    }
  };

  /** 手动填写模型 ID 时，按内置目录识别上下文长度 */
  const detectContext = () => {
    const detected = contextTokensForModel(modelId);
    if (detected) {
      setContextTokens(String(detected));
      setContextAuto(detected);
      setContextDirty(false);
    } else {
      setContextAuto(null);
      toast.info(t('settings.llmContextUnknown'));
    }
  };

  const onSave = () => {
    const v = collect();
    if (!v.name) {
      toast.error(t('toast.llmProfileNameEmpty'));
      return;
    }
    if (!formCfg) {
      toast.error(t('toast.llmProfileIncomplete'));
      return;
    }
    if (profile) {
      updateProfile(profile.id, v);
    } else {
      // 新建的档案自动设为使用中（刚建完大概率就是要用它）
      update({ llmActiveProfileId: addProfile(v.name, v) });
    }
    toast.success(t('toast.llmProfileSaved', { name: v.name }));
    onClose();
  };

  const onDuplicate = () => {
    if (!profile) return;
    const id = duplicateProfile(profile.id);
    if (id) toast.success(t('toast.llmProfileSaved', { name: `${profile.name} · ${t('settings.llmProfileCopySuffix')}` }));
    onClose();
  };

  const onDelete = () => {
    if (!profile) return;
    if (!delArmed) {
      setDelArmed(true);
      return;
    }
    deleteProfile(profile.id);
    if (activeId === profile.id) update({ llmActiveProfileId: undefined });
    toast.success(t('toast.llmProfileDeleted', { name: profile.name }));
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-3xl border-0 bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{profile ? t('settings.llmProfileEdit') : t('settings.llmProfileNew')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-medium text-ink-2">{t('settings.llmProtocol')}</span>
            <Select
              value={protocol}
              onValueChange={(v) => { setProtocol(v as LlmProtocol); resetModels(); }}
            >
              <SelectTrigger className="w-40 border-0 bg-surface-hi px-3 text-xs shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="rounded-2xl border-0 bg-card shadow-lg">
                <SelectItem value="openai">{t('settings.llmProtocolOpenai')}</SelectItem>
                <SelectItem value="anthropic">{t('settings.llmProtocolAnthropic')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-ink-2">{t('settings.llmProfileName')}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('settings.llmProfileNamePh')}
              autoComplete="off"
              className="w-full rounded-xl border border-black/10 bg-surface-hi px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-2/50 focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-ink-2">{t('settings.llmBaseUrl')}</span>
            <input
              value={baseUrl}
              onChange={(e) => { setBaseUrl(e.target.value); resetModels(); }}
              placeholder={t('settings.llmBaseUrlPlaceholder')}
              spellCheck={false}
              autoComplete="off"
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-ink-2">{t('settings.llmApiKey')}</span>
            <span className="flex items-center gap-2">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); resetModels(); }}
                placeholder={t('settings.llmApiKeyPlaceholder')}
                spellCheck={false}
                autoComplete="off"
                className={inputCls}
              />
              <button
                onClick={() => setShowKey((v) => !v)}
                aria-label={t('settings.llmApiKey')}
                className="grid size-8 shrink-0 place-items-center rounded-full text-ink-2"
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </span>
          </label>
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-ink-2">{t('settings.llmModelId')}</span>
              <button
                type="button"
                onClick={onFetchModels}
                disabled={modelsLoading}
                title={t('settings.llmModelsTip')}
                className="flex items-center gap-1 rounded-full bg-surface-hi px-2 py-0.5 text-[10px] font-medium text-ink-2 transition-colors hover:text-accent disabled:opacity-50"
              >
                {modelsLoading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                {modelsLoading ? t('settings.llmModelsFetching') : t('settings.llmModelsFetch')}
              </button>
            </div>
            <input
              value={modelId}
              onChange={(e) => {
                setModelId(e.target.value);
                setContextAuto(null);
                setContextDirty(false);
              }}
              onBlur={() => {
                if (contextDirty) return;
                const detected = contextTokensForModel(modelId);
                if (detected) {
                  setContextTokens(String(detected));
                  setContextAuto(detected);
                }
              }}
              placeholder={t('settings.llmModelIdPlaceholder')}
              spellCheck={false}
              autoComplete="off"
              className={inputCls}
            />
            {models && models.length > 0 && (
              <Select
                value={models.some((m) => m.id === modelId) ? modelId : ''}
                onValueChange={chooseModel}
              >
                <SelectTrigger className="w-full border-0 bg-surface-hi px-3 text-xs shadow-none">
                  <SelectValue placeholder={t('settings.llmModelsSelect')} />
                </SelectTrigger>
                <SelectContent position="popper" className="max-h-64 rounded-2xl border-0 bg-card shadow-lg">
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-mono text-xs">{m.id}</span>
                        {m.label && <span className="truncate text-[10px] text-ink-2">{m.label}</span>}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {modelsError && (
              <p className="text-[10px] leading-relaxed text-[#B0532F]">{modelsError}</p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <InfoTip label={t('settings.llmContext')} text={t('settings.llmContextDesc')} />
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                min={1024}
                step={1024}
                value={contextTokens}
                onChange={(e) => {
                  setContextTokens(e.target.value);
                  setContextAuto(null);
                  setContextDirty(true);
                }}
                className="w-full rounded-xl border border-black/10 bg-surface-hi px-3 py-2 text-right font-mono text-xs text-ink outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={detectContext}
                className="shrink-0 rounded-full bg-surface-hi px-2.5 py-1.5 text-[10px] font-medium text-ink-2 transition-colors hover:text-accent"
              >
                {t('settings.llmContextDetect')}
              </button>
            </div>
            {contextAuto != null && (
              <p className="px-0.5 text-[10px] leading-relaxed text-ink-2">
                {t('settings.llmContextAuto', { n: formatContextTokens(contextAuto) })}
              </p>
            )}
          </div>
          <div className="flex items-center justify-between gap-3">
            <InfoTip label={t('settings.llmStream')} text={t('settings.llmStreamDesc')} />
            <Switch checked={stream} onCheckedChange={setStream} />
          </div>
          <button
            onClick={onTest}
            disabled={testing}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-accent/10 py-2 text-xs font-medium text-accent disabled:opacity-60"
          >
            {testing && <Loader2 size={12} className="animate-spin" />}
            {testing ? t('settings.llmTesting') : t('settings.llmTest')}
          </button>
        </div>
        <DialogFooter className="flex-row items-center gap-2">
          {profile && (
            <>
              <button
                onClick={onDuplicate}
                className="flex items-center gap-1.5 rounded-full bg-card px-3 py-2 text-xs font-medium text-ink shadow-[0_1px_4px_rgba(28,25,45,0.06)]"
              >
                <Copy size={13} />
                {t('settings.llmProfileDuplicate')}
              </button>
              <button
                onClick={onDelete}
                className={cn(
                  'ml-auto flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition-colors',
                  delArmed ? 'bg-red-500 text-white' : 'bg-red-500/10 text-red-500',
                )}
              >
                <Trash2 size={13} />
                {delArmed ? t('settings.llmProfileDeleteConfirm') : t('settings.llmProfileDelete')}
              </button>
            </>
          )}
          <button
            onClick={onSave}
            className={cn('rounded-full px-4 py-2 text-xs font-semibold text-white', profile ? 'bg-accent' : 'bg-accent ml-auto')}
          >
            {t('common.save')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
