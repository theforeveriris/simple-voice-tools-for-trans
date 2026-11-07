-- 放射能量花（示例花朵脚本）
-- flower(stats) 返回与内置算法同构的花参数：
--   petals = { { angleDeg, length, lightness, bandHz }, ... }
--   coreF1 / baselineF2 / tipSharpness
-- 本脚本用 stats.bands 的频带能量做瓣长：能量越强瓣越长。
-- stats 字段见 lua-scripts/README.md

function flower(stats)
  local bands = stats.bands or {}
  local energy = bands.energy or {}
  local hz = bands.hz or {}

  local n = math.max(#energy, 8)
  local maxE = 1
  for i = 1, #energy do
    if energy[i] > maxE then maxE = energy[i] end
  end

  local petals = {}
  for i = 1, n do
    local e = energy[i] or 0
    table.insert(petals, {
      angleDeg = (i - 1) * 360 / n,
      length = 0.2 + 0.7 * (e / maxE),
      lightness = i / n,
      bandHz = hz[i] or nil,
    })
  end

  local avgF1 = stats.avgF1 or 600
  local avgF2 = stats.avgF2 or 1500
  return {
    petals = petals,
    coreF1 = math.max(0.5, math.min(1.2, avgF1 / 1000)),
    baselineF2 = math.max(0.6, math.min(1, avgF2 / 2400)),
    tipSharpness = math.max(0, math.min(1, (avgF2 - 1200) / 2400)),
  }
end
