# 隐私政策 / Privacy Policy

**Simple Voice Tool for Trans**（下称"本应用"）以本地优先为设计原则。本政策说明各类数据
的去向，最后更新：2026-10-18。功能变更导致数据流变化时，本页会同步更新。

- English summary at the bottom / 英文摘要见文末。

## 一、默认状态：数据不出设备

以下数据**仅保存在你的浏览器/应用本地存储（IndexedDB / localStorage）**，
本应用不运行任何收集服务器，默认状态下不向任何服务器发送：

- 录音音频与全部分析记录（音高 / 共振峰 / 能量 / 嗓音质量统计）；
- 备注、训练靶标、基线、提醒时间等设置；
- 主题偏好、界面语言、自定义词条。

清空浏览器数据或卸载应用即彻底删除（云端备份除外，见下）。

## 二、可能离开设备的数据（均需你主动操作）

### 1. 大模型（AI）请求 —— 可选功能

- **发送内容**：统计指标（均值、范围、Jitter/Shimmer/HNR/CPPS 等数字）与
  记录元信息（模式、时长、备注）。**不发送录音音频与逐帧曲线**。
  AI 助手对话会发送对话文本本身。
- **接收方**：你在 设置 → 大模型 中自行填写的接口地址（OpenAI 兼容 /
  Anthropic）。本应用作者不经营任何中转服务，看不到这些请求。
- **凭据**：API Key 仅存本地 IndexedDB，不随备份明文导出（加密导出除外）。
- **审查**：每次请求的实际载荷可在 设置 → 数据 → 数据去向 中逐条查看、复制、清空。

### 2. 云备份 —— 可选功能

- **GitHub 备份**：经 OAuth Device Flow 授权后，备份写入**你自己的**私有仓库；
  应用只获得你授权的仓库访问令牌，令牌仅存本地。
- **WebDAV 备份**：备份写入你配置的服务器（如坚果云）。凭据仅存本地。
- **加密**：开启口令加密后，备份先经 AES-GCM 加密再上传，口令不存储、不发送。
  未开加密时备份为明文 ZIP，请自行评估托管端可信度。
- **本地自动备份**：写入你选择的本地文件夹，不经网络。

### 3. 应用更新检查

- PWA / Android / Windows 会向 **GitHub Releases / GitHub Pages**（`github.com`、
  `githubusercontent.com`）发起常规 HTTPS 请求以检查新版本。不携带任何用户数据，
  只有版本号比较。

## 三、权限用途

| 权限 | 用途 |
| --- | --- |
| 麦克风 | 仅在录音与实时监听时采样，不后台录音 |
| 通知（可选） | 练习提醒 |
| 文件夹访问（可选） | 本地自动备份写入 |
| 系统分享接收（可选，安装为应用后） | 接收你主动分享的音频做离线分析 |

## 四、第三方组件

应用集成的库（React、Vite、Capacitor、Tauri 等）均为本地运行的开源组件，
不内嵌任何统计/广告 SDK，不包含崩溃自动上报。

## 五、未成年人

本应用面向一般用户，不设年龄门槛；但所有参考区间未经临床验证，
未成年人使用建议在专业人士指导下进行。

## 六、你的控制权

- **查看/导出**：设置 → 数据（全量 JSON / 摘要 CSV / 交互式 HTML / Praat）。
- **删除**：设置 → 数据 → 清除全部数据；或直接清空浏览器站点数据。
- **云端删除**：删除云备份即删除对应仓库/目录中的文件（应用不保留副本）。

## 七、联系方式

对本政策有疑问，请在仓库提交 Issue：https://github.com/theforeveriris/simple-voice-tools-for-trans/issues

---

## English Summary

Simple Voice Tool for Trans is local-first: recordings and analysis data never leave your
device by default. Data leaves the device only when **you** explicitly (a) send
aggregate statistics (never audio) to an LLM endpoint **you** configure, (b) back
up to **your own** GitHub repo or WebDAV server (optional passphrase encryption
before upload), or (c) the app checks GitHub Releases for updates (no user data
attached). No analytics, no ads, no crash reporting. You can inspect every AI
request payload in Settings → Data, export or wipe all data at any time.
Contact: the repository's issue tracker.
