/**
 * Android 壳内的版本检查与更新（侧载渠道）
 *
 * 当前版本：构建注入的 __APP_VERSION__（package.json 单一来源，与 gradle
 * versionName 同源同值，见 android/app/build.gradle）。
 * 远端版本：GitHub Releases——滚动「latest」预发布（每次 push 覆盖）与 v*
 * 正式发布统一处理，从 APK 资产名（SimpleVoiceToolForTrans-v{semver}-debug.apk）
 * 解析版本，同 release 内多资产取最高，多 release 间也取最高（正式发布
 * 与滚动发布并列时优先非预发布）。
 *
 * 「更新」动作 = 在系统浏览器打开 APK 下载链接：侧载渠道无法在壳内静默
 * 替换已安装的 APK，浏览器下载后由用户手动覆盖安装是标准流程
 * （WebView 存储 / IndexedDB 数据在覆盖安装后保留）。
 */

import { isNative } from './platform';

const RELEASES_API = 'https://api.github.com/repos/theforeveriris/simple-voice-tools-for-trans/releases';
const REQUEST_TIMEOUT_MS = 15_000;

/** 单个可更新的 APK 入口 */
export interface NativeUpdateInfo {
  /** '0.8.0' 形式的远端版本 */
  version: string;
  /** APK 直链（releases/download/…） */
  apkUrl: string;
  /** Release 页面（下载失败 / 想看说明时的兜底入口） */
  htmlUrl: string;
  /** 是否预发布（滚动 latest 恒为 true） */
  prerelease: boolean;
}

export type NativeUpdateCheck = 'unavailable' | 'latest' | { update: NativeUpdateInfo };

/** 解析 '0.8.0' → [0, 8, 0]；非法返回 null（忽略 -rc1 之类后缀） */
export function parseSemver(v: string): [number, number, number] | null {
  const m = v.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** a > b → 1；a < b → -1；相等 → 0；任一非法 → null */
export function compareSemver(a: string, b: string): number | null {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

/** GitHub Release 的最小形状（测试与解析用） */
export interface ReleaseLike {
  tag_name?: string;
  html_url?: string;
  prerelease?: boolean;
  draft?: boolean;
  assets?: { name?: string; browser_download_url?: string }[];
}

/** 三段版本号逐段比较：a 是否严格大于 b */
function semverGreater(a: [number, number, number], b: [number, number, number]): boolean {
  return a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
}

/** 从单个 release 解析可更新入口；draft / 无 APK 资产 / 无版本号 → null */
export function releaseToUpdate(release: ReleaseLike): NativeUpdateInfo | null {
  if (release.draft) return null;
  // APK 资产里带版本的取最高——版本与直链必须出自同一资产（换版本后旧资产可能残留）
  const candidates = (release.assets ?? [])
    .filter((a) => /\.apk$/i.test(a.name ?? '') && a.browser_download_url)
    .map((a) => {
      const m = (a.name ?? '').match(/v(\d+)\.(\d+)\.(\d+)/);
      return m
        ? { url: a.browser_download_url as string, v: [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number] }
        : null;
    })
    .filter((x): x is { url: string; v: [number, number, number] } => x != null);
  let best = candidates.length > 0 ? candidates[0] : null;
  for (const c of candidates) if (semverGreater(c.v, best!.v)) best = c;

  // 资产名不带版本、但 tag 是 v{semver}（正式发布改名的兜底）
  if (!best) {
    const tag = release.tag_name ?? '';
    if (/^v\d+\.\d+\.\d+$/.test(tag)) {
      const apk = (release.assets ?? []).find((a) => /\.apk$/i.test(a.name ?? '') && a.browser_download_url);
      if (apk) {
        return {
          version: tag.slice(1),
          apkUrl: apk.browser_download_url as string,
          htmlUrl: release.html_url ?? '',
          prerelease: release.prerelease === true,
        };
      }
    }
    return null;
  }
  return {
    version: best.v.join('.'),
    apkUrl: best.url,
    htmlUrl: release.html_url ?? '',
    prerelease: release.prerelease === true,
  };
}

/** 从 release 列表挑出「最新」入口：版本最高；同版本时正式发布优先于预发布 */
export function pickLatestRelease(releases: ReleaseLike[]): NativeUpdateInfo | null {
  let best: NativeUpdateInfo | null = null;
  for (const r of releases) {
    const info = releaseToUpdate(r);
    if (!info) continue;
    if (!best) {
      best = info;
      continue;
    }
    const cmp = compareSemver(info.version, best.version);
    if (cmp == null) continue;
    if (cmp > 0 || (cmp === 0 && best.prerelease && !info.prerelease)) best = info;
  }
  return best;
}

/**
 * 检查 Android 侧更新：拿 Releases 列表解析最新 APK，与当前安装版本比对。
 * - 非原生壳 → 'unavailable'
 * - 网络 / API 失败 / 列表里没有任何带版本的 APK → 'unavailable'
 * - 远端 ≤ 当前 → 'latest'
 * - 远端更高 → { update }
 */
export async function checkNativeAppUpdate(current = __APP_VERSION__): Promise<NativeUpdateCheck> {
  if (!isNative) return 'unavailable';
  try {
    const res = await fetch(`${RELEASES_API}?per_page=15`, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined,
    });
    if (!res.ok) return 'unavailable';
    const releases = (await res.json()) as ReleaseLike[];
    const best = pickLatestRelease(releases);
    if (!best) return 'unavailable';
    const cmp = compareSemver(best.version, current);
    if (cmp == null || cmp <= 0) return 'latest';
    return { update: best };
  } catch {
    return 'unavailable';
  }
}

/**
 * 打开 APK 下载：系统浏览器接管下载与安装。
 * 用隐藏 <a target="_blank"> 触发——与 GitHub 设备授权对话框打开
 * github.com/login/device 同一机制（Capacitor 把外链交给系统浏览器）。
 */
export function openApkDownload(info: NativeUpdateInfo): void {
  const a = document.createElement('a');
  a.href = info.apkUrl;
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
