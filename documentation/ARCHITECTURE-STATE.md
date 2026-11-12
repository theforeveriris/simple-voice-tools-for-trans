# 状态与持久化架构

本文描述应用的状态层与全部持久化位置：两个 Zustand store、IndexedDB schema、
localStorage 键清单、迁移与降级策略。实现：`src/store/`、`src/lib/storage/idb.ts`、
`src/constants/index.ts`（DEFAULT_SETTINGS）。

## Zustand store

### useStore（主状态，`svt:settings:v1` 持久化）

- 内存态：`currentTab` / `isRecording` / `currentAnalysis` / `pendingAutoReplay`；
- **持久化仅 `settings`**（`partialize`），且**排除 `llmApiKey`**（见下）；
- persist 信封的 **`version` 当前为 2**；`migrate` 承担一次版本迁移：
  `version < 2` 时把 `navStyle` 统一铺为 `'floating'`（底栏默认样式改为
  悬浮胶囊；用户之后在外观里手动选 classic 会连 `version` 一起写回，
  迁移不会再跑）。用 zustand 的 `version`/`migrate` 而不是「写标记」的旧写法，
  是因为迁移与版本号同生共死——中断了下次还会再跑，不会「标记写了、值没落库」。
- `merge` 承担四代迁移：
  1. 旧版布尔 `adviceEnabled` → 三态 `adviceMode`；
  2. 旧版旗帜直接作为预设（`huePreset: 'transPride'` 等）→ 收敛为
     `huePreset: 'pride'` + `prideFlag`；
  3. 旧版存于 localStorage 的 `llmApiKey` → 一次性迁入 IndexedDB kv；
  4. 旧版背景图开关 `bgImageEnabled` → `huePreset: 'image'`。
- **v0.9.0「档案即数据源」启动迁移**：旧三字段 `llmBaseUrl` / `llmApiKey` / `llmModelId`
  在无任何档案时一次性生成一份 LLM 档案并写 `llmActiveProfileId`（useStore 启动时执行）；
  此后旧字段仅存不读，配置一律经活动档案解析（`lib/llmProfiles.ts`）。
- `updateSettings(patch)`：patch 含 `llmApiKey` 时同步写入 IDB kv（敏感态不进
  localStorage）；内存态仅为配置解析用。
- **`syncModuleSettings`**：settings 变化时把若干值推入模块级单例
  （音区边界 / 音高轴 / 实时窗口 / 音高平滑 / 语谱配色 / 音高算法 / 共振峰目标区 /
  SI 改名 / 骄傲旗参数 / 自定义背景图 `applyBgImage` / 实验性算法参数 `setAlgoParams`）——
  Canvas 画笔等非 React 代码经 getter 读取，避免 60fps 订阅。

### useHistoryStore（记录，IndexedDB 持久化）

- 内存 `records` 仅保留最近 `MAX_HISTORY = 200` 条（列表渲染上限），
  **完整数据永远在 IndexedDB**——导出 / 备份必须走 `getAllRecords()` 全量读，
  否则静默丢早于 200 条的记录（备份模块内有显式注释强调这一点）。
- store 另暴露 `hydrate()`（启动从 IDB 装载）/ `ready` / `totalCount` /
  `updateRecord()`（备注编辑等就地更新）。
- `addRecord(record, audioBlob?)`：记录与音频同 id 分别入 `records` / `audio` 仓；
  写失败降级为内存态 + 每会话一次的 toast（`warnStorage`）。
- 删除撤销：预取待删记录的音频 Blob（≤20 条时），5 秒内 `addRecord` 原样恢复；
  撤销编排（`removeWithUndo`）在页面层 `components/pages/HistoryPage.tsx`，
  store 只提供增删原语。
- 旧版 localStorage（`svt:history:v1`）一次性迁入 IDB，守卫键 `svt:idb-migrated`。

## IndexedDB（`src/lib/storage/idb.ts`，库名 `svt`，版本 2）

| 仓库 | keyPath | 内容 |
| --- | --- | --- |
| `records` | `id` | 分析记录（不含音频） |
| `audio` | `id` | 录音音频 Blob（与记录同 id 关联） |
| `kv` | 显式 key | 敏感态与杂项（下表） |

kv 仓库键清单：

| 键 | 写入方 | 内容 |
| --- | --- | --- |
| `gh:token` | backup/github | GitHub 设备流令牌（含 refresh） |
| `gh:login` | backup/github | 登录名 |
| `gh:lastPush` | backup/github | 上次云备份时间 |
| `webdav:config` | backup/webdav | WebDAV 凭据 |
| `webdav:lastPush` | backup/webdav | 上次 WebDAV 云备份时间 |
| `webdav:lastFingerprint` | backup/webdav | 上次 WebDAV 备份指纹（sha256 + 是否加密），用于跳过无变化的重复上传 |
| `backup:crypto` | backup/crypto | 云备份口令加密配置（salt / 迭代次数 / 校验块；**口令本身绝不落盘**，仅存会话内存） |
| `llm-api-key` | store/useStore | 大模型 API Key（旧字段，v0.9.0 后由档案管理，仅存不读） |
| `autoBackup:handle` | backup/local | 本地自动备份目录句柄（FileSystemDirectoryHandle） |
| `autoBackup:lastTs` | backup/local | 上次自动备份时间 |
| `llm:usage:totals` | lib/llmUsage | 大模型 Token 用量聚合（按功能分组的计数器） |
| `llm:usage:log` | lib/llmUsage | 大模型调用明细（最新在前，封顶 200 条） |
| `llm:results` | lib/llmResultStore | 大模型成功结果按缓存键持久化（最新在前，封顶 50 条） |
| `llm:profiles` | lib/llmProfiles | 大模型接口配置档案（多套一键切换，含 protocol: openai/anthropic、stream、contextTokens 与各档案 API Key；活动档案由 `settings.llmActiveProfileId` 指针指定） |
| `llm:chats` | lib/llmChats | AI 助手对话历史（最新在前，封顶 30 条） |
| `llm:requestLog` | lib/llmRequestLog | AI 请求日志（数据页 → AI 请求日志子页用，封顶 10 条，不含 API Key） |
| `memory:items` | lib/memory | AI 助手长期记忆（事实 / 偏好 / 要求 / 注意，上限 200 条、单条 300 字符；只存本机，不进设置导出） |
| `llm:suggestCache` | lib/assistantSuggestAi | AI 快速提示（quick prompts）缓存（指纹 + 时间 + 词条） |
| `bg-image` | lib/theme/bgImage | 自定义背景图 Blob（ZIP 备份会打包） |
| `luaScripts` | lib/lua/scripts | 用户 Lua 脚本列表（脚本中心） |
| `luaScriptsEnabled` | lib/lua/scripts | 每个用户脚本的启用状态映射 |

约定：**凭据与句柄一律进 kv，不进 localStorage**（localStorage 会被设置导出、
容易被顺手清掉，且句柄无法结构化克隆进 localStorage）。

降级：首次打开失败即 `unavailable = true` 永久降级（本会话所有操作 reject），
上层 toast 提示；`onblocked` 同样拒绝。`onupgradeneeded` 目前只建仓库，
**尚无按版本的迁移分支**——给 `AnalysisRecord` 加字段需保持向后兼容（可选字段），
破坏性变更必须在这里补迁移。现成实例：重算功能给记录追加了可选的
`reanalyzedAt`（重算时间）与 `paramsFp`（算法参数指纹）字段（`types/index.ts`）。

**云备份加密边界**：GitHub / WebDAV 云备份可选口令加密（AES-256-GCM + PBKDF2，
见 `lib/backup/crypto.ts`）——上传前在本地加密，口令不落盘、跨设备凭口令恢复；
手动 ZIP 备份与本地自动备份**始终明文**。

## localStorage 键清单

| 键 | 写入方 | 内容 |
| --- | --- | --- |
| `svt:settings:v1` | useStore persist | 设置（zustand persist 结构，排除 llmApiKey；信封带 `version: 2`） |
| `svt:history:v1` | （遗留，只读迁移源） | 旧版记录 |
| `svt:idb-migrated` | useHistoryStore | 旧记录已迁移守卫 |
| `svt:i18n-ai:<slug>` | i18n/aiLocale | AI 语言词典缓存 |
| `svt:i18n-overrides:<tag>` | i18n/index | 用户自定义词条（tag = localeTag，AI 按 slug） |
| `svt:update-seen` | App | 上次见过的应用版本 |
| `svt:update-notes-open` | App | 「本次更新内容」卡未读标记 |
| `svt:reminder:fired:<date>` | lib/reminder | 每日提醒当日已触发标记 |
| `svt:onboarded` | settings/OnboardingSheet | 首次引导完成标记（`"1"`） |
| `svt:lan-peers` | lib/sync/lanPeers | 局域网同步最近对端设备记忆（JSON，上限 5 条） |
| `svt.exportTemplates` | lib/export/templateStore | 导出模板列表（JSON；**不随设置导出**，换设备需用 `.svt-template` 文件单独导入） |

新增键时：能进 IDB kv 的不进 localStorage；有结构的走 JSON；命名保持
`svt:<域>[:<子域>]`（例外：`svt.exportTemplates` 用点号，与 `svt:` 域前缀区分；
它和 IDB kv 中的 `memory:items` / Lua 脚本一样，**不在设置导出的 AppSettings 范围内**）。
迁移设备时：模板用 `.svt-template` 文件单独导入，Lua 脚本在脚本中心导出/导入 JSON，
长期记忆与 AI 对话目前不随备份迁移（只存本机，可在对应页面手动复制或清除）。
注意脚本 JSON **不保存启用态**，导入的脚本会获得新 id 并默认启用——导入后请检查
脚本中心，避免原本停用的建议脚本重新生效。

另有一条 **Cache Storage** 键（不是 localStorage）：`svt-share-target`
（`lib/audio/importAudio.ts`）——PWA「分享到」接收到的音频暂存处。

## 录音数据流（状态与持久化的交汇）

```
recorder.stop() → AnalysisRecord（内存）→ finishRecord（解码 + Worker 嗓音质量）
  → useHistoryStore.addRecord(record, audioBlob) → IDB 双仓落库
  → maybeAutoBackup('record')（本地自动备份节流触发）
  → currentAnalysis / pendingAutoReplay → 分析页
```

导入音频（文件 / 系统分享）走 `analyzeAudioFile` → Worker 离线管线 →
同一落库出口；GitHub / WebDAV / ZIP 备份从 IDB 全量读取（见 GUIDE-PWA.md）。

## 容量与配额

- 无自动清理：记录与音频无上限增长（`IMPORT_MAX_SEC` 限制单条 ≤ 5 分钟）；
  界面 200 条截断仅是渲染策略。
- 配额查询与 `persist()` 申请按钮在 数据管理 → 存储用量；
  持久化授予状态也反映在 应用子页 → 运行状态。
- 设置导出 / 导入有白名单 + 类型 / 枚举 / 数值范围校验
  （`lib/export/settings.ts`），未知字段静默忽略。
