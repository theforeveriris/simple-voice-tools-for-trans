/**
 * 联网搜索（Tavily BYOK）
 *
 * API Key 只存 IndexedDB（web:tavilyKey），不进入设置导出 / 主题包 / 备份 / 日志。
 * 默认关闭；开启后助手才会看到 web_search 工具。
 */
import { useEffect, useState } from 'react';
import { Eye, EyeOff, Globe, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import type { AppSettings } from '@/types';
import { clearTavilyKey, loadTavilyKey, maskTavilyKey, saveTavilyKey, subscribeTavilyKey, testTavilyKey } from '@/lib/webSearch';
import { Switch } from '@/components/ui';
import { SettingRow, SettingsSection } from './rows';

const KEY_INPUT_CLASS =
  'min-w-0 flex-1 rounded-xl border border-line bg-surface-hi px-3 py-2 font-mono text-xs text-ink outline-none placeholder:text-ink-2/60 focus-visible:ring-1 focus-visible:ring-accent/60';

export function WebSearchSection({
  settings,
  update,
}: {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
}) {
  useI18n();
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState<'save' | 'test' | 'clear' | null>(null);

  useEffect(() => {
    let alive = true;
    void loadTavilyKey().then((key) => {
      if (alive) setSavedKey(key);
    });
    const unsubscribe = subscribeTavilyKey((key) => {
      if (alive) setSavedKey(key);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const save = async () => {
    const key = draft.trim();
    if (!key || busy) return;
    setBusy('save');
    try {
      await saveTavilyKey(key);
      setSavedKey(key);
      setDraft('');
      setReveal(false);
      toast.success(t('settings.webSearchSaved'));
    } catch {
      toast.error(t('settings.webSearchTestFail'));
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    const key = draft.trim() || savedKey;
    if (!key) {
      toast.error(t('settings.webSearchNeedKey'));
      return;
    }
    setBusy('test');
    try {
      await testTavilyKey(key);
      toast.success(t('settings.webSearchTestOk'));
    } catch (err) {
      toast.error(t('settings.webSearchTestFail'), {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  };

  const clear = async () => {
    if (!savedKey || busy) return;
    setBusy('clear');
    try {
      await clearTavilyKey();
      setSavedKey(null);
      setDraft('');
      update({ webSearchEnabled: false });
      toast.success(t('settings.webSearchCleared'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <SettingsSection icon={Globe} title={t('settings.webSearch')}>
      <SettingRow label={t('settings.webSearch')} desc={t('settings.webSearchDesc')}>
        <Switch
          checked={settings.webSearchEnabled}
          disabled={!savedKey}
          onCheckedChange={(v) => update({ webSearchEnabled: v })}
          aria-label={t('settings.webSearch')}
        />
      </SettingRow>

      <SettingRow label={t('settings.webSearchKey')} stacked>
        <div className="flex items-center gap-1.5">
          <input
            type={reveal ? 'text' : 'password'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={savedKey ? maskTavilyKey(savedKey) : t('settings.webSearchKeyPlaceholder')}
            aria-label={t('settings.webSearchKey')}
            autoComplete="off"
            spellCheck={false}
            className={KEY_INPUT_CLASS}
          />
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            aria-label={t('settings.webSearchKey')}
            className="grid size-8 shrink-0 place-items-center rounded-full text-ink-2 transition-colors hover:bg-surface-hi hover:text-ink"
          >
            {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!draft.trim() || busy != null}
            className="shrink-0 rounded-full bg-accent px-3 py-1.5 text-[11px] font-semibold text-on-accent transition-transform active:scale-95 disabled:opacity-40"
          >
            {busy === 'save' ? <Loader2 size={12} className="animate-spin" /> : t('common.save')}
          </button>
        </div>
        <p className="mt-1 text-[10px] text-ink-2/70">
          {savedKey ? t('settings.webSearchConfigured') : t('settings.webSearchNotConfigured')}
        </p>
      </SettingRow>

      <div className="flex flex-wrap items-center gap-2 py-2">
        <button
          type="button"
          onClick={() => void test()}
          disabled={busy != null}
          className="inline-flex items-center gap-1 rounded-full bg-surface-hi px-3 py-1.5 text-[11px] font-medium text-ink-2 transition-colors hover:text-ink disabled:opacity-40"
        >
          {busy === 'test' && <Loader2 size={12} className="animate-spin" />}
          {t('settings.webSearchTest')}
        </button>
        {savedKey && (
          <button
            type="button"
            onClick={() => void clear()}
            disabled={busy != null}
            className="rounded-full px-3 py-1.5 text-[11px] font-medium text-ink-2 transition-colors hover:bg-surface-hi hover:text-ink disabled:opacity-40"
          >
            {busy === 'clear' ? <Loader2 size={12} className="animate-spin" /> : t('settings.webSearchClear')}
          </button>
        )}
      </div>

      <p className="rounded-xl bg-surface-hi/60 px-3 py-2 text-[10px] leading-relaxed text-ink-2/80">
        {t('settings.webSearchPrivacy')}
      </p>
    </SettingsSection>
  );
}
