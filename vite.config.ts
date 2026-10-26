import path from "path"
import { readFileSync } from "node:fs"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"
import { inspectAttr } from 'kimi-plugin-inspect-react'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }

// 本次构建的时间戳（毫秒）：define 注入页面 + version.json 双写必须同源同值，
// 检查更新以两者相等判定「页面运行的构建 = 线上构建」
const buildAt = Date.now()

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: './',
  build: {
    outDir: 'docs',
    // 主包分包：vendor 依赖与应用代码分离。应用代码每次发版都变，
    // 而 vendor 块在版本间通常不变——SW 预缓存增量更新时只需重新下载
    // 应用块，vendor 块命中旧缓存；浏览器解析执行也更快。
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('framer-motion')) return 'motion';
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('scheduler') || id.includes('use-sync-external-store')) return 'react';
          return 'vendor';
        },
      },
    },
  },
  // 版本号 / 构建日期注入（设置 → 应用 → 版本与更新 展示）
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    __BUILD_AT__: JSON.stringify(buildAt),
  },
  plugins: [
    // 开发期 DOM 检查辅助插件，不进生产构建
    ...(command === 'serve' ? [inspectAttr()] : []),
    react(),
    // 构建信息清单：检查更新 fetch 它与页面内的 __BUILD_AT__ 比对。
    // 故意不进 SW 预缓存（globPatterns 不含 json）——fetch 才能直达网络拿到线上最新
    {
      name: 'emit-version-json',
      apply: 'build',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ version: pkg.version, builtAt: buildAt }),
        })
      },
    },
    VitePWA({
      // SW 自动更新：新版本下载完成后下次加载生效
      registerType: 'autoUpdate',
      // 注册改为 main.tsx 手动执行（isNative 时跳过——原生壳内无 SW 支持）
      injectRegister: null,
      includeAssets: ['favicon.svg', 'og-image.png', 'privacy-policy.md'],
      manifest: {
        name: 'Simple Voice Tool for Trans',
        short_name: 'Simple Voice Tool for Trans',
        description: '基于 Web Audio API 的语音测试与分析工具：YIN 音高检测、LPC 共振峰提取、能量分析。',
        lang: 'zh-CN',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#FBF2F2',
        theme_color: '#FBF2F2',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // 长按图标快捷入口：hash 深链直达对应页签（App 启动时解析 location.hash）
        shortcuts: [
          {
            name: '开始录音',
            short_name: '录音',
            url: './index.html#/test',
            icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: '历史记录',
            short_name: '历史',
            url: './index.html#/history',
            icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: '设置',
            short_name: '设置',
            url: './index.html#/settings',
            icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
        // 系统分享入口：录音/语音文件「分享到」本应用后走离线分析管线
        // POST 由 public/sw-custom.js 拦截暂存并重定向回应用（?share-target=1）
        share_target: {
          action: './index.html?share-target=1',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            files: [
              {
                name: 'file',
                accept: ['audio/*', '.wav', '.mp3', '.m4a', '.aac', '.ogg', '.webm', '.amr', '.3gp'],
              },
            ],
          },
        },
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,md}'],
        navigateFallback: 'index.html',
        // Share Target 拦截（注册顺序先于 workbox 路由，POST 分享优先命中）
        importScripts: ['sw-custom.js'],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
