# PWA 指南（安装 / 更新 / 分享 / 修复）

本文描述 PWA 相关的全部机制：Service Worker 与更新流、版本注入、安装、
分享目标、诊断与修复工具。实现：`vite.config.ts`（VitePWA 配置）、
`public/sw-custom.js`、`src/lib/pwa.ts`、`components/settings/AppPage.tsx`。

## 构建与缓存

- `vite-plugin-pwa`，`registerType: 'autoUpdate'`：SW 更新下载完成后**下次加载
  生效**（skipWaiting + clientsClaim 由插件注入）；
- Workbox 预缓存 `**/*.{js,css,html,svg,png,woff2,md}`，`navigateFallback: index.html`；
- `importScripts: ['sw-custom.js']`：自定义 SW 先于 Workbox 路由注册；
- 产物输出 `docs/`（GitHub Pages），`base: './'` 相对路径。

**本地开发没有 SW**（devOptions 未开启），所有依赖注册的 UI 都有
'unavailable / 未注册' 降级分支——这也意味着检查更新等功能要在
`npm run build && npm run preview` 或线上才能验证。

## 版本注入（vite.config.ts）

```ts
define: {
  __APP_VERSION__: JSON.stringify(pkg.version),   // package.json 的 version
  __BUILD_DATE__: JSON.stringify(ISO 日期),         // 构建时刻
  __BUILD_AT__: JSON.stringify(buildAt),            // 毫秒时间戳，与 version.json.builtAt 同源双写
}
```

类型声明在 `src/vite-env.d.ts`。消费方：应用子页版本行、诊断信息、
更新检测（App.tsx）。

## 更新流（两条路径）

1. **自动**：每次加载页面，Workbox 检测 `sw.js` 字节差异 → 后台下载新 SW →
   skipWaiting 激活 → **下次加载**生效（autoUpdate 语义）。
2. **手动**（设置 → 应用 → 检查更新，`checkForAppUpdate`）：
   - `getRegistration()` → fetch 线上 `version.json`（构建时由 vite 插件产出，
     不在预缓存清单内，`no-store` + 时间戳参数绕过 HTTP 缓存）；
   - 比对 `builtAt` 与页面内的 `__BUILD_AT__`（同一次构建双写，必须一致）：
     **相同 → 「已是最新」**——autoUpdate（skipWaiting + clientsClaim）下新 SW
     部署后几秒内就装完激活，只轮询 `installing / waiting` 撞不上瞬态，
     会把「已部署未刷新」误报成最新（历史 bug）；
   - 不同 → `reg.update()`，监听 `controllerchange`（先于轮询挂好）+ 8s 兜底，
     新 SW 接管页面后 `location.reload()` → 启动时版本比对触发
     toast「应用已更新到 v{version}」；
   - 线上构建信息拉取失败 / 无 SW 注册 → 「当前环境不支持」。

### 更新内容卡（What's new）

- `App.tsx` 挂载时对比 `localStorage['svt:update-seen']` 与 `__APP_VERSION__`：
  升级（seen 存在且不同）→ toast 一次 + 写标记 `svt:update-notes-open = '1'`；
  无论是否升级都刷新 `svt:update-seen`。
- 应用子页读到该标记 → 「版本与更新」区顶部显示
  `settings.updateNotes` 卡片（每版本维护一段 i18n 文案，**发版时记得更新五语言**），
  点「知道了」清除标记。

## 修复工具（resetAppRuntime）

「清除缓存并重置」：`caches.keys()` 全删 + `getRegistrations()` 全 unregister +
`reload()`。用于更新链路卡死（旧 precache 顽固、白屏）。**IndexedDB
（记录与音频）不受影响**。确认对话框文案明确说明这一点。

## 安装（beforeinstallprompt）

- `initPwaInstall`（main.tsx 调用一次）捕获 `beforeinstallprompt` 并延迟展示；
  `appinstalled` 与 standalone 变化都会通知订阅者（`usePwaInstall`）。
- 应用子页安装行三种状态：已安装（禁用）/ 一键安装（触发浏览器弹窗）/
  手动安装（iOS Safari 等无 beforeinstallprompt 的环境展示指引文案）。
- manifest：`display: standalone`，shortcuts 深链录音 / 历史 / 设置
  （长按图标快捷入口，启动时解析 `location.hash`），`share_target` 见下。

## Share Target（系统分享 → 应用内分析）

移动端把音频文件「分享到 Simple Voice Tool for Trans」：

```
系统分享 POST ./index.html?share-target=1（multipart file 字段）
  → sw-custom.js 拦截：文件暂存 Cache API（svt-share-target / shared-audio）
  → 303 重定向回应用
  → App.tsx 挂载检测 ?share-target=1 → 立即 replaceState 清参数（防刷新重复）
  → takeSharedFile()（读走并删除缓存条目）
  → analyzeAudioFile（离线管线）→ 落库 → 跳分析页
```

`replaceState` 必须在读取前执行——StrictMode 双挂载靠它防重复消费。

## 诊断

应用子页「复制诊断信息」汇总：`__APP_VERSION__` / 构建日期 / standalone /
SW 状态 / 持久化存储 / 在线 / locale / UA → 剪贴板。剪贴板失败降级为
「请手动截图」toast。

## 演示模式

URL 加 `?demo=1` 且当前无历史记录时，生成一条示例记录并跳转分析页——
无麦克风环境体验用；已有数据不受影响。各页面也有「载入示例数据」按钮。

## 常见问题排查

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| 检查更新提示不支持 | 本地 dev 无 SW / 非 HTTPS | 用 `npm run preview` 或线上验证 |
| 更新后界面没变 | autoUpdate 下次加载生效 | 手动刷新一次，或设置 → 应用 → 检查更新 |
| 页面白屏 / 卡在旧版 | SW 精顽固缓存 | 清除缓存并重置 |
| 安装按钮禁用 | 已 standalone 或浏览器不支持 | 已安装是正常态；不支持看手动指引 |
| 分享入口不见 | 非 HTTPS / 浏览器不支持 | share_target 需安装 + HTTPS |
