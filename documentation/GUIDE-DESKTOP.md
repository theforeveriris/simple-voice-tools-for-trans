# Tauri Windows 桌面版（GUIDE-DESKTOP）

用 Tauri v2 把同一份 Web 产物打包成 Windows 桌面应用：NSIS 安装包，
WebView2 内核（Windows 10/11 系统自带，Chromium 内核 → Web Audio /
AudioWorklet / MediaRecorder / IndexedDB 全部可用，与浏览器行为一致）。

## 日常开发流

```bash
npm run tauri dev     # 开发窗口（热更新，需要本机 Rust 工具链）
npm run tauri build   # 本地出包：src-tauri/target/release/bundle/nsis/*-setup.exe
```

前置：Rust 工具链（rustup，MSVC target）+ Node。只改 Web 代码时
`npm run build` 后 `npm run tauri dev` 即可；CI 是主要出包途径，本机构建非必需。

## CI（GitHub Actions）

`.github/workflows/desktop-release.yml`：windows-latest runner，
vitest → vite build → 版本号从 package.json 同步进 tauri.conf.json →
`npx tauri build`（Rust 缓存加速）→ 安装包
`SimpleVoiceToolForTrans-v{版本}-setup.exe` 上传到 `latest` 预发布（与安卓共用
同一个滚动 release；非 tag 推送时自动清理其中旧版本的 setup.exe；
打 `v*` 标签时进正式 Release）。

## 与其它端的平台差异

`src/lib/platform.ts` 的 `isTauri`（检测 `__TAURI_INTERNALS__`）：

- Service Worker / PWA 安装流在 Tauri 内跳过（自定义协议下 SW 不可靠，
  且桌面应用自带更新通道）；
- Capacitor 桥不存在：`isNative` 为 false，安卓的分享接收 / 系统栏配色 /
  壁纸取色 / 应用快捷方式均不激活（这些是 Android 专属）；
- 「检查更新」在桌面端恒报不支持——PWA 途径无 SW 注册、原生途径非 isNative，
  两边都不可用（更新靠重新下载安装包）；
- 麦克风：WebView2 会弹系统权限请求，允许即可；若遇到静默拒绝，
  需在 Rust 侧处理 WebView2 的 PermissionRequested 事件（未预置）。

## 已知限制 / 说明

- 布局为移动优先，桌面默认窗口 440×920（手机比例，可任意缩放）。
- 未内置自动更新（Tauri updater 可以后加：签名密钥 + 更新清单）。
- 仅打包 NSIS 安装包；要 msi / 便携版可在 `tauri.conf.json` 的
  `bundle.targets` 增加。
- 数据（IndexedDB）存在 WebView2 的用户数据目录，卸载应用不会删除数据。
