/**
 * 应用（设置的子页面）
 * - 安装：PWA 一键安装（浏览器支持时）或手动安装指引；分享应用
 * - 版本与更新：当前版本（构建时注入）、检查更新（Web 走 Service Worker，
 *   原生壳比对 GitHub Releases 最新 APK、浏览器下载覆盖安装）、
 *   未读的「本次更新内容」卡片、清除缓存并重置（修复工具）
 * - 运行状态：运行方式 / Service Worker / 持久化存储 / 网络，附诊断信息一键复制
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Download, RefreshCw, Smartphone, Loader2, Activity, Share2, Wrench, ClipboardCopy,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  usePwaInstall, promptInstall, checkForAppUpdate,
  getServiceWorkerStatus, isStoragePersisted, resetAppRuntime, isStandalone,
  type SwStatus,
} from '@/lib/pwa';
import { checkNativeAppUpdate, openApkDownload, type NativeUpdateInfo } from '@/lib/appUpdate';
import { t, localeTag } from '@/i18n';
import { useI18n } from '@/i18n/hook';
import { isNative } from '@/lib/platform';
import { cn } from '@/lib/utils';
import type { AppSettings, ViewType } from '@/types';
import { NAV, navLabelKey } from './navItems';
import {
  SettingsSection, SettingRow, SELECT_TRIGGER_CLASS,
} from './rows';
import { InfoTip } from './InfoTip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '@/components/ui';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui';

/** 只读状态行（label + 值） */
function StatusRow({ label, value, valueCls }: { label: string; value: string; valueCls?: string }) {
  return (
    <SettingRow label={label}>
      <span className={cn('text-xs font-medium tabular-nums', valueCls ?? 'text-ink')}>{value}</span>
    </SettingRow>
  );
}

export function AppPage({
  settings,
  update,
  onBack,
}: {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  /** 返回设置主视图（appOpen 由父组件持有，不持久化） */
  onBack: () => void;
}) {
  useI18n();
  const install = usePwaInstall();
  const [checking, setChecking] = useState(false);
  // 原生壳：检查更新发现的新版本（PWA 端发现即自动刷新，无需状态）
  const [nativeUpdate, setNativeUpdate] = useState<NativeUpdateInfo | null>(null);
  // 运行状态（挂载读取；检查更新完成后刷新）
  const [sw, setSw] = useState<SwStatus>('none');
  const [persisted, setPersisted] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  // 上次见过的版本 ≠ 当前 → 展示「本次更新内容」卡片
  // （标记由 App 启动时的版本检测写入，点「知道了」清除）
  const [updateUnseen, setUpdateUnseen] = useState(
    () => localStorage.getItem('svt:update-notes-open') === '1',
  );

  useEffect(() => {
    void getServiceWorkerStatus().then(setSw);
    void isStoragePersisted().then(setPersisted);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const onCheckUpdate = () => {
    if (checking) return;
    setChecking(true);
    void (async () => {
      try {
        if (isNative) {
          // 原生壳：比对 GitHub Releases 的最新 APK；更新 = 浏览器下载后覆盖安装
          const result = await checkNativeAppUpdate();
          if (result === 'unavailable') toast.info(t('toast.updateUnavailable'));
          else if (result === 'latest') toast.success(t('toast.updateLatest'));
          else {
            setNativeUpdate(result.update);
            toast.success(t('toast.updateFound'));
          }
          return;
        }
        const result = await checkForAppUpdate();
        if (result === 'unavailable') toast.info(t('toast.updateUnavailable'));
        else if (result === 'found') toast.success(t('toast.updateFound'));
        else toast.success(t('toast.updateLatest'));
      } finally {
        // found 分支页面会刷新；unavailable/latest 恢复按钮并刷新 SW 状态
        setChecking(false);
        if (!isNative) void getServiceWorkerStatus().then(setSw);
      }
    })();
  };

  /** 分享应用：Web Share API，不支持时回退复制链接 */
  const onShare = async () => {
    const url = window.location.origin + window.location.pathname;
    const payload = { title: t('settings.shareAppText'), url };
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share(payload);
        return;
      } catch (err) {
        // 用户取消分享不算失败
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('toast.linkCopied'));
    } catch {
      toast.error(t('toast.linkCopyFail'));
    }
  };

  /** 复制诊断信息（版本 / 运行方式 / SW / 存储 / UA），便于反馈问题 */
  const onCopyDiagnostics = async () => {
    const lines = [
      `Simple Voice Tool for Trans v${__APP_VERSION__} (${__BUILD_DATE__})`,
      `mode: ${isStandalone() ? 'standalone' : 'browser'}`,
      `sw: ${sw}`,
      `persisted: ${persisted}`,
      `online: ${navigator.onLine}`,
      `locale: ${localeTag()}`,
      `ua: ${navigator.userAgent}`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(lines);
      toast.success(t('toast.diagCopied'));
    } catch {
      toast.error(t('toast.diagCopyFail'));
    }
  };

  /** 清除缓存并重置：删除全部缓存 + 注销 SW 后刷新（IndexedDB 记录不受影响） */
  const onReset = () => {
    void resetAppRuntime().then(() => window.location.reload());
  };

  const swLabel = {
    active: t('settings.statusSwActive'),
    waiting: t('settings.statusSwWaiting'),
    installing: t('settings.statusSwInstalling'),
    none: t('settings.statusSwNone'),
    unsupported: t('settings.statusSwNone'),
  }[sw];

  return (
    <div className="flex flex-col gap-3.5 pb-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
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
          <p className="text-base font-semibold text-ink">{t('settings.app')}</p>
        </div>

        {/* 安装与分享（原生壳内应用即已安装，无 Web 安装流程） */}
        <SettingsSection icon={Smartphone} title={t('settings.app')}>
          {!isNative && (
            <SettingRow
              label={<InfoTip label={t('settings.install')} text={t('settings.installManualHint')} />}
            >
            <button
              type="button"
              onClick={async () => {
                if (install.canInstall) {
                  const outcome = await promptInstall();
                  if (outcome === 'dismissed') toast.info(t('toast.installDismissed'));
                  else if (outcome === 'unavailable') toast.info(t('toast.installUnavailable'));
                } else {
                  toast.info(t('settings.installManualHint'));
                }
              }}
              disabled={install.standalone}
              className={cn(
                'flex items-center gap-1.5 px-1 py-2 text-xs font-medium transition-opacity',
                install.standalone ? 'cursor-default text-ink-2/60' : 'text-accent hover:opacity-70',
              )}
            >
              <Download size={14} />
              {install.standalone ? t('settings.installDone') : install.canInstall ? t('settings.installOneClick') : t('settings.installManual')}
            </button>
          </SettingRow>
          )}
          <SettingRow label={t('settings.shareApp')}>
            <button
              type="button"
              onClick={() => void onShare()}
              className="flex items-center gap-1.5 px-1 py-2 text-xs font-medium text-accent transition-opacity hover:opacity-70"
            >
              <Share2 size={14} />
              {t('settings.shareAppAction')}
            </button>
          </SettingRow>
          {/* 启动默认页签（原「配置 · 通用」迁入：属于 App 行为，不属于训练/显示） */}
          <SettingRow label={t('settings.startTab')}>
            <Select
              value={settings.startTab}
              onValueChange={(v) => update({ startTab: v as ViewType })}
            >
              <SelectTrigger className={SELECT_TRIGGER_CLASS}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="rounded-2xl border-0 bg-card shadow-lg">
                {NAV.map((n) => (
                  <SelectItem key={n} value={n}>{t(navLabelKey[n])}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
          {/* 原生壳启动页（仅在原生壳内有意义） */}
          {isNative && (
            <SettingRow label={<InfoTip label={t('settings.splashScreen')} text={t('settings.splashScreenDesc')} />}>
              <Switch
                checked={settings.splashScreen}
                onCheckedChange={(v) => update({ splashScreen: v })}
              />
            </SettingRow>
          )}
        </SettingsSection>

        {/* 版本与更新 */}
        <SettingsSection icon={RefreshCw} title={t('settings.updateSection')}>
          {updateUnseen && (
            <div className="mb-1 rounded-2xl bg-accent-soft/60 px-4 py-3">
              <p className="text-xs font-semibold text-on-accent-soft">{t('settings.updateNotesTitle')}</p>
              <p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-on-accent-soft/90">
                {t('settings.updateNotes')}
              </p>
              <button
                onClick={() => {
                  localStorage.removeItem('svt:update-notes-open');
                  setUpdateUnseen(false);
                }}
                className="mt-2 rounded-full bg-card/80 px-3 py-1 text-[11px] font-medium text-ink transition-opacity hover:opacity-80"
              >
                {t('settings.updateNotesDismiss')}
              </button>
            </div>
          )}
          <SettingRow label={t('settings.versionLabel')} desc={__BUILD_DATE__}>
            <span className="text-xs font-semibold tabular-nums text-ink">v{__APP_VERSION__}</span>
          </SettingRow>
          {/* 检查更新：Web 走 Service Worker；原生壳比对 GitHub Releases 的最新 APK */}
          <SettingRow
            label={
              <InfoTip
                label={t('settings.checkUpdate')}
                text={isNative ? t('settings.checkUpdateNativeDesc') : t('settings.checkUpdateDesc')}
              />
            }
          >
            <button
              type="button"
              onClick={onCheckUpdate}
              disabled={checking}
              className="flex items-center gap-1.5 px-1 py-2 text-xs font-medium text-accent transition-opacity hover:opacity-70 disabled:opacity-60"
            >
              {checking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {checking ? t('settings.checkUpdateBusy') : t('settings.checkUpdate')}
            </button>
          </SettingRow>
          {/* 原生壳：发现新版本 → 提供下载入口（浏览器下载 APK 后覆盖安装） */}
          {isNative && nativeUpdate && (
            <SettingRow
              label={
                <InfoTip
                  label={t('settings.updateFound', { version: nativeUpdate.version })}
                  text={t('settings.updateFoundDesc')}
                />
              }
            >
              <button
                type="button"
                onClick={() => openApkDownload(nativeUpdate)}
                className="flex items-center gap-1.5 px-1 py-2 text-xs font-medium text-accent transition-opacity hover:opacity-70"
              >
                <Download size={14} />
                {t('settings.updateDownload')}
              </button>
            </SettingRow>
          )}
          {!isNative && (
            <SettingRow
              label={<InfoTip label={t('settings.resetCache')} text={t('settings.resetCacheDesc')} />}
            >
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button className="flex items-center gap-1.5 px-1 py-2 text-xs font-medium text-red-500 transition-opacity hover:opacity-70">
                  <Wrench size={14} />
                  {t('settings.resetCache')}
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent className="rounded-3xl border-0 bg-card">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-ink">{t('settings.resetCacheTitle')}</AlertDialogTitle>
                  <AlertDialogDescription className="text-ink-2">
                    {t('settings.resetCacheBody')}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="rounded-none border-0 bg-transparent text-sm font-medium text-ink-2 shadow-none">{t('common.cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={onReset}
                    className="rounded-none bg-red-500 text-sm text-white hover:bg-red-500/90"
                  >
                    {t('settings.resetCacheConfirm')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </SettingRow>
          )}
        </SettingsSection>

        {/* 运行状态 */}
        <SettingsSection icon={Activity} title={t('settings.statusSection')}>
          <StatusRow
            label={t('settings.statusMode')}
            value={isNative || install.standalone ? t('settings.statusStandalone') : t('settings.statusBrowser')}
          />
          {!isNative && <StatusRow label={t('settings.statusSw')} value={swLabel} />}
          <StatusRow
            label={t('settings.statusPersist')}
            value={persisted ? t('settings.statusOn') : t('settings.statusOff')}
          />
          <StatusRow
            label={t('settings.statusNetwork')}
            value={online ? t('settings.statusOnline') : t('settings.statusOffline')}
            valueCls={online ? 'text-ink' : 'text-red-500'}
          />
          <SettingRow
            label={<InfoTip label={t('settings.diagCopy')} text={t('settings.diagCopyDesc')} />}
          >
            <button
              type="button"
              onClick={() => void onCopyDiagnostics()}
              className="flex items-center gap-1.5 px-1 py-2 text-xs font-medium text-accent transition-opacity hover:opacity-70"
            >
              <ClipboardCopy size={14} />
              {t('settings.diagCopy')}
            </button>
          </SettingRow>
        </SettingsSection>
      </motion.div>
    </div>
  );
}
