-- 呼吸支持与声带闭合（示例脚本）
-- HNR 偏低 → 气声过重 / 支持不足；CPPS 偏低 → 声带闭合与共鸣能量不足；
-- 两者都正常时给维持性建议。
-- stats 字段见 lua-scripts/README.md；输出 { text, level } 数组（最多 3 条）

function advise(stats)
  local tips = {}

  if stats.hnrDb and stats.hnrDb < 12 then
    table.insert(tips, { level = "warn",
      text = string.format("HNR %.0f dB 偏低，气声偏多、支持不足：先腹式呼吸 + 哼鸣找气息落点", stats.hnrDb) })
  end

  if stats.cppsDb and stats.cppsDb < 10 then
    table.insert(tips, { level = "info",
      text = string.format("CPPS %.0f dB 偏低，声带闭合与共鸣能量可再提一点，练闭口哼鸣", stats.cppsDb) })
  end

  if stats.jitterPct and stats.jitterPct > 1.04 then
    table.insert(tips, { level = "info",
      text = "Jitter 偏高时先做 3–5 秒长音、数 1 到 10 收尾，再回到短句" })
  end

  if #tips == 0 then
    table.insert(tips, { level = "info", text = "嗓音支持与气声比例在常见范围内，维持每日练声即可" })
  end
  return tips
end
