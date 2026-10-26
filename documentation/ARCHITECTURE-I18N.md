# i18n 架构（国际化与 AI 翻译）

本文描述界面文案系统：核心查找链、八种内置语言、用户自定义覆盖层、
AI 翻译语言管线与词典分享。核心实现：`src/i18n/`（index / hook / aiLocale / 八个词典）。

## 核心查找链（`src/i18n/index.ts`）

`t(key, params?)` 的解析顺序（命中即返回，全部未命中返回 key 本身）：

```
用户自定义覆盖层  svt:i18n-overrides:<tag>   （语言子页 → 编辑词条，最高优先级）
  → 内置词典      DICTS[locale]               （zh-CN / zh-TW / en / ja / lzh / es / fr / bo）
  → AI 词典       aiDicts.get('ai')           （registerAiDict 注入的运行时层）
  → zh-CN 基准回退 zhCN[key]                  （所有未翻译词条的兜底）
```

要点：

- **React 无关**：`t()` 是模块级纯函数，任何非 React 代码（Canvas 画笔、DSP、备份）
  都可直接调用；React 侧经 `useI18n()` 取用。
- **占位符**：`{name}` 形式，`t('toast.jsonExported', { n: 5 })` 插值；未知占位符原样保留。
- `DictKey = keyof typeof zhCN`：**zh-CN 词典是类型层面与运行时的双重基准**，
  所有键必译性由 `src/i18n/i18n.test.ts` 校验（键集合一致、占位符集合一致、无空串）。
- `setLocale(locale)` 幂等但**总是同步 `<html lang>`**（AI 语言用其 slug），
  语言真正变化时 `bump()` 递增版本号。
- `localeTag()` 返回当前语言的 BCP-47 标签：内置语言即其 id，AI 语言为 slug
  （如 `deutsch`），供 `toLocaleString` 与覆盖层分库使用。

## 订阅与重渲染（`src/i18n/hook.ts`）

词典变化有两条路径，`useI18n` 对两条都订阅：

1. **settings.language 变化**（useStore 订阅）→ 渲染期 `setLocale(language)`；
2. **词典版本 bump**（`registerAiDict` / `setOverride`）→ `useSyncExternalStore(subscribeI18n, getI18nVersion)`。

这就是「编辑词条保存后界面立即变化」「AI 词典生成完成自动切换」的机制。
`useI18n()` 返回 `t` 本身——组件**没有**按词条粒度的细粒度订阅，词典变化会重渲染
所有调用了 `useI18n` 的组件（当前规模下足够快）。

## 用户自定义覆盖层

- 存储：`localStorage['svt:i18n-overrides:<localeTag>']`，纯 `{ key: text }` JSON。
- **AI 语言按 slug 分库**（`deutsch` 与 `français` 互不串扰）；重新生成 AI 词典
  不会清除覆盖（用户意图优先于机器翻译）。
- API：`getOverride(key)` / `setOverride(key, value|null)`（当前语言维度，
  null 或空串即移除）；`overrideCount()`。
- UI 入口：语言子页 → 编辑词条 → `EditStringsSheet`（搜索键 / 简中原文 /
  当前译文，逐条编辑，带「已自定义」标记与「重置」）。

## 内置语言

| id | 说明 |
| --- | --- |
| `zh-CN` | 基准（原始文案） |
| `zh-TW` | 繁体 |
| `en` | 英语（机翻；默认界面语言） |
| `ja` | 日语（机翻） |
| `es` | 西班牙语（机翻） |
| `fr` | 法语（机翻） |
| `bo` | 藏语（备注「雪豹」，选择器中以该备注代替「机器翻译」） |
| `lzh` | 文言（彩蛋，完整翻译） |
| `ai` | AI 翻译语言（词典运行时注入，见下） |

`LOCALES` 项可带 `machine?: boolean`（显示「机器翻译」）或 `note?: string`
（显示自定义备注，如藏语的「雪豹」）；`localeRemark()` 统一给出选择器要显示的备注文字。

新键流程：先在 `zh-CN.ts` 加键 → 其余七个词典补译 → `i18n.test.ts` 会在 CI 里
拒绝漂移。en / ja / es / fr / bo 允许不完美，用户可用「编辑词条」自行修正。`note` 备注（如「雪豹」）为固定文案，不随界面语言翻译。

## AI 翻译语言管线（`src/i18n/aiLocale.ts`）

把 zh-CN 基准词典交给 设置 → 大模型 的活动档案（OpenAI 兼容 / Anthropic 协议的
chat 接口，档案存 IndexedDB、经 `llmActiveProfileId` 异步解析）翻译成任意目标语言，
产出一份「AI 语言词典」作为第 6 种界面语言。

### 缓存结构

`localStorage['svt:i18n-ai:<slug>']`：

```jsonc
{
  "label": "Deutsch",     // 用户输入的语言显示名
  "dict": { "nav.test": "Testen", ... },  // key 与 zh-CN 键一致
  "model": "deepseek-chat",
  "at": 1730000000000
}
```

slug（`aiSlug`）：显示名小写、非 `[a-z0-9]` 折叠为 `-`，截 24 字符，空则 `custom`。

### 生成与增量补全

- `generateAiLocale(label, cfg, onProgress, { glossary?, signal? })`：**全量**。
  基准约 1202 键（zh-CN 词典现有规模），每批 `BATCH = 90` 条一次请求（约 14 批），
  进度按批上报。
- `translateMissing(label, cfg, onProgress, opts)`：**增量**。只翻译缓存缺失的键
  （应用升级新增界面文案后），并入现有词典保存。缺失键清单：`missingKeys(label)`；
  已覆盖词条数可经 `cacheCoverage(label)` 查询（语言子页展示「已覆盖/总数」）。
- 两者共享 `translateInto`：开始时与每批完成后各上报一次
  `TranslateProgress { frac, batch, totalBatches, entriesDone, entriesTotal }`
  （batch 为已完成批次数，0 起始）——语言子页的进度条与
  「第 x/y 批 · 已翻译 m/n 条」明细由此驱动。
- 提示词（`systemPrompt`）：角色 + 占位符保护 + 技术术语白名单
  （F0/F1/F2/MPT/CPPS/HNR/Jitter/Shimmer/YIN/pYIN/MPM/LPC/P10/P90/CSV/JSON/
  PWA/WebDAV 等不译）+ **用户术语表**（每行「中文 = 译文」，
  `parseGlossary` 解析，= / → / : 均可）+ 仅输出 JSON。
  `parseBatch` 只接受请求中存在的键与非空字符串，模型编造的键一律丢弃。
- 完成后：写缓存 → `registerAiDict(label, dict, slug)` → `bump()` →
  **界面自动切换到该 AI 语言**（写入 `settings.language = 'ai'` 与
  `aiLanguage`，并 toast 提示），不再以"当前已处于 AI 语言"为前提。

### 后台任务（`src/i18n/aiTranslateTask.ts`）

生成/补全跑在**模块级单例的后台任务**里——切页、设置子页卸载都不中断：

- 状态机 `idle | running | done | error | cancelled`，环形日志上限 60 条；
- API：`startAITask()` / `subscribeAITask` / `getAITaskState()` / `cancelAITask()`
  （取消经 `AbortSignal`，已完成批次保留在缓存中，续跑即增量补全）；
- 语言子页的进度卡经 `useSyncExternalStore(subscribeAITask, getAITaskState)` 订阅。

### 词典分享

- 导出：`buildAiLocalePayload(cache)` → `{ app: 'simple-voice-tools-for-trans', kind: 'ai-locale', version: 1, exportedAt, label, model, generatedAt, dict }`。
- 导入：`parseAiLocalePayload(json)` 校验 app/kind/version（版本过新拒绝），
  **dict 仅保留基准中存在的键**（防脏文件），然后 `importAiCache`（写缓存 + 注册）。

### 启动恢复与缺失提示

- `main.tsx`：`settings.language === 'ai'` 时 `hydrateAiLocale(aiLanguage)`；
  缓存丢失（被清）则回退默认语言。
- `App.tsx` 挂载时：当前语言为 AI 且 `missingKeys().length > 0` → toast 提醒一次
  去语言子页补全（应用升级新增词条的场景）。

## 首次启动语言检测（`main.tsx`）

无 `svt:settings:v1` 时读 `navigator.languages` 匹配内置语言：
`zh-CN/zh-Hans → zh-CN`；`zh-TW/zh-HK/zh-MO/zh-Hant → zh-TW`；`ja* → ja`；
`es* → es`；`fr* → fr`；`bo* → bo`；其余 zh 系回退 `zh-CN`；都不匹配 → 默认英文。
检测结果同步写入持久化设置，此后与显式选择无异。

## 持久化键一览（本子系统）

| 键 | 内容 |
| --- | --- |
| `svt:i18n-ai:<slug>` | AI 语言词典缓存 |
| `svt:i18n-overrides:<tag>` | 用户自定义词条（tag = localeTag，AI 按 slug） |

其余应用级键见 [ARCHITECTURE-STATE.md](./ARCHITECTURE-STATE.md)。

## 应用内文档（与本子系统无关，顺带说明）

设置 → 关于 的「使用说明」不走 i18n 词典：构建时把 `public/guide.md`（仅简体中文
一个版本）打进产物，运行时 `GuideSheet` 以 `fetch(BASE_URL + 'guide.md')` 拉取、
内置极简 Markdown 渲染器展示，Service Worker 预缓存使其可离线阅读。开发者文档
（`documentation/`）在关于页以 GitHub 源文件链接提供，不参与八语言键集校验。

## 给开发者的约定

1. **新界面文案必须进 zh-CN 词典**，用 `t('key')` 而非字面量；英文界面同样如此。
2. 新增词条后无需更新 AI 词典——缺失词条回退中文，用户会收到补全提示；
   但发布说明里可提醒 AI 语言用户补全。
3. 更新 `settings.updateNotes`（应用子页「本次更新内容」）时，八个语言都改。
4. 占位符名在各语言中不可增删（漂移测试强制）。
