-- 长音稳定度体检（示例脚本）
-- 看 CV（stdF0 / 中位基频）与微扰指标：波动大 → 练慢速长音；
-- 无频谱数据时 jitter/shimmer 为 nil，只看 CV。
-- stats 字段见 lua-scripts/README.md；输出 { text, level } 数组（最多 3 条）

function advise(stats)
  local tips = {}
  local ref = stats.medianF0 > 0 and stats.medianF0 or stats.avgF0

  if ref > 0 then
    local cv = stats.stdF0 / ref
    if cv > 0.22 then
      table.insert(tips, { level = "warn",
        text = string.format("基频波动 CV 约 %d%% 偏大，练「5 秒长音 + 5 秒休」循环", math.floor(cv * 100)) })
    elseif cv < 0.06 then
      table.insert(tips, { level = "info", text = "基频波动很小，适合短促干净的元音切换练习" })
    end
  end

  if stats.jitterPct and stats.jitterPct > 1.04 then
    table.insert(tips, { level = "info",
      text = string.format("Jitter %.2f%% 偏高，声带张力不稳，先半声过渡再上完整音高", stats.jitterPct) })
  end

  if stats.shimmerPct and stats.shimmerPct > 6 then
    table.insert(tips, { level = "info",
      text = string.format("Shimmer %.1f%% 偏高，嗓音略带嘶声，用叹气式发声放松声带", stats.shimmerPct) })
  end

  if #tips == 0 then
    table.insert(tips, { level = "info", text = "长音质量稳定，可以进入共鸣定位练习了" })
  end
  return tips
end
