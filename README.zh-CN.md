<div align="center">

<img src="fastlane/metadata/android/images/icon.png" width="96" alt="Simple Voice Tool for Trans 应用图标">

# Simple Voice Tool for Trans

[English](README.md) · 简体中文

<img src="fastlane/metadata/android/images/featureGraphic.png" width="620" alt="Simple Voice Tool for Trans — Measure · Analyze · Track your voice">

[![Release](https://img.shields.io/github/v/release/theforeveriris/simple-voice-tools-for-trans)](https://github.com/theforeveriris/simple-voice-tools-for-trans/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/theforeveriris/simple-voice-tools-for-trans/deploy.yml?branch=main&label=CI)](https://github.com/theforeveriris/simple-voice-tools-for-trans/actions/workflows/deploy.yml)
[![License](https://img.shields.io/github/license/theforeveriris/simple-voice-tools-for-trans)](LICENSE)
[![Android](https://img.shields.io/badge/Android-APK-3DDC84?logo=android&logoColor=white)](https://github.com/theforeveriris/simple-voice-tools-for-trans/releases/latest)
[![Windows](https://img.shields.io/badge/Windows-Setup.exe-0078D6?logo=windows&logoColor=white)](https://github.com/theforeveriris/simple-voice-tools-for-trans/releases/latest)
[![PWA](https://img.shields.io/badge/PWA-Installable-5A0FC8?logo=pwa&logoColor=white)](https://theforeveriris.github.io/simple-voice-tools-for-trans/)

</div>

## 项目简介

一个基于 Web Audio API 的语音测试与分析工具。对着麦克风说几句话，即可获得
基频（音高）、共振峰（F1/F2）、能量电平的完整曲线与统计报告，并了解自己的
嗓音在男/女声音域区间中所处的位置。

## 获取应用

> **先体验再安装——无需安装、无需麦克风**：打开
> [网页演示](https://theforeveriris.github.io/simple-voice-tools-for-trans/?demo=1)
> （自动载入示例数据；喜欢再随时「安装到主屏幕」）。

[<img src=".github/assets/obtainium-badge.png" alt="Get it on Obtainium" height="56">](https://apps.obtainium.imranr.dev/redirect?r=obtainium%3A%2F%2Fapp%2F%257B%2522id%2522%253A%2522github.com.theforeveriris.simple-voice-tools-for-trans%2522%252C%2522url%2522%253A%2522https%253A%252F%252Fgithub.com%252Ftheforeveriris%252Fsimple-voice-tools-for-trans%2522%252C%2522author%2522%253A%2522theforeveriris%2522%252C%2522name%2522%253A%2522simple-voice-tools-for-trans%2522%257D)

- **安卓 APK**：从 [GitHub Releases](https://github.com/theforeveriris/simple-voice-tools-for-trans/releases/latest)
  下载最新的 `SimpleVoiceToolForTrans-v*-release.apk` 直接安装（正式签名，含应用内更新提示）
- **Obtainium**：已安装 [Obtainium](https://github.com/ImranR98/Obtainium) 的话，
  点上方徽章即可添加本仓库，新版本自动跟进
- **PWA**：浏览器访问
  [在线版本](https://theforeveriris.github.io/simple-voice-tools-for-trans/)，
  通过「安装到主屏幕」使用（支持离线缓存，与 APK 版数据互相独立）
- **Windows**：从 [GitHub Releases](https://github.com/theforeveriris/simple-voice-tools-for-trans/releases/latest)
  下载最新的 `SimpleVoiceToolForTrans-v*-setup.exe` 安装包（Tauri 构建；桌面端不提供应用内检查更新）

## 功能特点

- **测试**：三个实时图表（F1/F2 共振峰、音频能量、音高曲线）随录音推进滚动更新，
  音高图按区间分段着色（淡紫=偏低/偏高、淡蓝=男声区、黑=过渡区、淡粉=女声区），
  右上角实时显示 Hz 与对应钢琴音高
- **测试模式**：短按录音圆球以当前模式开始录音（记住上次选择），长按弹出扇形选择器：
  - **随意朗读**：任意朗读一段文字，屏幕仅显示简短提示不做跟读
  - **长音测试**：持续发「a」，发声后检测到静音 1 秒自动停止，配合 Jitter 评估音高稳定度
  - **音域滑音**：由低到高滑唱 20 秒，勾勒音域包络
- **分析**：声纹概览卡（平均基频 + 音域标尺）、四组统计表格、四张图表
  （音高 / 共振峰 / 能量 / 语谱图）。所有图表共享同一个时间轴区间，
  拖动双滑块缩放、按住窗口中间整体平移，**统计与音域标尺随选中区间实时联动**；
  时间序列图表支持按住（或聚焦后用方向键）查看十字线读数；
  音高 / 能量 / 共振峰曲线与历史趋势图均可一键切换**数据表视图**（真实表格、
  读屏可读，区间内数据可整体复制为 TSV）；
  保存过录音音频的记录可**用当前算法参数重算**——重跑完整管线后先给新旧统计
  对比、确认后才覆盖，调参无需重录（记录带重算时间与参数指纹标记）
- **元音空间散点**：共振峰卡片一键切换「曲线 / 散点」，以经典元音四边形
  （F1 倒轴 × F2 倒轴，对数刻度）呈现全部有声帧的落点密度，
  叠加 i / a / u 参考元音；两两对比视图中双记录散点叠加并标记质心
- **共振峰目标区**：设置 → 训练 中可指定目标 F1/F2 中心与容差半径，
  元音散点图（分析页与实时落点视图）叠加目标矩形并统计落点命中率，
  用于共鸣位置的针对性训练
- **声域图（VRP）**：滑音模式记录专属的 phonetogram 热力图——
  半音（C2–C6）× 响度（dBFS）矩阵，色深 = 驻留时长，直观呈现音域与力度分布
- **录音回放**：录音音频（Opus/AAC 压缩）与分析数据一同存入浏览器 IndexedDB，
  分析页可随时回放
- **外部音频导入**：把手机录音 / 微信语音等音频文件拖进应用（或系统「分享到」本应用），
  走同一套离线分析管线生成完整报告（分析上限 5 分钟）
- **音高算法对比**（实验性）：对同一段录音用 pYIN / MPM 重算基频，
  与录音时的 YIN 曲线叠加对比，给出一致率与中位偏差
- **嗓音质量**：Jitter（基频微扰）/ Shimmer（振幅微扰）/ HNR（谐噪比）/
  CPPS（倒谱峰突出度）四项指标，由录音音频离线计算（需开启「保存录音音频」）；
  CPPS 对连续语音（随意朗读模式）同样稳健，与 J/S 互补
- **训练靶标与基线**：设置目标基频区间（默认 120–220 Hz，或首次引导按训练方向铺底的预设）后，测试页音高图叠加目标带并
  实时显示偏差与达成率；分析页统计目标达成率，并可指定基线记录自动对比 Δ 指标
- **AI 训练建议与周报**（实验性）：填入自己的 OpenAI 兼容接口后，
  可对单条记录 / 两条对比记录生成分维度评估与训练建议，并按周聚合生成 AI 周报；
  流式输出边生成边预览、可随时取消，生成结果本机持久化（重启后不重新付费调用）；
  接口配置以**档案**管理（多套一键切换，存本机 IndexedDB），Token 用量按功能统计、
  可填单价折算费用（设置 → **大模型**）；仅上传统计指标（不含音频与原始曲线），
  API Key 仅保存在本机 IndexedDB；每次 AI 请求实际发出的内容可在
  设置 → 数据 → **数据去向** 中查看（请求日志，可复制、可清空）；
  另有本地规则引擎的离线建议（无需联网）
- **AI 助手**：设置 → 大模型 里的独立聊天页——流式多轮对话，气泡点按浮出
  复制 / 重做 / 分支，右侧抽屉管理历史对话与新建对话；输入栏随内容自动增高；
  上下文仅为对话本身，不自动携带录音数据
- **历史**：记录存于 IndexedDB（完整保存全部记录，列表仅显示最近 200 条），按时间倒序；顶部「列表 / 趋势」切换，
  趋势图展示平均基频与 P10–P90 音域随日期的变化，并可切换 **MPT（最长声时）/ CPPS**
  纵轴指标、按测试模式过滤；另有 GitHub 式用声日记热力图（打卡概览）；长按卡片（或右上角
  「多选」按钮）进入多选，支持批量删除与两两对比（Δ 指标表 + 音高曲线叠加）；
  记录可加备注、可搜索
- **练习提醒**：可选每日本地通知（到点且当天尚无录音时提醒），支持自定义提醒时间
- **设置**：主题（预设配色三选一，色板预览卡片——莫奈取色：主题色相 / 强调色相 /
  深色色相三滑条，支持双色调与独立深色铺底；骄傲旗：跨性别 / 非二元 / 性别流体三款旗帜，
  氤氲流体渐变背景 + 毛玻璃组件，渐变浓度 / 饱和度 / 毛玻璃强度 / 背景流动均可调；
  自定义图片：背景层由图片接管，焦点 / 模糊 / 压暗 / 饱和度 / 存在感 / 漂移可调，
  压缩后仅存本机并随 ZIP 备份打包；氛围彩蛋——声音染色：界面色相随实时音高在蓝粉间流动，
  音量呼吸：渐变浓度随麦克风响度起伏）、数据导入/导出（JSON / 汇总 CSV）、
  录音时长限制、麦克风设备选择、录音音频保存开关、原生壳启动页（默认开启，
  配置 里可关）
- **备份**：完整备份（ZIP，记录 + 全部录音音频）与一键恢复；存储用量面板
  （配额占用 / 音频体积 / 持久化存储申请）；云备份三选一——GitHub 私有库
  （Device Flow 授权，写入你自己的仓库，未变化文件自动跳过）、WebDAV 网盘 / NAS、
  File System Access 本地自动备份（按天写入所选文件夹，实验性）；
  云备份可选**口令加密**（AES-GCM，上传前加密、口令不落盘，跨设备凭口令即可恢复，
  加密不影响「未变化文件跳过」）；设置 → 数据 顶部有**数据去向**面板，
  如实说明各类数据的边界与云备份加密状态
- **导出**：分析报告一键生成 PNG 分享图（Canvas 绘制的品牌报告卡，四种样式可选——跟随主题 / 深色 / 浅色 / 极光，跟随主题款实时取当前主题色，每种样式均带指向本仓库的二维码，
  支持系统分享面板）；单条记录可导出帧级 CSV、可交互的单文件 HTML 报告，以及
  **Praat 互操作文件**（PitchTier 基频曲线 / Formant 逐帧 F1/F2，Praat 直接打开即可交叉验证）
- **键盘快捷键**：`1–4` 切换页签，`S` 任意页签开始/停止录音（测试页亦可用
  `Space`），`M` 唤出模式选择，`R` 回放/暂停分析页当前记录，
  `?` 查看全部快捷键（历史页 `/` 聚焦搜索、多选模式 `Ctrl/⌘+A` 全选、`Esc` 退出等）
- **应用快捷方式**：长按桌面图标直达测试录音 / 历史记录 / 设置——浏览器安装的
  PWA 走 manifest shortcuts，安卓 APK 走原生 shortcuts（文案按系统语言显示）
- **高级**：设置内的子页面，只收录仍未定型或可编程的能力——分析页语谱图开关、
  测试页实时频谱图（窄带幅度谱）、实时音高算法切换与对比卡、
  算法参数（YIN 判定阈值 / 音高搜索范围 / 发声与活跃帧能量门限 / LPC 预加重与阶数 /
  F1·F2 搜索窗 / 嗓音质量置信度与最少周期 / CPPS 峰值搜索与时间平滑，
  实时与离线分析同步生效）、脚本中心（Lua 建议规则 / 分享卡模板 / 花朵生成 / 导出桥）。
  已转正的能力各有去处：外部音频导入 → 数据管理，实时练习视图 / 音区边界 / 训练建议 → 训练，
  GitHub 云备份 → 数据管理
- **应用内文档**：设置 → 关于 中可离线阅读全部文档（使用说明 / 参数说明书 / 参考文献 /
  开发文档 / 算法原理 / 记录格式标准 / 各平台指南 / 隐私政策），无需联网
- **设置结构**：外观 · 语言 · 录音 · 训练 · 大模型 · 数据管理 · 应用 · 高级——
  每个子页只回答一个问题，同一件事只出现在一个地方
- **多语言与深色模式**：默认英文界面；内置简体中文 / 繁體中文 / English / 日本語 /
  Español / Français / བོད་ཡིག（藏语）/ 文言 八种（英日西法为机器翻译，藏语标「雪豹」，
  文言为彩蛋），另有「AI 翻译」（实验性）——用大模型把界面翻译成
  任意语言并缓存本地；莫奈主题色支持浅色 / 深色 / 跟随系统三种外观
- **PWA**：可安装到桌面/主屏幕（设置 → 应用），Service Worker 离线缓存，OGP 社交分享卡片

## 文档

| 文档 | 内容 |
| --- | --- |
| [贡献指南](CONTRIBUTING.md) | 如何报 Bug、提交 PR、代码风格与隐私要求 |
| [documentation/DEVELOPMENT.md](documentation/DEVELOPMENT.md) | 开发者文档：架构、数据流、主题系统、动效模型、性能设计 |
| [documentation/ARCHITECTURE-I18N.md](documentation/ARCHITECTURE-I18N.md) | 架构：i18n 查找链、自定义词条、AI 翻译管线 |
| [documentation/ARCHITECTURE-THEME.md](documentation/ARCHITECTURE-THEME.md) | 架构：主题系统、骄傲旗预设与渐变参数 |
| [documentation/ARCHITECTURE-STATE.md](documentation/ARCHITECTURE-STATE.md) | 架构：状态与持久化、存储键清单、迁移 |
| [documentation/ARCHITECTURE-SETTINGS.md](documentation/ARCHITECTURE-SETTINGS.md) | 架构：设置子页模式与新增步骤 |
| [documentation/GUIDE-PWA.md](documentation/GUIDE-PWA.md) | 指南：PWA 更新流、Share Target、修复工具 |
| [documentation/GUIDE-CAPACITOR.md](documentation/GUIDE-CAPACITOR.md) | 指南：Capacitor 安卓壳（构建/签名/原生分享/已知限制） |
| [documentation/GUIDE-DESKTOP.md](documentation/GUIDE-DESKTOP.md) | 指南：Tauri Windows 桌面版（构建/CI/平台差异） |
| [documentation/PARAMETERS-GUIDE.md](documentation/PARAMETERS-GUIDE.md) | 指标与参数指南：每个数字的含义、默认值与实验性算法参数 |
| [documentation/ALGORITHM-YIN.md](documentation/ALGORITHM-YIN.md) | 音高检测原理：YIN 差分函数、CMND、抛物线插值 |
| [documentation/ALGORITHM-FORMANT-LPC.md](documentation/ALGORITHM-FORMANT-LPC.md) | 共振峰提取原理：预加重、抽取、LPC、多项式求根 |
| [documentation/ALGORITHM-ENERGY.md](documentation/ALGORITHM-ENERGY.md) | 能量分析原理：RMS、分贝换算、VAD 门限体系 |
| [documentation/ALGORITHM-CPPS.md](documentation/ALGORITHM-CPPS.md) | 倒谱峰突出度原理：实倒谱、回归线基线、时间平滑 |

以上文档也可在应用内离线阅读：**设置 → 关于 → 文档**。

## 技术栈

- React 19 + TypeScript + Vite
- Tailwind CSS（莫奈动态色板基于 OKLCH 色彩空间生成）
- Zustand（状态管理）+ IndexedDB（记录与音频持久化）
- Framer Motion（动效）
- Web Audio API + 原生 Canvas 2D（自绘图表，无图表库依赖）：
  - **YIN 算法**音高检测（差分函数 + CMND + 抛物线插值）
  - **LPC 线性预测**共振峰提取（Levinson-Durbin + Durand-Kerner 求根）
  - RMS 能量电平与 VAD 门限
  - **Jitter / Shimmer / HNR** 嗓音质量（峰检测周期序列 + YIN 置信度换算）
  - **CPPS 倒谱峰突出度**（自写基-2 FFT → 实倒谱 → 回归线基线 → 时间平滑分布统计）
  - **FFT 语谱图**（对数频带量化存储 + magma 伪彩色渲染）
- fflate（ZIP 完整备份打包）；GitHub 云备份走 Device Flow + REST API，零后端
- 原生壳：Capacitor 7（安卓 APK）+ Tauri 2（Windows 安装包）；uqr 用于分享图二维码

## 开发说明

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

### 构建

```bash
npm run build
```

### 测试

```bash
npm test        # vitest 单测（DSP 黄金样本 / 导出 / 备份 / LLM / i18n 完整性 / 源码编码守卫，CI 同步执行）
```

> 构建产物输出到 `docs/` 目录（已 gitignore，不入库）：push 到 main 后由
> GitHub Actions 自动构建并部署 Pages（见 `.github/workflows/deploy.yml`）。
> 源文档位于 `documentation/` 目录，与构建产物 `docs/` 无关。

### 预览构建结果

```bash
npm run preview
```

### 体验示例数据

无需麦克风也可查看分析页效果：访问任意页面 URL 加 `?demo=1`，
或使用历史/分析/设置页中的「载入示例数据」按钮。

## 使用方法

1. 启动应用后默认进入测试页，**短按**底栏右侧的圆球按钮以当前模式开始录音
   （**长按**圆球可展开扇形选择器切换 朗读 / 长音 / 滑音 三种模式）
2. 允许浏览器访问麦克风权限，按屏幕上的模式引导说话或朗读
3. 再次点击圆球（或到达模式/设置的最长录音时长）结束录音，自动进入分析页
4. 在历史页可回看所有测试记录：顶部切换「趋势」查看走势，长按卡片多选后可
   对比两条记录或批量删除；分析页图表下方的时间轴可缩放与平移，统计随之联动

## 注意事项

- 使用了 `getUserMedia`，需要在 HTTPS 或 localhost 环境下运行
- 麦克风权限需要用户手动授权
- 所有数据（分析记录 + 录音音频）默认仅保存在本机浏览器的 IndexedDB 中；
  只有你主动「完整备份」或连接云备份时数据才会导出/上传到你自己选择的目标
  ——详见[隐私政策](https://theforeveriris.github.io/simple-voice-tools-for-trans/privacy-policy.md)
- 嗓音质量指标（Jitter/Shimmer/HNR/CPPS）需要开启「保存录音音频」，旧记录或关闭
  音频保存时显示为「—」
- 检测准确性可能受环境噪音影响，建议在安静环境中测试
- WebDAV 备份要求网盘服务端允许跨域（CORS）；坚果云等部分服务需在浏览器扩展或
  服务端配置中放行，具体见代码内注释说明
