/**
 * 桌面本地只读 API 的前端桥。
 * 数据仍在 WebView 的 IndexedDB：前端把完整记录快照推给 Rust，
 * Rust 只负责在 127.0.0.1 上提供只读 HTTP。服务默认关闭，token 每次启动重新生成。
 */

import { isTauri } from '@/lib/platform';
import { buildRecordsPayload } from '@/lib/export/backup';
import { useHistoryStore } from '@/store/useHistoryStore';

export interface LocalApiStatus {
  running: boolean;
  url?: string | null;
  token?: string | null;
}

interface TauriInternals {
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

let running = false;
/** 用户意图：停止后，未完成的 start 不能再把服务拉起来 */
let wantedRunning = false;

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const internals = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  if (!internals?.invoke) return Promise.reject(new Error('Tauri invoke unavailable'));
  return internals.invoke<T>(cmd, args);
}

async function buildSnapshot(): Promise<string> {
  const records = await useHistoryStore.getState().getAllRecords();
  return JSON.stringify(buildRecordsPayload(records));
}

export function isLocalApiRunning(): boolean {
  return running;
}

export async function getLocalApiStatus(): Promise<LocalApiStatus> {
  if (!isTauri) return { running: false };
  try {
    const status = await invoke<LocalApiStatus>('local_api_status');
    running = status.running;
    wantedRunning = status.running;
    return status;
  } catch {
    running = false;
    return { running: false };
  }
}

export async function startLocalApi(): Promise<LocalApiStatus> {
  if (!isTauri) throw new Error('Local API is only available in the desktop app');
  wantedRunning = true;
  const snapshotJson = await buildSnapshot();
  // 构建快照期间可能已锁定 / 停止：不要再启动
  if (!wantedRunning) return { running: false };
  const status = await invoke<LocalApiStatus>('local_api_start', { snapshotJson });
  if (!wantedRunning) {
    // start 与 stop 竞态：start 先落地，立刻补一次 stop
    try {
      await invoke('local_api_stop');
    } catch {
      /* ignore */
    }
    running = false;
    return { running: false };
  }
  running = status.running;
  return status;
}

export async function stopLocalApi(): Promise<void> {
  wantedRunning = false;
  if (!isTauri) return;
  try {
    await invoke('local_api_stop');
  } finally {
    running = false;
  }
}

/** 记录变化时刷新快照；服务未启动时直接跳过 */
export async function pushLocalApiSnapshot(): Promise<void> {
  if (!isTauri || !running) return;
  try {
    const snapshotJson = await buildSnapshot();
    running = await invoke<boolean>('local_api_update', { snapshotJson });
  } catch {
    running = false;
  }
}
