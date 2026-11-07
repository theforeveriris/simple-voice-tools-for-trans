# 记录导出格式开放标准（records v2）

Simple Voice Tool for Trans 的所有记录数据（手动导出 JSON、完整备份 ZIP 内的 `records.json`、
GitHub 云备份）共用同一开放格式。外部工具可以按本文档与
[records-v2.schema.json](schema/records-v2.schema.json)（JSON Schema 2020-12）直接读写。

## 设计原则

- **零闭锁**：格式是纯 JSON，无专有序列化；删除本应用后数据依旧可读
- **向后兼容**：应用读取器接受 `version` 缺失 / `1` / `2`，并忽略未知字段（记录对象上
  `additionalProperties: true`）。公开的 v2 JSON Schema 把 `version` 写成 `const: 2`，
  只用于校验 v2 文件；校验 v1 时应把该约束放宽为 `1` 或缺失
- **缺失即 null**：帧级未检出用 `null`（JSON 文件内）；JS 内存中的 NaN 在导出前会转为 null

## 顶层结构

```json
{
  "app": "simple-voice-tools-for-trans",
  "version": 2,
  "exportedAt": "2026-01-31T00:00:00.000Z",
  "records": [ /* AnalysisRecord 数组，见 Schema */ ]
}
```

`app` 标识有两个合法取值：`simple-voice-tools-for-trans`（当前）与
`simple-voice-tools`（旧版本 id，读取方应一并接受——见 `src/lib/appId.ts`）。

## 字段速览

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 唯一 id；合并去重以此为准 |
| `createdAt` | integer | epoch 毫秒 |
| `durationSec` / `sampleHz` | number | 时长（秒）/ 序列采样率（≈30 fps） |
| `mode` | string? | `reading` / `sustained` / `glide`；v1 缺失 |
| `series` | object | 帧级序列：`t` / `f0` / `rmsDb` 必备，`f1` / `f2` 可选（等长，未检出 = null） |
| `stats` | object | 聚合统计（必备 16 个标量 + 可空指标） |
| `spec` | object? | 语谱量化：64 频带 × 行 Uint8 base64 |
| `env` | object? | 环境元数据：`noiseFloorDb` / `micLabel` / `hourOfDay`（v2 新增） |
| `reanalyzedAt` | integer? | 用当前算法参数重算的时间（epoch ms） |
| `paramsFp` | string? | 重算时的算法参数指纹 |
| `note` | string? | 用户备注 |

完整定义见 [records-v2.schema.json](schema/records-v2.schema.json)。

## 校验工具

应用内置了轻量校验器（`src/lib/export/recordsSchema.ts`），用于显式检查文件是否符合
公开 Schema；实际导入链路（`parseRecordsPayload`）保持**宽容读入**——只解析结构与
版本上限（过新版本拒绝），不在导入时逐条报告 Schema 错误。外部工具也可以用任意
JSON Schema 校验器对着 Schema 文件验证：

```bash
# ajv-cli 需配 draft 2020-12 与 ajv-formats（schema 里用了 format: date-time）
npx --package ajv-cli --package ajv-formats ajv validate \
  --spec=draft2020 -c ajv-formats \
  -s documentation/schema/records-v2.schema.json -d your-export.json
```

## 与 Praat 互操作

应用内已内置 Praat 导出（PitchTier / Formant 文本对象），
Lua 脚本桥（脚本中心 → export 类脚本）可按任意方言重组帧级数据。

## 版本策略

- 新增可选字段 → 小版本（读取方必须忽略未知字段）
- 破坏性变更 → 主版本 + 读取方按 `version` 显式拒绝（应用对过新版本给出升级提示）
