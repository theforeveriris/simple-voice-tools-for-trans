# 设置页架构（子页面模式）

本文描述设置页的组织方式与「新增子页面」的标准步骤。实现：
`src/components/pages/SettingsPage.tsx`、`src/components/settings/*`。

## 结构

```
SettingsPage
├── 顶部胶囊：设置 / 关于（AboutTab：简介 + 使用说明 + 开发者文档 + 隐私政策 + 免责声明）
├── 搜索框（非空时切换为 SEARCH_INDEX 结果，点击直达子页面）
└── 主视图：八张入口卡片
    AppearancePage（外观）   LanguagePage（语言）  RecordingPage（录音）
    TrainingPage（训练）     LlmPage（大模型）     DataPage（数据管理）
    AppPage（应用）          AdvancedPage（高级）
```

**归类标准**：每个子页只回答一个问题，且同一件事只出现在一个地方。

| 子页 | 回答的问题 |
| --- | --- |
| 外观 | 界面长什么样（主题 / 氛围彩蛋 / 图表与显示 / 花园 / 主题分享） |
| 语言 | 界面说什么话（界面语言 + AI 翻译） |
| 录音 | 声音怎么采进来（采集行为 / 音质 / 设备） |
| 训练 | 我在练什么、怎么被督促（画像 / 靶标 / 建议 / 音区边界 / 实时视图 / 提醒） |
| 大模型 | AI 能力怎么接（档案 / 模型 / 提示词 / 助手 / 用量） |
| 数据 | 数据存哪、怎么进出（数据去向 / 存储 / 导入 / 同步 / 备份 / WebDAV / GitHub / 数据操作） |
| 应用 | App 本身怎么装、怎么更新、怎么启动（安装 / 分享 / 版本 / 启动页签 / 启动页 / 状态） |
| 高级 | 仍未定型或可编程的能力（语谱图 / 实时频谱 / 音高算法对比 / 算法参数 / 脚本中心） |

> 历史沿革：v0.9.x 之前为「配置 / 实验性功能」两页——「配置」把画像、录音、训练、
> 提醒、图表与回放、通用六件事塞在一页，「实验性功能」里则躺着六个早已转正的功能
> （外部音频导入、实时练习视图、音区边界、建议模式、GitHub 备份、脚本中心）。
> 现行结构把配置拆入录音 / 训练 / 应用 / 外观 / 数据，并把已转正能力归位；
> 图表设置统一到外观的「图表与显示」。

- 入口卡片：`entry(label, icon, onOpen)`；图标 lucide，`aria-label` 即 label。
- **子页面是 SettingsPage 的本地 state**（`appearanceOpen` 等，含 `llmOpen`），
  不持久化、不入 hash——切页签或返回键回主视图即重置。
- 子页面之间靠**提前 return**切换：`if (xxxOpen) return <XxxPage ... />`，
  因此 **hooks 必须在这些 return 之前全部调用**（SettingsPage 自身遵守）。
- 返回手势：子页打开时经 `registerBackClose`（`lib/backNav.ts`）压入返回栈，
  系统返回键/手势先关子页再退页面；新子页沿用 `onBack = history.back()`。

## 搜索索引

`SEARCH_INDEX: { page: SubPage; sectionKey; labelKey }[]`——每条是一个设置项，
`sectionKey` 是所在分区标题、`labelKey` 是设置项名，两者都参与模糊匹配；
点击 → 打开对应子页面。新增设置项时在此登记一条，用户才能搜到它。

## 子页面通用骨架

每个子页面同构；新页面用共享外壳 `SettingsSubPage`（`rows.tsx`）：

```tsx
<SettingsSubPage title={t('settings.xxx')} onBack={onBack}>
  <SettingsSection icon={Icon} title={...}>…</SettingsSection>
</SettingsSubPage>
```

等价于手写「返回圆钮（aria-label=common.back）+ 标题 + 入场动画 + 卡片流容器」，
历史页面仍保留手写形态（与外壳逐像素等价）。

props 约定：`{ settings, update, onBack }`——`update` 即 `updateSettings`。

## 基础组件（rows.tsx / InfoTip.tsx）

- `<SettingsSubPage title onBack>`：子页外壳（页头 + 动画 + 容器）；
- `<SettingsSection icon title>`：圆角卡片分区，title 行带图标；
- `<SettingRow label desc? stacked?>`：一行 = 左标签（可含 InfoTip）+ 右控件；
  `stacked` 时控件换行到下方（长表单用）；左列 `min-w-0 flex-1`，控件列
  `ml-auto flex-wrap justify-end`——长描述在列内换行、控件始终贴右缘；
  `desc` 是标签下的小字说明，**长说明改用 InfoTip 浮窗**；
- `<InfoTip label text>`：标签右侧 ⓘ 图标，点击弹出说明浮层；
- 控件皮肤（唯一来源，勿再各写宽度）：
  `SELECT_TRIGGER_CLASS`（无框下拉：值右对齐、箭头紧随、宽度自适应内容）、
  `SELECT_TRIGGER_TRUNCATE`（长文本选项限宽省略）、
  `NUMBER_INPUT_CLASS`（数值输入右对齐、等宽数字）；
  弹层统一 `rounded-2xl border-0 bg-card shadow-lg`。

## 新增子页面（步骤清单）

1. 建 `components/settings/XxxPage.tsx`（上面的骨架）；
2. `SettingsPage`：`SubPage` 联合类型加 id、`useState(xxxOpen)`、
   提前 return 分支、主视图 `entry(t('settings.xxx'), Icon, ...)`、
   `registerBackClose` 压返回栈；
3. `SEARCH_INDEX` 登记子页的设置项（否则搜索不到）；
4. `i18n` 七语言加子页标题键（搜索索引用的 sectionKey / labelKey 也要有词条）；
5. 若子页含持久化设置项：`types.AppSettings` + `DEFAULT_SETTINGS` +
   `lib/export/settings.ts` 白名单（可选字符串进 `OPTIONAL_STRING_KEYS`，
   枚举进 `STRING_ENUMS`，数值范围进 `NUMBER_RANGE`）。

参考实现：`AppPage`（无设置项的最简形态）、`LanguagePage`（开关 + 下拉 +
表单 + 浮层 + 进度条的最全形态）。

## 变体：二级页与独立全屏页

- **二级页**：子页之下再挂一层本地 state 页，如 `LlmPage` → `PromptPage`
  （提示词调节）；骨架与 props 约定相同，只是由 LlmPage 自己管理开合。
- **独立全屏页**：不完全属于设置的概念页放在 `components/` 顶级目录，如
  `components/ai/AssistantPage.tsx`（AI 助手聊天页，从 LlmPage 进入）——
  仍是 SettingsPage 的提前 return 分支，但组件不在 settings/ 目录下。

## 各子页速览（区块 → 去处）

| 子页 | 区块 | 关键实现 |
| --- | --- | --- |
| 外观 | 主题（深浅 / 预设三卡 / 骄傲旗参数）· 自定义背景图 · 氛围彩蛋 · **图表与显示**（网格 / 联动 / 迷你基频 / 实时窗口 / 音高轴 / 语谱配色 / 回放倍速 / 日记周起始）· 花园布局 · 主题分享 | `applyPreset` 立即重放主题；背景图管线见 ARCHITECTURE-THEME.md；主题包见 `lib/theme/themeShare.ts` |
| 语言 | 界面语言 + AI 翻译（合一区块） | 见 ARCHITECTURE-I18N.md |
| 录音 | 录音行为（自动进入分析 / 保存音频 / 静音判停 / 最长时长）· 音质与设备（码率 / 增益降噪 / 震动 / 自动回放 / 麦克风选择） | 环境元数据（底噪 / 麦克风 / 时段）在 `lib/audio/recorder.ts` 采集 |
| 训练 | 用户画像（方向 / 年龄段）· 训练靶标（靶标 / 共振峰目标区 / 基线记录）· 训练建议（建议模式 / 对比时建议）· 自定义音区边界 · 实时练习视图 ×4 · 每日练习提醒 | 实时视图为 `components/pages/*LiveSheet.tsx`；靶标达成率见 `lib/audio/recorder.ts` |
| 大模型 | AI 助手入口 · 模型配置 · 配置档案（模型拉取 / 上下文识别） · 提示词调节 · 用量与费用 | 档案制（`llm:profiles`），支持 openai/anthropic 双协议；模型列表与上下文识别见 `lib/llmModels.ts`；请求日志在数据页 |
| 数据 | 数据去向（页首，含 AI 请求日志）· 存储用量 · 外部音频导入 · 局域网同步 · 备份与恢复（含口令加密）· WebDAV · GitHub 云备份 · 数据操作 | `PrivacyPanel`；加密见 ARCHITECTURE-STATE.md；局域网见 `lib/sync/lanSync.ts` |
| 应用 | 安装与分享 · 版本与更新 · 启动默认页签 · 启动页（原生）· 运行状态 | 见 GUIDE-PWA.md；原生壳内「检查更新」比对 GitHub Releases APK（`lib/appUpdate.ts`） |
| 高级 | 功能开关（语谱图 / 实时频谱 / SI 改名 / 音高算法对比）· 算法参数 · 脚本中心 | 算法参数 13 项见 PARAMETERS-GUIDE.md；脚本见 `lib/lua/*` |

## 文案规范

设置项标签 / 说明一律走 i18n（`t('settings.xxx')`）；组合键名、单位（Hz、px）
等不译内容直接内联。新增说明超过一行时用 InfoTip 而非 `desc`。
