# 开发者文档

Simple Voice Tool for Trans 的开发指南：架构、数据流、主题系统、动效模型与性能设计。
专题详解见文末文档索引（i18n / 主题 / 状态与持久化 / 设置子页 / PWA / Capacitor 安卓壳 /
Tauri 桌面版均有独立文档）。

## 15 分钟上手（贡献者）

目标：clone 后 15 分钟内跑起开发环境并跑通测试。

```bash
# 0. 环境：Node 20+（ LTS 即可）、npm 10+；Windows 构建桌面端另需 Rust toolchain
node -v

# 1. 安装依赖
npm install

# 2. 起开发服务器（Vite，默认 5173 端口；改 src 下文件热更新）
npm run dev

# 3. 跑测试（Vitest；无需浏览器环境）
npm test

# 只跑音频 DSP 相关测试（改动 src/lib/audio 时常用）
npx vitest run src/lib/audio

# 4. 类型检查（CI 同款，比 vite build 快，适合提交前自查）
npx tsc -b --force
```

不用麦克风也能调试：任意 URL 加 `?demo=1` 载入示例数据；
「设置 → 数据管理 → 导入音频」可以拖入任意音频文件走完整分析管线。

### 已知的环境坑

- **Windows 杀软拦截 esbuild**：`vite build` 在"rendering chunks"阶段报
  `remove ...\Temp\esbuild-*: Access is denied` —— 是火绒/360 等实时防护锁了
  esbuild 的临时二进制，与代码无关。把项目目录与 `%TEMP%` 加入白名单，
  或临时改用 `npx tsc -b && npx vitest run` 验证。
- **`npx update-browserslist-db@latest` 提示**：警告而已，可忽略；想清掉就跑一次。
- **长路径**：Windows 下若仓库放在超长路径里，Rust/Tauri 构建可能失败，
  建议放在短路径（如 `C:\dev\`）。

### 提交前自查

1. `npx tsc -b --force` 无错误；
2. `npm test` 全绿（25 个文件 162 例）；
3. 改了设置项/存储结构？检查 `documentation/ARCHITECTURE-STATE.md` 的键清单与迁移说明是否需要同步；
4. 改了算法参数默认值？`constants/index.ts` 与 `documentation/PARAMETERS-GUIDE.md` 必须同步（历史上出过错）。

更多专题（数据流 / 主题 / 动效 / 性能）见下文与文末文档索引。

## 项目概览

基于 Web Audio API 的语音测试与分析工具。对麦克风说话即可获得基频（音高）、
共振峰（F1/F2）、能量电平三条实时曲线，停止后生成统计报告，历史记录保存在
浏览器本地。

```
麦克风 ──► 录音引擎(每帧) ──► YIN 音高 ─┐
                       ├─► RMS 能量 ──┼─► 实时缓冲 ──► Canvas 图表 (rAF)
                       └─► LPC 共振峰 ─┘        │
                                               ▼ 停止
                                    分析记录(30Hz 降采样)
                                               │
                        ┌──────────────────────┤
                        ▼                      ▼
                   历史记录(IndexedDB)      分析页(统计+区间缩放)
```

## 技术栈

| 层 | 技术 |
| --- | --- |
| 框架 | React 19 + TypeScript（strict + verbatimModuleSyntax） |
| 构建 | Vite 7（`outDir: docs/`，`base: './'`，适配 GitHub Pages；vendor 分包见「构建与部署」） |
| 样式 | Tailwind CSS 3.4 + CSS 变量（莫奈动态色板） |
| 状态 | Zustand（主 store + 历史 store，persist 中间件） |
| 动效 | Framer Motion（layout / springs） |
| 音频 | Web Audio API：AnalyserNode + 自研 DSP（纯 TS，无音频依赖） |
| 可视化 | 原生 Canvas 2D（自绘，不依赖图表库） |
| 测试 | Vitest 3（DSP 黄金样本回归 + 导出/备份/LLM/i18n 完整性，25 个测试文件） |
| 原生壳 | Capacitor 7（Android APK）+ Tauri 2（Windows NSIS 安装包） |
| 图标/提示 | lucide-react / sonner；uqr（分享图二维码） |

## 目录结构

```
src/
├── components/
│   ├── ai/
│   │   └── AssistantPage.tsx     # AI 助手：独立全屏聊天页（多轮/分支/历史抽屉）
│   ├── charts/
│   │   ├── chartPainters.ts      # 图表共用 Canvas 画笔（音高/能量/共振峰/元音/VRP/十字线/目标区）
│   │   ├── SeriesChart.tsx       # 画布组件：live(实时滚动)/static(区间+十字线，支持键盘) 双模式
│   │   ├── DataTableView.tsx     # 图表数据表视图（真实表格、读屏可读、区间 TSV 复制）
│   │   ├── SpecChart.tsx         # 语谱图（静态，叠加 F1/F2 轨迹）
│   │   ├── TrendChart.tsx        # 跨记录趋势图（纵轴可切 基频/MPT/CPPS，支持数据表视图）
│   │   ├── DiaryHeatmap.tsx      # 用声日记热力图
│   │   ├── LiveSpectrum.tsx      # 实时频谱图（实验性）
│   │   ├── TimeRangeSelector.tsx # 双滑块时间轴（能量密度预览）
│   │   ├── MiniSpark.tsx         # 记录卡迷你波形
│   │   └── specPainter.ts        # 语谱绘制（offscreen 位图 + 伪彩色）
│   ├── history/
│   │   └── WeeklyReportCard.tsx  # AI 周报卡（历史趋势页底部）
│   ├── layout/
│   │   ├── BottomBar.tsx         # 悬浮底栏 + 录音圆球（纯 transform 运动模型 + 全局快捷键）
│   │   ├── SplashScreen.tsx      # 原生壳启动页（isNative 时渲染，设置可关）
│   │   ├── EmptyHero.tsx         # 空状态引导
│   │   ├── ErrorBoundary.tsx     # 页面级错误边界
│   │   └── ShortcutsHelpSheet.tsx# 快捷键帮助浮层（? 呼出）
│   ├── pages/
│   │   ├── TestPage.tsx          # 测试页（实时图表 + 录音圆球）
│   │   ├── AnalysisPage.tsx      # 分析页（概览/统计/图表/回放/音高算法对比/重算）
│   │   ├── HistoryPage.tsx       # 历史页（列表/趋势/日记热力图/多选/对比）
│   │   ├── SettingsPage.tsx      # 设置页（外壳 + 搜索索引 + 子页面分发）
│   │   ├── CompareSheet.tsx      # 两记录对比浮层（Δ 指标 + 曲线叠加）
│   │   ├── LiveSheetFrame.tsx    # 实时练习子页公共框架
│   │   ├── F0LiveSheet.tsx       # 实时练习子页 ×4（音高/元音落点/频谱/VRP）
│   │   ├── VowelLiveSheet.tsx
│   │   ├── SpecLiveSheet.tsx
│   │   └── VrpLiveSheet.tsx
│   ├── analysis/                 # 分析页卡片（HeroCard/StatsTables/SustainedCard/AdviceCard/
│   │                             #   PlaybackCard/BaselineStrip/ReanalyzeDialog/PitchAlgorithmCard/
│   │                             #   LlmResultView/NoteDialog/…）
│   ├── share/
│   │   └── ShareCardSheet.tsx    # 分享卡样式选择浮层（跟随主题/深色/浅色/极光 + 实时预览）
│   ├── settings/                 # 设置子页面与区块（见 ARCHITECTURE-SETTINGS.md）
│   │   ├── AppearancePage.tsx    # 外观（深浅/预设/骄傲旗参数/自定义背景图）
│   │   ├── LanguagePage.tsx      # 语言（内置 + AI 翻译 + 编辑词条 + 词典分享）
│   │   ├── AppPage.tsx           # 应用（安装/分享/版本/检查更新/运行状态/诊断）
│   │   ├── ConfigPage.tsx        # 配置（录音/训练/提醒/图表与回放/通用）
│   │   ├── LlmPage.tsx           # 大模型（AI 助手入口/模型配置/档案/提示词/用量）
│   │   ├── DataPage.tsx          # 数据管理（数据去向面板/存储用量/备份与恢复/WebDAV/导入导出）
│   │   ├── AdvancedPage.tsx      # 高级（功能开关/算法参数/脚本中心）
│   │   ├── PromptPage.tsx        # 提示词调节（LlmPage 的二级页）
│   │   ├── PrivacyPanel.tsx      # 数据去向面板（含 AI 请求日志）
│   │   ├── BackupEncryptionSection.tsx / BackupPassphraseDialog.tsx  # 云备份口令加密
│   │   ├── GithubBackupSection.tsx / ConnectGithubDialog.tsx         # GitHub 云备份
│   │   ├── GuideSheet.tsx / AboutTab.tsx  # 应用内使用说明（guide.md）与关于页
│   │   ├── EditStringsSheet.tsx  # 编辑词条浮层（用户自定义译文）
│   │   └── TrainingSection.tsx / RecordingSection.tsx / ReminderSection.tsx / StorageUsage.tsx 等
│   └── ui/                       # shadcn/radix 基础组件（按需使用）
├── hooks/
│   ├── useLiveCanvas.ts          # 实时画布尺寸自适应（回调 ref + ResizeObserver）
│   ├── useDeferredMount.ts       # 两帧延迟挂载（避开入场动画争主线程）
│   └── use-mobile.ts             # 断点判定
├── i18n/
│   ├── index.ts                  # 核心 t()：覆盖层→内置→AI→zh-CN 查找链 + 版本订阅
│   ├── hook.ts                   # useI18n：订阅 settings.language 与词典版本
│   ├── aiLocale.ts               # AI 翻译管线（生成/增量补全/术语表/词典分享）
│   ├── aiTranslateTask.ts        # AI 翻译后台任务（模块级单例状态机，切页不中断）
│   ├── zh-CN.ts 等 ×8            # 八语言词典（zh-CN 为基准，漂移测试强制一致）
│   ├── aiLocale.test.ts          # 术语表与分享格式单测
│   └── i18n.test.ts              # 词典漂移防护 + 覆盖层行为
├── lib/
│   ├── pwa.ts                    # 安装捕获 / 检查更新 / SW 状态 / 缓存重置
│   ├── appUpdate.ts              # 原生壳内更新检查（比对 GitHub Releases 最新 APK）
│   ├── platform.ts               # 平台判定与原生桥（isNative / isTauri / 插件绑定）
│   ├── backNav.ts                # 子页返回手势栈
│   ├── llm.ts                    # 大模型调用（建议/周报/AI 翻译/AI 助手/连接测试共用；
│   │                             #   openai/anthropic 双协议、流式、思考过程）
│   ├── llmProfiles.ts / llmChats.ts / llmRequestLog.ts / llmResultStore.ts / llmUsage.ts
│   │                             # LLM 档案 / 助手对话 / 请求日志 / 结果缓存 / 用量统计
│   ├── seriesTable.ts            # 图表数据表取数与 TSV 导出
│   ├── advice.ts                 # 训练建议（本地规则引擎，纯函数）
│   ├── trendMetric.ts            # 趋势图纵轴指标（f0/mpt/cpps 取值规则）
│   ├── file.ts                   # 下载触发、音频扩展名→MIME
│   ├── reminder.ts               # 每日练习提醒（本地通知）
│   ├── audio/                    # 录音引擎与 DSP（见文末算法文档）
│   │   ├── recorder.ts           # 录音引擎单例（实时循环/记录生成/统计）
│   │   ├── pitch.ts / pitchAlt.ts# YIN / pYIN / MPM（模块级复用缓冲，零稳态分配）
│   │   ├── formants.ts           # LPC 共振峰（同为复用缓冲）
│   │   ├── voiceQuality.ts / cpp.ts # J/S/HNR / CPPS
│   │   ├── algoParams.ts         # 实验性算法参数单例（实时/离线/Worker 同步）
│   │   ├── reanalyze.ts          # 历史记录用当前算法参数重算（新旧对比后覆盖）
│   │   ├── analysisPipeline.ts / analysisWorker.ts / analysisClient.ts
│   │   │                         # 离线管线（Worker，PCM transfer 交付，32kHz 统一口径）
│   │   ├── importAudio.ts        # 外部音频导入（含 Share Target）
│   │   ├── pitchCompare.ts       # 音高算法对比（实验性）
│   │   ├── sustained.ts          # 长音指标（MPT/CV/衰减）
│   │   ├── golden.test.ts        # 黄金样本回归测试（源-滤波合成，精确真值）
│   │   └── demo.ts / spectrogram.ts / testHelpers.ts + 其余 *.test.ts
│   ├── backup/                   # github（设备流）/ webdav / local（目录句柄）/ crypto（AES-GCM）
│   ├── export/                   # csv / shareCard（PNG）/ backup（ZIP）/ settings / interactiveHtml / praat
│   ├── storage/
│   │   └── idb.ts                # IndexedDB：records / audio / kv（键清单见状态文档）
│   └── theme/
│       ├── monet.ts              # OKLCH 色板生成 + 预设（见 ARCHITECTURE-THEME.md）
│       ├── ambient.ts            # 氛围彩蛋（声音染色 / 音量呼吸 / 极光时刻）
│       ├── bgImage.ts            # 自定义背景图（压缩/存储/恢复）
│       └── dynamic.ts            # Material You：原生壳内壁纸取色写入莫奈三滑条
├── store/
│   ├── useStore.ts               # 主状态 + settings 持久化（迁移/模块同步，见状态文档）
│   └── useHistoryStore.ts        # 记录（IDB 持久化，200 条界面截断）
├── types/index.ts                # 全部类型定义
├── constants/index.ts            # 音区/预设/默认设置/轴范围/PRIDE_FLAGS
├── fonts/                        # 自托管 Inter Tight / Roboto Mono（woff2，OFL 许可）
└── index.css                     # 全局样式与主题 CSS 变量
documentation/                    # 开发者与算法文档（本目录）
public/                           # 静态资源：favicon.svg、PWA 图标、sw-custom.js、guide.md、OGP
scripts/                          # generate-pwa-assets.py / generate-android-icons.py /
                                  #   generate-tauri-icons.py（Pillow 生成图片资源）
android/                          # Capacitor Android 工程（原生插件：分享接收/快捷方式/系统栏）
src-tauri/                        # Tauri Windows 工程（NSIS 安装包）
fastlane/                         # Google Play / IzzyOnDroid 商店元数据与截图
capacitor.config.ts               # Capacitor 配置（appId、Splash 等）
docs/                             # ⚠️ 构建产物输出目录（vite outDir，已 gitignore），勿手放文件
```

## 核心数据流

### 录音引擎（`lib/audio/recorder.ts`，单例）

- `start({ deviceId, maxDurationSec, silenceStopSec, targetRange, mode, saveAudio,
  micEnhance, audioBitrateKbps, onAutoStop })`：getUserMedia（关闭 AGC/NS/回声消除，
  保证原始音质）→ AudioContext + AnalyserNode（fftSize 4096）→ rAF 分析循环；
- 分析循环每帧：`getFloatTimeDomainData` → `rmsDb` → 电平高于
  `getAlgoParams().voicedGateDb`（默认 -55 dB，实验性可调）时跑当前音高算法
  （YIN / pYIN / MPM）→ 每 2 帧 `extractFormants`（LPC 开销大）→ 追加到实时缓冲
  （NaN 表示未检出）；
- 最长时长由循环内检查，触发 `onAutoStop` 回调（由 store 落库并跳转）；
- `stop()`：停止轨道/关闭上下文 → 缓冲 2:1 降采样（60fps→30Hz）→ NaN→null →
  `computeStats` 聚合 → 生成 `AnalysisRecord`。不足 1 秒返回 null（不保存）；
- `finishRecord(record)`：等待 MediaRecorder 冲刷 → `decodeAudioData` 解码 PCM →
  `computeVoiceQuality`（Jitter/Shimmer/HNR）+ `computeCpps`（倒谱峰突出度）→
  合并进 stats；音频 Blob 由调用方连同记录一起落库；
- 实时图表通过 `recorder.getLive()` 每帧直接读缓冲，**不经过 React 状态**（避免 60fps 重渲染）。

### 状态管理

- `useStore`：`currentTab` / `isRecording` / `currentAnalysis`（内存）/ `settings`（持久化）。
  录音的启动失败会抛出异常，由 RecordBall 捕获并 toast；
- `useHistoryStore`：`records`（新记录插头部）+ `hydrate` / `updateRecord`（备注）/
  增删清导入 / `getAllRecords()`（导出与备份的全量读）。IndexedDB（`svt` 库 v2，
  records / audio / kv 三个仓库）承载持久化；kv 仓库存放 GitHub 备份令牌等敏感态，
  不进 localStorage。写入失败降级为内存态并 toast；
- 长音静音自动停止：循环内检测静音时长超过 `silenceStopSec`（门限 -50 dB 硬编码）
  触发停止；滑音模式按 20 秒计时。

### 图表渲染

一套画笔多种模式：`chartPainters.paintChart(kind, ctx, w, h, series, t0, t1, showGrid,
showLabels, live, playheadT?, target?)`。
- **live**（测试页）：SeriesChart 挂 rAF 循环，每帧从 recorder 读缓冲，窗口宽度由
  设置 → 配置 → 图表与回放 的「实时窗口」控制（`liveWindowSec` ∈ 6/12/20，默认 12 秒），
  数据不足时轴固定从 0 开始，超出后滚动；
- **static**（分析页）：绑定 `series + [t0,t1]`，数据/尺寸变化时重绘一次；
  `playheadT` 用于回放进度头，`target` 叠加训练靶标带；
- 所有时间序列图表可切换 `DataTableView` 数据表视图（`lib/seriesTable.ts` 取数与 TSV）；
- 音高曲线按每段所在音高区间（`bandOf`）分段着色；网格为淡灰虚线；
  测试页 `showLabels=false`（纯图表），分析页 `true`（简约刻度）；
- 尺寸自适应：ResizeObserver 设置画布物理像素（DPR 缩放），父容器高度由页面布局给定。

## 主题系统（莫奈取色）

`lib/theme/monet.ts`：种子色相 hue → OKLCH 色彩空间生成全套 M3 风格令牌
（surface/card/ink/accent/accent-soft/line…），每个颜色写入两个 CSS 变量：

- `--c-x`：完整 `oklch()` 字符串（Canvas 画笔、CSS color-mix 使用）；
- `--c-x-rgb`：`"r g b"` 三元组（Tailwind 颜色定义 `rgb(var(--c-x-rgb) / <alpha-value>)`，
  使 `bg-accent/35` 这类透明度修饰符可用）。

`applyTheme(hue, dark, accentHue?, spec?, prideFlag?)` 的 `dark` 参数在 SCALE 表的
浅色/深色两组 L,C 参数间切换，生成对应明暗模式的全套令牌，并同时写入 shadcn 的
HSL 派生变量、`colorScheme` 与 `<meta name="theme-color">`；
`accentHue` 驱动双色调强调色，`spec` 为预设合成色板（骄傲旗等），`prideFlag` 挂接
旗帜类名与渐变参数。

应用时机：`main.tsx` 渲染前读取持久化设置解析 hue 与 dark，`applyTheme(savedHue, dark)`
（山桃红兜底）→ 原生壳内若壁纸取色（`lib/theme/dynamic.ts`）成功，用壁纸色相再次应用 →
App 内监听设置变化（hue / accentHue / darkHue / huePreset / prideFlag / theme，
含 system 明暗）重新应用；
`applyTheme` 完成后派发 `app:themechange` 事件，`chartPainters` 据此失效调色板缓存。
`index.css` 的 `:root` 保留一套 hue=15 的静态回退值（首帧防闪烁）。
新增主题相关颜色时：先在 `buildTokens` 加令牌，再到 `tailwind.config.js` 映射。
主题全貌见 ARCHITECTURE-THEME.md。

## 动效模型（底栏为何这样写）

底栏 + 录音圆球采用**纯 transform 运动模型**（详见 BottomBar.tsx 注释）：

- 小球 `position: absolute`（非分体时 `left: calc(100% + 12px)` 锚在底栏右缘，分体时
  锚在底栏中缝 `left: 50%`），从不占文档流，缩放进出零重排；
- 容器在测试页用 `animate={{ x: -32.5 }}` 左移（32.5 = 小球 53 + 间距 12 的一半），
  使"底栏+小球"组合视觉居中（`BALL_SIZE = 53`）；
- 页签标签宽度**瞬变**（只做 0.14s 透明度淡入）——若做 width 动画，底栏真实布局会
  每帧重排，与 `layout` FLIP 叠加产生"二次移动"；
- 页面切换：旧页即时卸载（不做退场动画）+ 新页仅入场动画；测试页图表延迟 300ms
  启动 rAF，避开底栏弹簧动画的主线程占用（Canvas 2D 绘制在主线程）。

## 性能设计决策

| 决策 | 原因 |
| --- | --- |
| 图表直接读引擎缓冲，不走 React 状态 | 60fps 重渲染整个页面代价过高 |
| LPC 每 2 帧一次 + EMA 平滑 | 求根较贵；30Hz 对共振峰曲线足够 |
| 存储 2:1 降采样（30Hz） | 体积减半，曲线视觉无损 |
| 记录/音频存 IndexedDB（200 条上限） | 绕开 localStorage 配额；音频 Blob 与记录同 id 关联 |
| 测试页图表延迟 300ms 挂载 | 保证底栏动画满帧（实测 p95 16.8ms） |
| 音高用 YIN 替代频谱谐波法 | 半音量化画不出平滑曲线（见算法文档） |

## 构建与部署

```bash
npm install       # 安装依赖
npm run dev       # 开发（默认 5173）
npm run build     # tsc -b && vite build → 输出到 docs/
npm run preview   # 本地预览构建产物
npm test          # vitest run（CI 同步执行；含 DSP 黄金样本回归与 i18n 键集校验）
npm run cap:sync  # build + npx cap sync android（Android 壳，见 GUIDE-CAPACITOR.md）
npm run tauri     # Tauri CLI（桌面壳，tauri dev / tauri build，见 GUIDE-DESKTOP.md）
```

- **部署**：push 到 `main` 后由 GitHub Actions 自动构建并发布 GitHub Pages
  （`.github/workflows/deploy.yml`），`docs/` 仅是本地构建产物（已 gitignore，不入库）；
- **CI**（`.github/workflows/ci.yml`）：PR 与 push 跑 vitest + build；
- **发布**（`.github/workflows/android-release.yml` / `desktop-release.yml`）：
  push 到 main 产出 APK（条件化签名）与 Windows NSIS 安装包，滚动进 `latest`
  预发布并清理旧版本资产；推 `v*` tag 时进正式 Release；
- PWA：`vite-plugin-pwa` 在构建时生成 `sw.js` + `manifest.webmanifest`（含
  shortcuts 应用快捷方式），`registerType: 'autoUpdate'` + Workbox 预缓存全部静态资源；
  注册脚本在 `main.tsx` 手动执行（原生壳内跳过）；同时生成 `version.json`
  构建清单（版本/构建时间），作为「检查更新」的比对依据；
- 构建优化：`vite.config.ts` 用 `manualChunks` 把 vendor / motion / react 拆为独立分包；
- `docs/` 构建时会被清空，**不要**把源文档放进去（源文档在 `documentation/`）；
- 体验示例数据：`?demo=1`（无痕体验分析页）或各页面的"载入示例数据"按钮；
- 麦克风 API 要求 HTTPS 或 localhost。

## 常见开发任务

- **加一个新页面**：`types.ViewType` 加 id → `BottomBar.TABS` 加项（lucide 图标）→
  `App.tsx` 分支渲染 → 新建 `components/pages/XxxPage.tsx`；
- **加一种图表**：`chartPainters.ts` 加画笔函数 + `paintChart` 分支 → `SeriesChart`
  的 `ChartKind` 联合类型加值 → 页面直接用 `<SeriesChart kind="xxx" />`；
- **调主题预设**：`lib/theme/monet.ts` 的 `THEME_PRESETS` 与各预设 spec
  （莫奈/骄傲旗/自定义背景图三卡见 ARCHITECTURE-THEME.md）；
- **调音高区间**：`constants/index.ts` 的音区边界（`DEFAULT_BAND_BOUNDS` +
  `getBandRanges()` / `setBandBounds()`，曲线着色、色带、统计占比共用同一来源）；
- **改录音参数**：`recorder.ts` 顶部常量（降采样率、LPC 节流）与 `constants/PITCH_AXIS` 等。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [ALGORITHM-YIN.md](./ALGORITHM-YIN.md) | 音高检测：差分函数、CMND、抛物线插值 |
| [ALGORITHM-FORMANT-LPC.md](./ALGORITHM-FORMANT-LPC.md) | 共振峰：预加重/抽取/LPC/求根全链路 |
| [ALGORITHM-ENERGY.md](./ALGORITHM-ENERGY.md) | 能量：RMS、分贝、VAD 门限体系 |
| [ALGORITHM-CPPS.md](./ALGORITHM-CPPS.md) | 倒谱峰突出度：实倒谱、回归线基线、时间平滑 |
| [ARCHITECTURE-I18N.md](./ARCHITECTURE-I18N.md) | i18n：查找链、覆盖层、AI 翻译管线与词典分享 |
| [ARCHITECTURE-THEME.md](./ARCHITECTURE-THEME.md) | 主题：OKLCH 令牌、骄傲旗预设、渐变参数、包含块陷阱 |
| [ARCHITECTURE-STATE.md](./ARCHITECTURE-STATE.md) | 状态与持久化：store、IndexedDB、键清单、迁移与降级 |
| [ARCHITECTURE-SETTINGS.md](./ARCHITECTURE-SETTINGS.md) | 设置页：子页面模式、搜索索引、新增子页步骤 |
| [GUIDE-PWA.md](./GUIDE-PWA.md) | PWA：更新流、版本注入、Share Target、修复工具 |
| [GUIDE-CAPACITOR.md](./GUIDE-CAPACITOR.md) | Capacitor 安卓壳：构建、签名、原生分享/快捷方式、已知限制 |
| [GUIDE-DESKTOP.md](./GUIDE-DESKTOP.md) | Tauri Windows 桌面版：构建、CI、平台差异 |
| [PARAMETERS-GUIDE.md](./PARAMETERS-GUIDE.md) | 参数说明书（面向使用者） |
| [REFERENCES.md](./REFERENCES.md) | 参考文献：参数区间与算法实现的文献出处（正文统一引用） |
| [README.md](../README.md) | 项目介绍与使用说明 |

应用内路径：**设置 → 关于**，其中「使用说明」可离线阅读（构建自 `public/guide.md`）；
开发者文档（本目录）在关于页提供 GitHub 源文件链接。
