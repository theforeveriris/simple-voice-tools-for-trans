-- 元音形态与共鸣定位（示例脚本）
-- F1 看开口度、F2 看共鸣前后、F2−F1 间距看前共鸣集中度。
-- 注意：本方向可直接启用多个建议脚本，结果会合并显示。
-- stats 字段见 lua-scripts/README.md；输出 { text, level } 数组（最多 3 条）

function advise(stats)
  local tips = {}

  if stats.avgF1 and stats.avgF1 < 450 then
    table.insert(tips, { level = "info",
      text = string.format("F1 %.0f Hz 偏低、共鸣偏「i」：练开口度用「a→i」来回滑动", stats.avgF1) })
  end

  if stats.avgF2 and stats.avgF2 < 1500 then
    table.insert(tips, { level = "warn",
      text = string.format("F2 %.0f Hz 偏低、共鸣偏后：舌尖前移 + 抬软腭再试", stats.avgF2) })
  end

  local gap = stats.f2f1GapMedianHz or stats.f2f1GapHz
  if gap and gap < 1000 then
    table.insert(tips, { level = "info",
      text = string.format("F2−F1 间距 %d Hz 偏窄：做「i–u」交替，感受共振峰的移动", math.floor(gap)) })
  end

  if #tips == 0 then
    table.insert(tips, { level = "info", text = "元音共鸣形态在常见范围内，继续做元音交替与滑音练习" })
  end
  return tips
end
