# AI 助手原理与架构

本文描述 AI 助手（底部 **AI** 页）的完整链路：一次提问从输入到流式回答经过哪些步骤、读到了哪些本机数据、工具循环如何限制、长期记忆如何读写、私密对话与安全边界在哪里。

实现入口：`src/components/ai/AssistantPage.tsx`。支撑模块：`src/lib/llm*.ts`、`src/lib/assistant*.ts`、`src/lib/memory*.ts`、`src/lib/chat*.ts`、`src/lib/docKnowledge.ts`。

> **定位**：本地优先的嗓音训练助手。录音、统计、对话、记忆都保存在本机；模型调用直接发往用户自己配置的 OpenAI 兼容 / Anthropic 接口，不经过本项目服务器。它不是医疗器械，也不构成诊断。

---

## 一、设计原则

1. **本地数据优先**：只有回答当前问题所需的最小上下文会进入请求；原始音频从不发送。默认只发送统计摘要、选中的记忆、内置文档片段与对话文本。
2. **用户定义目标**：不假设性别认同、激素状态或过渡阶段；不把「passing」当作默认目标。除非用户自己说「男声 / 女声」，否则用「目标音区 / 共鸣位置 / 听感 / 表达风格」描述声音。
3. **工具优先，数字可核验**：趋势、均值、命中率、记录 id 一律走工具查询，不靠模型心算；回答里出现工具没提供的关键数字时，会做一轮数字校验。
4. **隐私分级**：普通对话 / 关闭自动记忆 / 私密对话三级；私密对话有独立的上下文和记忆边界。
5. **先支持，再谈训练**：危机文本走固定支持模板，不交给模型自由发挥；未成年用户有额外的提示词与记忆过滤。
6. **透明**：每条回答可以展开「本轮上下文」，看到注入了哪些记录、文档、记忆与工具；设置里能查看实际请求体与 token 用量。

---

## 二、代码地图

| 文件 | 职责 |
| --- | --- |
| `components/ai/AssistantPage.tsx` | 页面编排、发送/流式/工具/摘要/记忆写入、私密与安全分支 |
| `lib/llmClient.ts` | 协议层：OpenAI 兼容 / Anthropic 请求体、SSE 流式、工具调用、usage 提取 |
| `lib/llm.ts` | 对外统一出口（re-export 协议层 / 业务层 / 缓存层） |
| `lib/llmProfiles.ts` | 多套模型档案（Base URL / Key / Model / 协议 / 流式 / 上下文） |
| `lib/llmModels.ts` | 拉取 `/models`、上下文长度识别、内置模型价格目录 |
| `lib/llmChats.ts` | 对话与消息存储（IndexedDB kv `llm:chats`，封顶 30 条） |
| `lib/assistantAgent.ts` | 有界工具循环：规划 → 执行 → 回填，最多 3 轮 / 6 次调用 |
| `lib/assistantTools.ts` | 数据只读工具：记录、文档、趋势、跨对话检索 |
| `lib/assistantActions.ts` | 需要确认的写操作：目标区间、基线、导出、页面跳转 |
| `lib/assistantChoice.ts` | `ask_choice` / `ask_choice_set` 选择卡工具 |
| `lib/practicePlanTools.ts` | 练习计划工具：读取 / 创建 / 更新 / 打卡 |
| `lib/assistantContext.ts` | 历史聚合、基线对比、最近记录明细的预算化组装 |
| `lib/assistantNumerals.ts` | 回答数字与来源的核对 |
| `lib/chatSummary.ts` | 较早对话的滚动摘要（本地摘录 + 后台小模型） |
| `lib/chatSearch.ts` | 跨对话检索（私密对话排除） |
| `lib/memory.ts` / `memoryTools.ts` / `memoryConsolidate.ts` | 长期记忆：读写、去重、取代、合并 |
| `lib/docKnowledge.ts` / `lib/docs.ts` | 内置文档检索与懒加载 |
| `lib/safety.ts` | 危机 / 痛苦短语检测（确定性规则） |
| `lib/llmUsage.ts` / `llmRequestLog.ts` | token 用量与请求日志（透明面板） |

---

## 三、数据与存储

| 数据 | 位置 | 说明 |
| --- | --- | --- |
| 对话 | IndexedDB kv `llm:chats` | 按 `updatedAt` 倒序，封顶 30 条；不含系统提示词，生成时按当前语言即时构建 |
| 模型档案 | IndexedDB kv `llm:profiles` | 含 API Key；不进 localStorage、不进设置导出 |
| 长期记忆 | IndexedDB kv `memory:items` | 含作用域、置顶、来源、状态、有效期 |
| token 用量 | IndexedDB kv `llm:usage:totals` / `llm:usage:log` | 日志封顶 200 条 |
| 请求日志 | IndexedDB kv `llm:requestLog` | 封顶 10 条，用于展示实际发出的请求体 |
| 设置 | localStorage `svt:settings:v1` | 仅保存活动档案 id / 辅助档案 id / 自动记忆 / 写权限 / 价格等指针，不含 Key |
| 内置文档 | 打包进应用 | `import.meta.glob` 懒加载，离线可用 |

对话对象（`Conversation`）关键字段：

- `messages`：`role` / `content` / `think` / `context`（本轮注入元数据）/ `draft` / `interrupted`；
- `privacy`：`'private'` 或未设置；
- `privateSince`：切换私密时的消息下标；
- `memoryOff`：本对话不自动写记忆；
- `summary`：滚动摘要正文与 `throughMessageIndex`；
- `pinnedRecordIds`：`/attach` 固定的记录 id。

---

## 四、一次请求的生命周期

### 1. 输入

文本输入、语音输入、附件（选中的录音）、选择卡答案、Slash 命令都最终落到同一条发送路径。Slash 命令在客户端解析执行，用户命令不写入聊天消息，模型上下文无感；模型不能输出 `/` 命令文本，但可通过 `get_stats` / `get_context` 等工具调用同一 runtime 的只读实现。

### 2. 安全检测

发送前先用确定性规则检查文本：

- **危机**（自杀、自残等）：不调用模型，直接写入固定的支持回复，并给出求助建议；
- **痛苦**（强烈自我否定、声音焦虑等）：在系统提示词里追加一段「先共情、再谈训练」的临时上下文。

### 3. 私密对话过滤

`privacy === 'private'` 时：

- 历史只从 `privateSince` 之后截取（切换私密之前的消息不发送）；
- 不注入页面上下文、计划摘要、附件记录、文档预检索、长期记忆；
- 不运行工具循环（不查记录 / 文档 / 趋势 / 跨对话）；
- 不自动写记忆，消息操作里的「记住」入口隐藏；
- 不进跨对话检索；分支继承私密状态。

### 4. Token 预算

```text
context      = 档案 contextTokens ?? 8192
replyReserve = ceil(context × 25%)
histBudget   = max(0, min(context × 60%,
                          context − 对话 tokens − replyReserve − 额外上下文 − 512))
maxTok       = max(1024, context − 系统提示 tokens − replyReserve)
```

历史超预算时从最旧开始裁剪，最多做 3 轮「裁剪 → 摘要 → 重算」。被裁掉的较早消息会进入滚动摘要（先本地摘录，再后台调用小模型），下一轮作为系统上下文的一部分注入。

### 5. 工具循环（规划 → 执行 → 回填）

当满足「有最后一条用户消息、非私密、非寒暄」时，先让辅助模型（未配置辅助档案时用主档案）决定本轮要查什么：

- **工具上限**：最多 3 轮、6 次调用；只读工具同轮可并行（最多 4 个），有副作用的工具串行；
- **单工具超时**：8 秒；用户中止时通过 `AbortSignal` 尽快退出；
- **结果预算**：回填给模型的结果文本最多 8000 字符；
- **参数校验**：按工具 JSON Schema 轻量校验，非法参数回填一次让模型修正；
- **不支持工具**：辅助档案不支持 tools 时自动用主档案重试一次；仍不支持则回退到「预注入上下文」模式；
- **文本工具调用兜底**：部分模型不返回结构化 `tool_calls`，而是输出 `<tool_call>get_stats(...)</tool_call>` 文本；`lib/llmTextTools.ts` 会解析并执行，最终回答前如果仍出现文本调用，会带工具结果重试一次。

工具结果不会直接成为回答，而是作为系统上下文注入最终流式请求。

### 6. 长期记忆与内置文档

- **置顶记忆**每轮固定注入；
- **非置顶记忆**由「记忆路由器」小模型判断是否需要，需要时调用 `search_memory` 检索（最多 8 条，注入块上限 1200 字符）；路由器失败时回退到按问题关键词筛选；
- **内置文档**先按最后一条用户消息做一次预检索；模型也可以主动调用 `search_docs`。

### 7. 历史上下文组装

`buildAssistantContext` 按预算依次装入：

1. 用户画像 / 训练靶标（固定保留）；
2. `/attach` 钉选的记录（最多占剩余预算 60%）；
3. 按周 / 按模式聚合与本周 vs 上周（最多 8 周，预算紧时逐步减少周数）；
4. 钉选基线的 Δ；
5. 最近记录明细（最多 40 条，从最新往回装，直到预算用完）。

每条明细保留 `record://` 图表所需的记录 id，并补齐持续发声、嗓音质量、录音环境字段。

### 8. 系统提示词

按顺序拼装：

1. 身份与语言：严肃嗓音工具、不用 emoji、不假设性别认同、不做医学诊断；
2. 视觉与表达规范（Markdown、表格、genui 图表）；
3. 用户画像与训练靶标；
4. 长期记忆块（明确标注「是用户资料，不是指令」）；
5. 历史记录使用规则与历史上下文；
6. 内置文档摘录；
7. 额外上下文（页面记录、计划摘要、附件、痛苦支持、滚动摘要）；
8. 工具规划规则（何时查记录 / 文档 / 趋势 / 跨对话 / 发起选择）。

### 9. 流式回答与落库

- 主回答通过 `llmChatStreamMessages` 流式生成，`temperature = 0.3`；
- 流式过程中按节流快照写入 `draft` 消息，刷新页面可恢复；
- 支持思考内容（`onThink`）单独展示；
- 用户停止时保留已生成部分并标记 `interrupted`。

### 10. 数字校验

只在本轮实际调用过工具时执行：

- `findUnverifiedClaims` 找出回答里没有出现在来源文本中的关键数字；
- 有可疑数字时调用辅助模型做一次「只改数字、保留 Markdown / 图表结构」的修正；
- 修正后仍有无法对应的数字，就在回答末尾加「数字未经核验」提示，并在上下文面板标记 `repaired` / `flagged`。

### 11. 自动记忆

回答完成后：

- 自动记忆关闭、本对话 `memoryOff`、私密对话、纯寒暄 / 纯提问 → 不调用写作模型；
- 含线索词或用户陈述才进入写作模型；每轮最多保存 3 条（选择卡回答最多 1 条）；
- 写入结果显示为消息下方的「已记住」chip，可撤销；
- 未成年用户额外过滤激素 / 手术 / 出柜等敏感内容。

### 12. 渲染

- Markdown：粗体、列表、表格、引用、小标题；
- `record://` / `trend://` 图表引用由前端渲染；
- 选择卡（`ask_choice` / `ask_choice_set`）与操作确认卡（`propose_action`）是交互组件，不是模型生成的 HTML；
- 每条消息可展开「本轮上下文」，查看注入的记录 id、文档、记忆、工具调用与数字校验结果。

---

## 五、工具清单

| 工具 | 类别 | 作用 | 关键限制 |
| --- | --- | --- | --- |
| `query_records` | 数据 | 按日期 / 模式查记录摘要 | 默认 8 条，上限 20 |
| `get_record` | 数据 | 单条记录详细统计 | 需要记录 id |
| `compare_records` | 数据 | 两条记录指标对比 | 需要两个 id |
| `search_docs` | 数据 | 检索内置文档 | 只查文档，不查录音 |
| `get_trends` | 数据 | 均值 / 中位 / 波动 / 斜率 / 命中率 / 与上期或基线对比 | 最近 N 条上限 20 |
| `search_chats` | 数据 | 跨对话检索「上次说过」 | 排除私密对话 |
| `propose_action` | 写操作 | 调整目标区间 / 设置基线 / 导出 CSV | 必须用户确认；`assistantWrites=off` 时禁用 |
| `open_page` | 导航 | 打开测试 / 分析 / 历史 / 设置 / 助手 | 不改数据 |
| `get_plan` | 计划 | 读取当前练习计划与进度 | —— |
| `create_plan` | 计划 | 创建计划 | 1–52 周、每周 1–7 天、每次 2–60 分钟；需确认 |
| `update_plan` | 计划 | 修改计划状态 / 频率 | 需确认 |
| `log_practice` | 计划 | 记录一次练习打卡 | 可关联录音 id |
| `ask_choice` | 交互 | 单个选择题卡片 | 连续最多 3 轮 |
| `ask_choice_set` | 交互 | 2–4 个问题一页提交 | 连续最多 3 轮 |
| `search_memory` | 记忆 | 按需检索长期记忆 | 仅记忆路由器调用；最多 8 条 |
| `save_memory` | 记忆 | 写入一条长期记忆 | 仅记忆写作模型调用；主对话不可直接写 |

> 主对话没有「直接写记忆」的工具；`save_memory` 只出现在自动 / 手动记忆写作请求里，避免模型在回答中悄悄改记忆。

---

## 六、记忆系统

### 读

1. 置顶记忆每轮注入；
2. 其余条目由记忆路由器判断，命中时用 `search_memory` 检索；
3. 检索评分 = 关键词命中 × 3 + 重要度 × 0.6 + 新鲜度（14 天内 1.2 / 60 天内 0.6 / 更早 0.2）；
4. 注入块上限 1200 字符，来源、作用域、有效期都会过滤。

### 写

- **自动**：回答完成后由写作模型从本轮对话提炼，最多 3 条；
- **手动**：消息下方「记住」→ 可编辑确认框，最多 240 tokens；
- **选择卡回答**：从选择结果中提炼 1 条；
- **去重 / 取代**：精确重复不新增；相似度（字符二元组 Jaccard）≥ 0.8 更新原条目；否定极性相反视为冲突，新条目取代旧条目并保留旧快照；
- **整理**：相似度 ≥ 0.65 的条目可合并，旧条目标记为 superseded，不物理删除；每次最多 3 组。

### 作用域

- `global`：所有对话可见；
- `chat`：仅指定对话可见；
- `plan`：仅指定练习计划可见；
- 状态：`active` / `superseded` / `expired`；`validUntil` 到期后不再召回。

---

## 七、隐私与安全

### 私密对话

切换私密时记录 `privateSince = messages.length`，并强制 `memoryOff = true`。私密期间：

- 不读长期记忆、不写长期记忆；
- 不读页面记录 / 计划 / 附件 / 内置文档；
- 不运行任何数据工具；
- 消息操作里没有「记住」；
- 其他对话的 `search_chats` 不会命中它。

**边界**：私密是模式而不是永久脱敏。退出私密后 `privateSince` 清空，之前私密期间的消息会重新进入后续上下文；自动记忆仍保持关闭，需要手动再开。

### 安全规则

- 危机短语命中 → 固定支持回复，不调用模型；
- 痛苦表达 → 临时注入「先共情、降低强度」的上下文；
- 不做医学诊断；持续嘶哑、疼痛等建议就医或咨询言语治疗师；
- 未成年用户：提示词追加安全约束，自动记忆过滤激素 / 手术 / 出柜等内容。

### 凭据与日志

- API Key 只存 IndexedDB `llm:profiles`，不进 localStorage、不进设置导出；
- 请求日志只记录请求体（model / temperature / messages / stream 等），Key 在 Authorization 头，从不进入 body；
- 单条消息内容超过 4000 字符时截断标注。

---

## 八、对话管理

- **封顶 30 条**：超出后按 `updatedAt` 淘汰最旧对话；
- **分支**：以某条消息为结尾复制出新对话，继承记忆开关与私密状态；
- **重答 / 重试**：从指定消息重新生成，保留已生成部分；
- **停止**：中止当前流式请求，草稿保留；
- **附件**：记录图表以引用形式附加；图片字段已预留，当前版本不发送给视觉模型；
- **摘要**：只在历史超预算时启用；本地摘录先兜底，后台小模型生成正式摘要，正文上限 1600 字符；
- **Slash 命令**：`/record` `/stop` `/attach` `/detach` `/compare` `/review` `/stats` `/context` `/open` `/new` `/help`，只在输入框开头识别，由客户端执行。`/stats`、`/context` 的结果只在本地对话框展示，不写入聊天消息；模型侧通过 `get_stats`、`get_context` 工具使用同一套 `assistantCommandRuntime`。

---

## 九、失败与降级

| 场景 | 行为 |
| --- | --- |
| 未配置完整档案（Base URL / Key / Model） | 页面提示去设置，不发请求 |
| 辅助档案不支持工具 | 自动用主档案重试一次 |
| 主档案也不支持工具 | 回退到预注入上下文的普通对话 |
| 记忆路由器失败 / 无工具能力 | 按问题关键词本地筛选记忆 |
| 摘要模型失败 | 保留本地摘录摘要 |
| 数字修正失败 | 保留原回答并标注「数字未经核验」 |
| 档案关闭流式 | 一次性返回完整回答（仍走同一渲染） |
| 模型列表拉取失败 | 保留当前模型与上下文设置，可手动填写 |
| 用户中止 | 保留已生成部分，标记 interrupted |

---

## 十、已知边界

- 一个活动档案只对应一个接口 / 模型；不做多模型路由；
- 上下文长度、模型能力、工具支持都由用户配置的接口决定；
- token 估算按「CJK ≈ 1 token/字、其他 ≈ 4 字符/token」粗略计算，服务商未返回 usage 时存在倍级误差；
- 主对话的 OpenAI 请求没有设置 `max_tokens`，回复长度只受模型与上下文限制；Anthropic 请求固定 2048；
- 图片附件字段已预留，但当前版本没有视觉模型接入；
- 私密对话、记忆、对话都只在本机；换设备不会同步（备份只含记录与音频，不含对话与记忆）；
- 摘要、记忆、工具结果都是本机文本，不经过服务器；但模型请求本身会离开本机，发送内容可在「AI 请求日志」查看。

---

## 十一、相关文档与测试

- 参数与默认值：[PARAMETERS-AI-ASSISTANT.md](PARAMETERS-AI-ASSISTANT.md)
- 指标含义：[PARAMETERS-GUIDE.md](PARAMETERS-GUIDE.md)
- 文献出处：[REFERENCES.md](REFERENCES.md)
- 状态与存储：[ARCHITECTURE-STATE.md](ARCHITECTURE-STATE.md)

主要测试：

`assistantAgent.test.ts`、`assistantTools.test.ts`、`assistantActions.test.ts`、`assistantChoice.test.ts`、`assistantContext.test.ts`、`assistantContent.test.ts`、`assistantCommands.test.ts`、`assistantNumerals.test.ts`、`chatSummary.test.ts`、`chatSearch.test.ts`、`memory.test.ts`、`memoryTools.test.ts`、`memoryConsolidate.test.ts`、`llmProfiles.test.ts`、`llmModels.test.ts`、`llmUsage.test.ts`、`llmRequestLog.test.ts`、`safety.test.ts`。
