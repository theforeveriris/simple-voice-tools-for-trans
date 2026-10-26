/**
 * PWA Share Target 拦截（与 vite.config.ts 的 manifest.share_target 配套）
 * 系统「分享到 Simple Voice Tool for Trans」的音频文件以 POST 到达这里：
 * 把文件暂存进 Cache API，再 303 重定向到应用；应用启动时检测
 * ?share-target=1 并从 Cache 取走文件走离线分析管线（src/lib/audio/importAudio.ts）。
 * 本脚本经 workbox generateSW 的 importScripts 注入主 SW，注册顺序先于
 * workbox 路由，因此 POST 分享导航会优先命中本监听。
 */
/* global caches, Response */

const SHARE_CACHE = 'svt-share-target';
const SHARE_ENTRY = 'shared-audio';

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'POST') return;
  const url = new URL(event.request.url);
  if (!url.search.includes('share-target=1')) return;

  event.respondWith((async () => {
    try {
      const form = await event.request.formData();
      const file = form.get('file');
      if (file && typeof file !== 'string') {
        const cache = await caches.open(SHARE_CACHE);
        await cache.put(SHARE_ENTRY, new Response(file, {
          headers: {
            'content-type': file.type || 'application/octet-stream',
            'x-file-name': encodeURIComponent(file.name || 'shared-audio'),
          },
        }));
      }
    } catch (err) {
      // 暂存失败也照常进入应用（仅提示无文件可处理）
    }
    return Response.redirect(url.origin + url.pathname + '?share-target=1', 303);
  })());
});
