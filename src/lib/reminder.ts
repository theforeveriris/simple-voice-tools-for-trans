/**
 * 每日练习提醒（本地通知，无推送服务）
 * 应用打开/在后台运行时每分钟检查：到点且当天还没有录音 → 发一条本地通知并标记当天已提醒；
 * 应用被打开（visibilitychange → visible）时补一次检查，覆盖「到点时应用刚打开」。
 * 应用被完全杀掉后无法唤醒（无推送服务的平台限制），设置页说明文案如实告知。
 *
 * 平台分支：原生壳（Capacitor）内 Web Notification 不可用，走 @capacitor/local-notifications；
 * 函数签名与语义在两端一致，调用方（ReminderSection / App 轮询）无需感知。
 */

import { LocalNotifications } from '@capacitor/local-notifications';
import type { PermissionStatus as NativePermissionStatus } from '@capacitor/local-notifications';

/** 插件权限态（含 prompt-with-rationale）→ Web NotificationPermission */
type NativePermissionState = NativePermissionStatus['display'];
import { isNative } from '@/lib/platform';
import { useHistoryStore } from '@/store/useHistoryStore';
import { t } from '@/i18n';

/** 原生通知固定 id：同 id 重复发送自动替换，模拟 Web 端 tag 去重 */
const NATIVE_NOTIF_ID = 4711;
const NATIVE_CHANNEL_ID = 'svt-reminder';
let channelReady = false;

/** 原生侧权限的同步近似值（checkPermissions 异步，挂载时缓存一次） */
let nativePermission: NotificationPermission = 'default';

if (isNative) {
  void LocalNotifications.checkPermissions()
    .then((s) => {
      nativePermission = mapNativePermission(s.display);
    })
    .catch(() => {});
}

function mapNativePermission(s: NativePermissionState): NotificationPermission {
  return s === 'granted' ? 'granted' : s === 'denied' ? 'denied' : 'default';
}

/** 原生通知渠道（需一次性创建；失败静默走插件默认渠道） */
async function ensureChannel(): Promise<void> {
  if (channelReady) return;
  try {
    await LocalNotifications.createChannel({
      id: NATIVE_CHANNEL_ID,
      name: 'Simple Voice Tool for Trans',
      importance: 3, // IMPORTANCE_DEFAULT
    });
    channelReady = true;
  } catch {
    channelReady = true;
  }
}

export function reminderSupported(): boolean {
  if (isNative) return true;
  return typeof Notification !== 'undefined';
}

export function reminderPermission(): NotificationPermission | 'unsupported' {
  return reminderSupported()
    ? isNative ? nativePermission : Notification.permission
    : 'unsupported';
}

/** 申请通知权限（已授权时直接返回）；不支持环境返回 'unsupported' */
export async function requestReminderPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!reminderSupported()) return 'unsupported';
  if (isNative) {
    try {
      const s = await LocalNotifications.requestPermissions();
      nativePermission = mapNativePermission(s.display);
      return nativePermission;
    } catch {
      return nativePermission;
    }
  }
  if (Notification.permission === 'granted') return 'granted';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** 'HH:mm' → { h, m }（越界值收敛到合法范围） */
export function parseReminderTime(s: string): { h: number; m: number } {
  const [h, m] = s.split(':').map((x) => Number(x) || 0);
  return { h: Math.max(0, Math.min(23, h)), m: Math.max(0, Math.min(59, m)) };
}

function hasRecordToday(): boolean {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return useHistoryStore.getState().records.some((r) => r.createdAt >= start.getTime());
}

/** 当天已提醒的标记（按日期滚动，隔天自动失效） */
function firedKey(): string {
  return `svt:reminder:fired:${new Date().toDateString()}`;
}

/** 发一条提醒通知；点击聚焦应用 */
export function showPracticeReminder(): void {
  if (!reminderSupported()) return;
  if (isNative) {
    void ensureChannel().then(() => LocalNotifications.schedule({
      notifications: [{
        id: NATIVE_NOTIF_ID,
        title: 'Simple Voice Tool for Trans',
        body: t('reminder.body'),
        channelId: NATIVE_CHANNEL_ID,
      }],
    })).catch(() => {});
    return;
  }
  void webNotify(t('reminder.body'));
}

/**
 * Web 端发通知：优先经 ServiceWorkerRegistration.showNotification——
 * Android Chrome（PWA 的主要形态）不允许直接 `new Notification()`（抛 Illegal constructor），
 * 只有在拿不到 Service Worker 注册时才回退到构造函数。
 */
async function webNotify(body: string): Promise<void> {
  const title = 'Simple Voice Tool for Trans';
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, { body, tag: 'svt-practice-reminder' });
      return;
    }
  } catch {
    /* 落到构造函数兜底 */
  }
  try {
    const n = new Notification(title, { body, tag: 'svt-practice-reminder' });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* 环境既不支持 SW 又不支持构造函数：静默失败（设置页已说明平台限制） */
  }
}

/**
 * 检查并（在满足条件时）发送提醒：
 * 已启用 + 已授权 + 当前时间已达提醒时刻 + 当天未提醒过 + 当天还没有录音。
 * 已练过也写标记：当天不再打扰。
 */
export function checkPracticeReminder(enabled: boolean, time: string): void {
  if (!enabled || reminderPermission() !== 'granted') return;
  const key = firedKey();
  // localStorage 在隐私模式 / 禁用 Cookie 时会抛异常，不能让轮询因此中断
  let fired = false;
  try {
    fired = !!localStorage.getItem(key);
  } catch {
    /* 读不到就不当成已提醒 */
  }
  if (fired) return;
  const now = new Date();
  const { h, m } = parseReminderTime(time);
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return;
  try {
    localStorage.setItem(key, '1');
  } catch {
    /* 写不进去会重复提醒，但不影响本次发送 */
  }
  if (hasRecordToday()) return;
  showPracticeReminder();
}
