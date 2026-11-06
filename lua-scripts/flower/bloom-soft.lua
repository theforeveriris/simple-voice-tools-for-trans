-- 柔和模版花（示例花朵脚本）
-- 无语谱数据（bands 为空）也能用：固定 12 瓣、正弦调制瓣长与明度。
-- 花心 / 基线由 F1 / F2 微调，不依赖频带摘要。
-- stats 字段见 lua-scripts/README.md

function flower(stats)
  local n = 12
  local petals = {}
  for i = 1, n do
    local phase = (i - 1) / n * math.pi * 2
    table.insert(petals, {
      angleDeg = (i - 1) * 360 / n,
      length = 0.45 + 0.35 * math.sin(phase),
      lightness = 0.5 + 0.5 * math.cos(phase),
    })
  end

  local avgF1 = stats.avgF1 or 600
  local avgF2 = stats.avgF2 or 1500
  return {
    petals = petals,
    coreF1 = math.max(0.5, math.min(1.2, avgF1 / 1000)),
    baselineF2 = math.max(0.6, math.min(1, avgF2 / 2400)),
    tipSharpness = 0.5,
  }
end
