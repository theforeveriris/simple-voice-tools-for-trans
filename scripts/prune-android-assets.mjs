/**
 * 清理 Android assets 里的 Web 专用资源
 *
 * Capacitor 把 docs/ 整个复制进 android/app/src/main/assets/public/。
 * 但原生壳里以下资源用不上（main.tsx 在 isNative 时不注册 Service Worker，
 * 分享走原生 ShareTarget 插件，Android 用 mipmap 图标而非 PWA 图标）：
 *
 *   sw.js / workbox-*.js  Service Worker（原生不注册）
 *   sw-custom.js          PWA Share Target 拦截（原生走插件）
 *   manifest.webmanifest  PWA 清单（原生壳不用）
 *   og-image.png          Open Graph 社交卡片（只给网页分享用）
 *   icon-512.png          PWA 512 图标（Android 用 mipmap）
 *   maskable-512.png      PWA maskable 图标（Android 用 mipmap）
 *   favicon.svg           浏览器标签页图标
 *
 * 只删 assets/public 里的副本，不动 docs/（Web 发布仍需要这些）。
 * 约省 550 KB APK 体积。
 *
 * 用法：npm run build && npx cap sync android && node scripts/prune-android-assets.mjs
 */

import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PUBLIC_DIR = join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'public');

/** 要删掉的 Web 专用文件 */
const PRUNE = [
  'sw.js',
  'sw-custom.js',
  'manifest.webmanifest',
  'og-image.png',
  'icon-512.png',
  'maskable-512.png',
  'favicon.svg',
];

if (!existsSync(PUBLIC_DIR)) {
  console.log('[prune-android-assets] 未找到 assets/public，跳过（先跑 npx cap sync android）');
  process.exit(0);
}

// workbox-*.js 由 workbox 插件生成，文件名带哈希
const files = readdirSync(PUBLIC_DIR);
const workbox = files.filter((f) => /^workbox-[\w-]+\.js$/.test(f));

let freed = 0;
const removed = [];
for (const name of [...PRUNE, ...workbox]) {
  const p = join(PUBLIC_DIR, name);
  if (!existsSync(p)) continue;
  freed += statSync(p).size;
  rmSync(p);
  removed.push(name);
}

if (removed.length) {
  console.log(`[prune-android-assets] 已删除 ${removed.length} 个 Web 专用文件（${(freed / 1024).toFixed(0)} KB）: ${removed.join(', ')}`);
} else {
  console.log('[prune-android-assets] 无需清理');
}
