# Lua 脚本（Simple Voice Tool for Trans）

用 Lua 脚本自定义 Simple Voice Tool for Trans 的行为。脚本在应用内完全本地执行：
无网络、无文件访问、单次运行限时 500ms，只暴露白名单标准库（`string` / `table` / `math`）。

把 `.lua` 文件放进本目录的子目录（如 `advice/`）即可成为内置脚本；
用户也可以在 **设置 → 实验性功能 → 脚本中心** 直接导入单个 `.lua` 文件，
或把这里整个目录的脚本分享给他人。

## 通用约定

- 每个脚本定义若干**全局函数**，应用按功能类型调用对应函数
- 宿主数据以 Lua 表传入；字段可能缺失（旧记录），访问时注意 nil
- 返回值要求见各功能小节；出错时该脚本被跳过，不影响其他脚本

## advice/ — 训练建议脚本

定义全局函数：

```lua
function advise(stats)
  -- ...
  return { { text = "建议文案", level = "info" }, ... }  -- 最多 3 条
end
```

`level` 取值 `"info"`（普通）或 `"warn"`（强调色显示）。

### stats 字段（`VoiceStats`）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `durationSec` | number | 录音时长（秒） |
| `sampleHz` | number | 序列采样率（Hz） |
| `totalSamples` | number | 总帧数 |
| `voicedSamples` | number | 有声帧数 |
| `avgF0` / `medianF0` | number | 平均 / 中位基频（Hz） |
| `minF0` / `maxF0` | number | 最低 / 最高基频 |
| `p10F0` / `p90F0` | number | 10% / 90% 分位基频 |
| `stdF0` | number | 基频标准差（Hz） |
| `malePct` / `femalePct` / `transitionPct` | number | 音区占比（%） |
| `avgF1` / `avgF2` | number \| nil | 平均共振峰（Hz，可能缺失） |
| `f2f1GapHz` | number \| nil | F2−F1 同帧间距均值 |
| `spectralTiltDbOct` | number \| nil | 谱倾斜（dB/octave） |
| `avgDb` / `peakDb` | number | 平均 / 峰值响度（dBFS） |
| `jitterPct` / `shimmerPct` | number \| nil | 微扰（需保存录音音频） |
| `hnrDb` | number \| nil | 谐噪比（dB） |
| `cppsDb` | number \| nil | 平滑倒谱峰突出度（dB） |
| `inTargetPct` | number \| nil | 靶标达成率（%） |
| `mode` | string | `'reading'` / `'sustained'` / `'glide'` |
| `target` | table | `{ enabled, min, max }` 训练靶标设置 |

> 注意：以上是 `advice` 类脚本的 stats；`filter`（记录过滤器）表达式拿到的是
> **记录级** `record` 表（`record.stats.*` 取统计字段），见下文「过滤器表达式」。

## card/ — 分享卡模板脚本

定义全局函数 `template(record)` 返回**绘制指令数组**，宿主按序在 1080×1350 画布执行
（安全边距 72px，坐标即像素；颜色 `#RRGGBB` 或 `#RRGGBBAA`）：

```lua
function template(record)
  local s = record.stats
  return {
    { op = "bg", top = "#17151D", bottom = "#241E31" },      -- 渐变背景（或 color= 纯色）
    { op = "text", x = 72, y = 340, text = string.format("%.1f", s.avgF0),
      size = 128, weight = 600, color = "#F2F0F7" },          -- 文本（align/mono 可选）
    { op = "rect", x = 72, y = 500, w = 936, h = 400,
      color = "#211E2B", radius = 28, alpha = 1 },            -- 圆角矩形
    { op = "circle", cx = 81, cy = 86, r = 9, color = "#8B7CE8" },
    { op = "line", x0 = 72, y0 = 130, x1 = 1008, y1 = 130, color = "#34303F", width = 2 },
    { op = "ruler" },   -- 内置音域标尺（P10–P90 括条 + 基频游标）
    { op = "pitch" },   -- 内置迷你音高曲线（分音区着色）
    { op = "qr" },      -- 内置页脚二维码 + 仓库署名
  }
end
```

`record` 表字段：`stats`（同上表）、`mode`、`note`、`createdAt`（epoch ms）、
`dateStr`（宿主预格式化的日期串）、`id`。指令数上限 500。

## flower/ — 花朵生成脚本

定义全局函数 `flower(stats)` 返回与内置算法同构的花参数（花园/花卡共用渲染）：

```lua
function flower(stats)
  local petals = {}
  local n = #stats.bands.energy  -- 频带数（无语谱时为 0，可自定瓣数）
  for i = 1, math.max(n, 12) do
    local e = stats.bands.energy[i]  -- 1 基索引
    table.insert(petals, {
      angleDeg = (i - 1) * 360 / math.max(n, 12),  -- 0 = 正上，顺时针
      length = e and (0.18 + 0.82 * e) or 0.5,     -- 0.15–1
      lightness = i / math.max(n, 12),             -- 0–1（低频亮 → 高频深）
      bandHz = stats.bands.hz[i],                  -- 可选
    })
  end
  return {
    petals = petals,
    coreF1 = 0.8,        -- 0.3–1.2（内置：F1 开口度映射）
    baselineF2 = 0.8,    -- 0.4–1（内置：F2 外推）
    tipSharpness = 0.5,  -- 0–1（内置：F2 瓣尖映射）
  }
end
```

`stats.bands = { hz = {...}, energy = {...} }` 是记录语谱的频带能量摘要（能量已
按最大值归一化到 0–1；无语谱为空表，脚本可自定瓣数）。花瓣上限 96。

## export/ — 自定义格式导出脚本（数据格式桥）

定义全局函数 `export(record)` 返回 `{ filename = "...", content = "..." }`，
导出菜单出现「Lua 自定义格式」入口，一键下载脚本产出的任意文本格式。
`record.series.frames` 是帧数组：`{ t, f0, rmsDb, f1, f2 }`（null = 未检出），
`record.stats` 同 advice 表。内容上限 4MB。内置示例 `praat-bundle.lua`
生成「在 Praat 中 Run 即重建 PitchTier 并出图」的脚本——其他生态
（Emu/MOR/CHAT/自定义 CSV 方言）同理接入。

## History 过滤器表达式

搜索框输入 `lua:` 开头的表达式即可按数据过滤记录（无需保存为脚本）：

```text
lua:stats.avgF0 < 150 and record.mode == 'sustained'
lua:stats.jitterPct ~= nil and stats.jitterPct > 1.0
```

表达式包进 `function(stats, record, note)` 执行，真值 = 命中。
`stats` 为上表统计字段，`record` 含 `id / mode / note / createdAt / durationSec`。

## 脚本质量建议

- 开头注释写清：脚本的用途、适配人群（训练方向）、阈值依据
- 缺失字段用 `if stats.cppsDb and ...` 守卫，别假设一定存在
- 文案给出**可执行的动作**（怎么练），而不是只报数字
- 每条建议独立成立：用户可能同时启用多个脚本，应用合并取前 3 条

