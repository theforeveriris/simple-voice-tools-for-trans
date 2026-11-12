/**
 * 本地自动备份（实验性，File System Access API）
 * 用户在 实验性功能 中选择一个文件夹后，把完整备份 ZIP 按天写入该文件夹：
 *   - 每次录音落库后自动执行（1 分钟节流，防连录时反复打包）；
 *   - 每周首次打开应用时补一次。
 * 仅 Chromium 系浏览器支持；目录授权可能随时间过期，
 * 过期后在设置页显示「需要重新授权」，授权需用户手势（按钮触发）。
 * 目录句柄存于 IndexedDB kv 仓库（可结构化克隆，localStorage 存不了）。
 */

import { toast } from 'sonner';
import { buildFullBackupZip } from '@/lib/export/backup';
import { idbGetKV, idbPutKV } from '@/lib/storage/idb';
import {
  encryptForBackup,
  isBackupEncryptionUnlocked,
  isLocalBackupEncryptionEnabled,
} from '@/lib/backup/crypto';
import { t } from '@/i18n';

const HANDLE_KEY = 'autoBackup:handle';
const LAST_KEY = 'autoBackup:lastTs';
/** 录音触发的最小间隔（防连续录音时每次都打包） */
const MIN_INTERVAL_MS = 60_000;
/** 启动触发间隔：距上次自动备份超过 7 天才写 */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** 带权限查询的目录句柄（TS 的 lib.dom 尚未收录 queryPermission/requestPermission） */
type PermHandle = FileSystemDirectoryHandle & {
  queryPermission?: (desc?: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (desc?: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
};

export interface AutoBackupState {
  supported: boolean;
  hasHandle: boolean;
  /** 'granted' = 可写；'prompt'/'denied' = 需重新授权；null = 无法查询 */
  permission: PermissionState | null;
  lastTs: number | null;
  /** 本地备份是否使用云备份口令加密 */
  encrypted: boolean;
  /** 已开启加密但本会话未解锁（此时自动备份会暂停） */
  locked: boolean;
}

/** 是否支持 File System Access API（仅 Chromium 系） */
export function isAutoBackupSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/** 打开目录选择器（需用户手势），成功后持久化句柄 */
export async function pickAutoBackupFolder(): Promise<boolean> {
  const picker = (window as unknown as {
    showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  }).showDirectoryPicker;
  if (!picker) return false;
  try {
    const handle = await picker.call(window, { mode: 'readwrite' });
    await idbPutKV(HANDLE_KEY, handle);
    return true;
  } catch (err) {
    // 用户取消选择是正常路径，不提示
    if ((err as Error)?.name !== 'AbortError') {
      console.warn('选择备份文件夹失败:', err);
    }
    return false;
  }
}

/** 读取自动备份当前状态（设置页展示用） */
export async function getAutoBackupState(): Promise<AutoBackupState> {
  if (!isAutoBackupSupported()) {
    return { supported: false, hasHandle: false, permission: null, lastTs: null, encrypted: false, locked: false };
  }
  const handle = (await idbGetKV<PermHandle>(HANDLE_KEY)) ?? null;
  let permission: PermissionState | null = null;
  if (handle?.queryPermission) {
    try {
      permission = await handle.queryPermission({ mode: 'readwrite' });
    } catch {
      permission = null;
    }
  }
  const lastTs = (await idbGetKV<number>(LAST_KEY)) ?? null;
  const encrypted = await isLocalBackupEncryptionEnabled();
  return {
    supported: true,
    hasHandle: handle != null,
    permission,
    lastTs,
    encrypted,
    locked: encrypted && !isBackupEncryptionUnlocked(),
  };
}

/** 重新授权已保存的目录（需用户手势，由设置页按钮调用） */
export async function requestAutoBackupPermission(): Promise<boolean> {
  const handle = await idbGetKV<PermHandle>(HANDLE_KEY);
  if (!handle?.requestPermission) return false;
  try {
    return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

/** 执行一次写入（含 toast 反馈）；授权缺失时静默跳过，由设置页状态行提示 */
async function writeBackup(silentSkip: boolean): Promise<void> {
  const handle = await idbGetKV<PermHandle>(HANDLE_KEY);
  if (!handle) return;
  const perm = handle.queryPermission
    ? await handle.queryPermission({ mode: 'readwrite' }).catch(() => 'denied' as PermissionState)
    : 'granted';
  if (perm !== 'granted') {
    if (!silentSkip) toast.error(t('toast.autoBackupNeedAuth'));
    return;
  }
  // 先看锁定态：加密开启但未解锁时没必要构建整个 ZIP（大历史会明显卡顿）
  let encrypted = await isLocalBackupEncryptionEnabled();
  if (encrypted && !isBackupEncryptionUnlocked()) {
    // 已选择加密但本会话还没解锁：不写明文，等用户在数据页解锁后手动/下次自动备份
    if (!silentSkip) toast.error(t('toast.autoBackupNeedUnlock'));
    return;
  }
  const built = await buildFullBackupZip();
  if (!built) return;
  // 构建期间设置可能变化：写入前再确认一次，避免刚开启加密却写出明文
  encrypted = await isLocalBackupEncryptionEnabled();
  if (encrypted && !isBackupEncryptionUnlocked()) {
    if (!silentSkip) toast.error(t('toast.autoBackupNeedUnlock'));
    return;
  }
  const filename = encrypted ? built.filename.replace(/\.zip$/, '.svtz') : built.filename;
  const blob = encrypted
    ? new Blob([await encryptForBackup(new Uint8Array(await built.blob.arrayBuffer()))], {
      type: 'application/octet-stream',
    })
    : built.blob;
  const file = await handle.getFileHandle(filename, { create: true });
  const writable = await file.createWritable();
  await writable.write(blob);
  await writable.close();
  await idbPutKV(LAST_KEY, Date.now());
  toast.success(t(encrypted ? 'toast.autoBackupDoneEncrypted' : 'toast.autoBackupDone'));
}

let lastRun = 0;

/**
 * 触发自动备份（fire-and-forget，失败只 toast 不打断主流程）
 * @param trigger record = 录音落库后（1 分钟节流）；launch = 应用启动（距上次 ≥7 天）
 */
export async function maybeAutoBackup(trigger: 'record' | 'launch'): Promise<void> {
  if (!isAutoBackupSupported()) return;
  const now = Date.now();
  if (trigger === 'record' && now - lastRun < MIN_INTERVAL_MS) return;
  lastRun = now;
  try {
    if (trigger === 'launch') {
      const lastTs = (await idbGetKV<number>(LAST_KEY)) ?? 0;
      if (now - lastTs < WEEK_MS) return;
    }
    await writeBackup(true);
  } catch (err) {
    console.warn('本地自动备份失败:', err);
    toast.error(t('toast.autoBackupFail'));
  }
}

/** 手动「立即备份」（不受节流与周期间隔限制，供设置页按钮调用） */
export async function runAutoBackupNow(): Promise<void> {
  if (!isAutoBackupSupported()) return;
  try {
    await writeBackup(false);
  } catch (err) {
    console.warn('本地自动备份失败:', err);
    toast.error(t('toast.autoBackupFail'));
  }
}
