-- 暗色极简卡（示例分享卡模板）
-- 定义 template(record) 返回绘制指令数组，画布 1080×1350、安全边距 72px。
-- 可用指令：bg / text / rect / circle / line / pitch（迷你音高曲线）/ ruler（音域标尺）/ qr（页脚二维码）
-- record.stats 字段与建议脚本相同；record 另有 mode/note/createdAt。
-- 文档见 lua-scripts/README.md

local INK = "#F2F0F7"
local INK2 = "#A9A4B8"
local ACCENT = "#8B7CE8"
local SURFACE = "#211E2B"

function template(record)
  local s = record.stats
  local ops = {}

  -- 背景（纯色或 top/bottom 渐变）
  table.insert(ops, { op = "bg", top = "#17151D", bottom = "#241E31" })

  -- 页眉：应用名 + 日期
  table.insert(ops, { op = "circle", cx = 81, cy = 86, r = 9, color = ACCENT })
  table.insert(ops, { op = "text", x = 102, y = 100, text = "Simple Voice Tool for Trans",
    size = 30, weight = 500, color = INK2 })
  local d = os and "" or "" -- os 已被沙箱移除；日期由宿主绘在 qr 区，模板用 createdAt 时间戳自行换算亦可
  -- 简化：直接显示时间戳日期（epoch ms → 无 os 库，改由宿主注入的 record.dateStr 使用）
  table.insert(ops, { op = "text", x = 1008, y = 100, text = record.dateStr or "",
    size = 30, weight = 500, color = INK2, align = "right" })

  -- 平均基频大字
  table.insert(ops, { op = "text", x = 72, y = 340, text = string.format("%.1f", s.avgF0),
    size = 128, weight = 600, color = INK })
  table.insert(ops, { op = "text", x = 72 + 360, y = 340, text = "Hz",
    size = 40, weight = 400, color = INK2 })

  -- P10–P90 音域行
  table.insert(ops, { op = "text", x = 72, y = 420,
    text = string.format("P10 %d  –  P90 %d Hz", s.p10F0, s.p90F0),
    size = 34, weight = 400, color = INK2 })

  -- 音域标尺（内置绘制，y = 标尺顶部）
  table.insert(ops, { op = "ruler" })

  -- 迷你音高曲线面板（内置绘制）
  table.insert(ops, { op = "rect", x = 72, y = 500, w = 936, h = 400, color = SURFACE, radius = 28 })
  table.insert(ops, { op = "pitch" })

  -- 统计四格
  local items = {
    { "F1", s.avgF1 and string.format("%d Hz", s.avgF1) or "—" },
    { "F2", s.avgF2 and string.format("%d Hz", s.avgF2) or "—" },
    { "Sec", string.format("%.1f", s.durationSec) },
    { "dB", string.format("%.1f", s.avgDb) },
  }
  for i, it in ipairs(items) do
    local x = 72 + (i - 1) * 234
    table.insert(ops, { op = "text", x = x, y = 1000, text = it[1], size = 24, weight = 400, color = INK2 })
    table.insert(ops, { op = "text", x = x, y = 1044, text = it[2], size = 36, weight = 600, color = INK })
  end

  -- 页脚二维码 + 署名（内置绘制）
  table.insert(ops, { op = "qr" })

  return ops
end
