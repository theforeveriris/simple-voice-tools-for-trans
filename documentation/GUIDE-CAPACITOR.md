# Capacitor 安卓壳（GUIDE-CAPACITOR）

用 Capacitor 把现有 Web 应用原样打包为安卓 App：**Web 代码 100% 复用**，
壳层只做权限、分享接收、通知、系统栏适配、应用快捷方式五件事。

## 架构总览

```
浏览器 PWA  ←─ 同一份 Vite 构建（docs/）→  Capacitor WebView（https://localhost）
                                        ├─ 麦克风：RECORD_AUDIO 权限 + WebView getUserMedia 桥
                                        ├─ 分享接收：ShareTargetPlugin（Java）→ Web 导入管线
                                        ├─ 提醒通知：@capacitor/local-notifications
                                        └─ 应用快捷方式：AppShortcutPlugin（长按图标深链页签）
```

Web 层平台分支的主要入口是 `src/lib/platform.ts` 的 `isNative`
（`Capacitor.isNativePlatform()`；同文件还有 `isTauri` 供桌面壳分支）。
浏览器里恒为 `false`，所有 Web 行为不变：

| 能力 | 浏览器 PWA | 原生壳 |
| --- | --- | --- |
| Service Worker | 注册 SW（`main.tsx` 手动注册） | 跳过 |
| 检查更新 | 比对线上 `version.json` | 比对 GitHub Releases 最新 APK（`lib/appUpdate.ts`），新版本给下载按钮，浏览器下载后覆盖安装（数据保留） |
| 设置 → 应用 | 安装入口 / 检查更新 / 清缓存可见 | 隐藏安装入口 / SW 状态 / 清缓存重置；版本、检查更新、分享应用、诊断信息可见 |
| 应用快捷方式 | manifest shortcuts（长按图标） | `AppShortcutPlugin`：静态 shortcuts 深链录音 / 历史 / 设置（同一套 `#/hash` 语义） |
| 「分享到」 | manifest share_target（SW 拦截 POST） | `ShareTargetPlugin` 收 SEND intent → 缓存目录 → 事件给 Web |
| 练习提醒 | Web Notification | `LocalNotifications.schedule`（即时展示） |
| 其余（Web Audio / MediaRecorder / IndexedDB / vibrate / clipboard） | — | WebView 原样可用，无分支 |

## 日常开发流

```bash
npm run cap:sync   # = npm run build + npx cap sync android（构建产物拷入 android 工程）
npm run cap:open   # 用 Android Studio 打开 android/，真机 Run 即可
```

改动 Web 代码 → `npm run cap:sync` → Android Studio 里重新 Run。
改原生代码（manifest / 插件）→ Android Studio 里直接 Run（无需 sync）。

## 版本号（与 PWA 同源）

`android/app/build.gradle` 直接读仓库根的 `package.json`：
`versionName` = semver 原值，`versionCode` = `major*10000 + minor*100 + patch`
（如 0.9.0 → 900）。**改版本只改 package.json**，Android 侧自动跟随；
只要 semver 正常递增，versionCode 单调递增（应用内更新覆盖安装的前提）。

## CI/CD（GitHub Actions）

`.github/workflows/android-release.yml`：

- **推送到 main**：跑 vitest → vite build → cap sync → gradle 构建——三个签名
  secrets 齐全时 `assembleRelease`（产出 `SimpleVoiceToolForTrans-v{版本}-release.apk`），
  否则回退 debug 签名；APK 传到 **`latest` 预发布**（滚动替换并清理旧版本 .apk，
  固定下载入口：`github.com/theforeveriris/simple-voice-tools-for-trans/releases/latest`）。
- **推送 `v*` 标签**（如 `git tag v0.8.0 && git push origin v0.8.0`）：同样流程，
  但创建**正式 Release**。
- 手动触发：Actions 页 `workflow_dispatch`。

**签名（当前为条件化）**：

- 三个 secrets（`ANDROID_KEYSTORE` / `ANDROID_KEYSTORE_PASSWORD` /
  `ANDROID_KEY_ALIAS`）**未配置**时：CI 用仓库内固定的 `android/ci-debug.keystore`
  （密码 android，仅 debug 用途）产出 **debug 签名** APK——签名跨构建一致，
  可直接覆盖安装。本机构建的 APK 用本机 debug keystore，与 CI 构建签名不同，
  互相覆盖前需先卸载（会丢数据，先做 ZIP 备份）。
- **配置 secrets 后**：CI 解码出 `android/app/upload-keystore.jks` +
  `android/key.properties`（二者均在 android/.gitignore），`build.gradle` 挂上
  signingConfig，改跑 `assembleRelease`，产出 **release 正式签名** APK
  （`SimpleVoiceToolForTrans-v{版本}-release.apk`）。

  正式签名升级步骤：本地 `keytool -genkeypair -v -keystore svt-release.jks
  -storetype PKCS12 -alias svt-release -keyalg RSA -keysize 4096 -validity 10950`
  （**keystore 自行保管，绝不入库**），`base64 -w0 svt-release.jks` 存入
  secrets `ANDROID_KEYSTORE`，密码/别名存 `ANDROID_KEYSTORE_PASSWORD` /
  `ANDROID_KEY_ALIAS`。⚠️ debug→release 是签名身份变更：已装 debug 版的用户
  必须卸载重装（本地 IndexedDB 数据会清空，重装前先做 ZIP 完整备份、装好后恢复），
  公告时机选在用户少的阶段。F-Droid 主库渠道由 F-Droid 自己的钥匙签名，
  与本渠道（GitHub Releases / IzzyOnDroid）天然不同签名，互不通用。

## 本机构建发布 APK / AAB

```bash
npm run cap:sync
cd android
JAVA_HOME=<JDK21路径> ./gradlew assembleDebug    # 调试 APK：app/build/outputs/apk/debug/
JAVA_HOME=<JDK21路径> ./gradlew assembleRelease  # 需先配置签名（见下）
```

签名（发布用）：生成 keystore 后在 `android/key.properties`（勿提交）配置
storeFile/storePassword/keyAlias/keyPassword，并在 `android/app/build.gradle`
挂 signingConfigs——或直接用 Android Studio 的 Generate Signed Bundle。

首次真机验证清单：
- [ ] 三种录音模式（系统弹麦克风权限 → 同意后波形正常）
- [ ] 分析页图表 / 回放 / 语谱图
- [ ] 系统「分享到」音频文件（微信语音导出 / 文件管理器）→ 自动进分析页
- [ ] 练习提醒的测试通知（Android 13+ 首次会申请通知权限）
- [ ] 设置导出/导入、ZIP 备份恢复

## 原生分享接收（ShareTargetPlugin）

- `android/.../ShareTargetPlugin.java`：SEND / SEND_MULTIPLE 的音频流拷入
  `cacheDir/share-target`（沿用来源文件名）。Web 先挂监听再调 `start()` 握手：
  握手返回积压批次（应用未启动期间的分享），之后到达的分享经
  `shareTargetReceived` 事件实时推送（无丢失、无重复）。
- Web 侧：`src/lib/platform.ts` 的 `ShareTarget` 绑定 + `App.tsx` 的监听 effect，
  与 PWA share target 共用 `importSharedFile()`（`analyzeAudioFile` 管线）。
- 缓存文件 24 小时后由插件自动清理。

## 应用快捷方式（AppShortcutPlugin）

长按桌面图标出现三个静态快捷方式（录音 / 历史 / 设置，文案随系统语言）：

- 原生侧：`android/.../res/xml/shortcuts.xml` 定义三个 VIEW intent
  （`simplevoicetool://open/#/test|#/history|#/settings`）；
  `AppShortcutPlugin` 冷启动经 `getInitialRoute()` 交出暂存路由，热启动推
  `shortcutRoute` 事件；`MainActivity` 在 onCreate / onNewIntent 分发。
- Web 侧：`main.tsx` 把路由落到对应页签；与 PWA manifest shortcuts 共用
  同一套 `#/hash` 语义（见 GUIDE-PWA.md）。

## 快捷磁贴（Quick Settings tiles，API 24+）

下拉通知栏的磁贴编辑器里可添加三枚磁贴（测试录音 / 历史 / 设置，文案随系统语言）：

- 原生侧：`RouteTileService`（TileService 基类，点击以 `simplevoicetool://open/#/…`
  VIEW intent 拉起 MainActivity）+ 三个路由写死的空壳子类
  （`RecordTileService` / `HistoryTileService` / `SettingsTileService`），
  路由复用 AppShortcutPlugin 的同一分发链（冷启动暂存 / 热启动推事件）。
- 用户在系统磁贴编辑器中自由增删与排序（TileService 标准行为）；
  minSdk 23 的更旧设备上系统不会实例化（TileService 本身即 API 24），
  无兼容成本。

## 系统栏配色跟随主题（SystemBarsPlugin）

Android 15 强制 edge-to-edge，`statusBarColor` 被忽略；WebView 被
`adjustMarginsForEdgeToEdge` 收窄后，状态栏/手势条露出的区域显示 DecorView 背景
（模板默认白色 → 曾出现「状态栏常驻白色」）。`SystemBarsPlugin.setColors
({ color, dark })` 直接涂 DecorView（兼容旧版 setColor 途径），并根据底色亮度
切换系统图标明暗。Web 侧 `syncNativeSystemBars()` 读 body 计算背景，在
`main.tsx`（首帧）与 App 主题 effect（每次主题变化，含深浅切换 / 自定义色相 /
骄傲旗）调用，因此状态栏与莫奈动态色板实时一致。


## 应用内更新检查（appUpdate.ts）

侧载渠道没有应用商店推送，`lib/appUpdate.ts` 在原生壳内实现更新提示：

- 设置 → 应用 → 检查更新：拉取
  `api.github.com/repos/theforeveriris/simple-voice-tools-for-trans/releases`，
  从 APK 资产名解析最高 semver 与 `__APP_VERSION__` 比对；
- 发现新版本 → 提供 APK 下载入口（系统浏览器下载 `SimpleVoiceToolForTrans-v*-release.apk`
  后覆盖安装；正式签名一致，数据保留）；
- 仅原生壳可用（`isNative` 门控）；PWA 走 `version.json` 更新流，桌面端无此机制。

## 已知限制 / 后续可选

- **导出下载**：`a[download]`（报告 PNG / CSV）在 WebView 里走系统下载管理器，
  行为与浏览器略有差异；若需系统分享面板，接 `@capacitor/share` +
  `@capacitor/filesystem`（shareCard / file.ts 两处调用点）。
- **本地自动备份**（File System Access）：Android WebView 不支持，功能自动隐藏；
  需要时换 `@capacitor/filesystem`。
- **应用图标 / 启动页**：图标已替换为自有设计（与 `src-tauri/icons` 同源，见
  `feat(icons)` 提交）。启动页为 Web 层实现（`SplashScreen.tsx`，最短驻留 +
  淡出，设置 → 配置 可关），原生侧只保留纯色窗口底（`launch_background`，
  API 31+ 另在 `values-v31` 统一系统启动画面底色）；旧的图片式 `splash.png`
  已移除。若要恢复图片式原生启动图：`npm i -D @capacitor/assets`，按约定放
  `assets/icon-only.png` 与 `assets/splash.png`，`npx capacitor-assets
  generate --android`，并把 `styles.xml` 的 windowBackground 指回
  `@drawable/splash`。
- **PWA 与原生数据不互通**：两侧 IndexedDB 独立，迁移走设置里的 ZIP 备份/恢复。
- **aiLocale 的 AI 翻译 / 大模型建议**：纯 HTTP，无需额外配置，直接可用。

## 常见问题

- **麦克风不弹权限**：确认 manifest 有 `RECORD_AUDIO`（已加）。Capacitor 的
  BridgeWebChromeClient 会把 WebView 的 getUserMedia 请求映射为运行时权限弹窗；
  若极老机型仍不弹，兜底方案是加一个请求运行时权限的小插件（未预置）。
- **Node 版本**：Capacitor 7 要求 Node ≥ 20。
- **gradle 报 SDK 找不到**：`android/local.properties` 的 `sdk.dir`（本机已配置，
  该文件不提交）。
- **Gradle 发行包下载超时**：`services.gradle.org` 在国内网络常超时，
  `gradle/wrapper/gradle-wrapper.properties` 已改用腾讯云镜像（附注释，可换回官方源）。
- **路径含中文报错**：AGP 检测到非 ASCII 路径会拒绝构建；
  `android/gradle.properties` 已加 `android.overridePathCheck=true`（官方开关）。
- **「无效的源发行版：21」**：Capacitor 7 需要 JDK 21 编译；命令行构建时若
  `JAVA_HOME` 指向 JDK 17 会报此错。指定 JDK 21 再跑：
  `JAVA_HOME=<JDK21路径> ./gradlew assembleDebug`（Android Studio 内构建不受影响，
  其自带 JBR 21）。
