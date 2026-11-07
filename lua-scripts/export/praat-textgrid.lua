-- Praat TextGrid 导出（示例导出桥）
-- export(record) 返回 { filename, content }；record.series.frames 为帧级序列
-- 产出「短文本」格式的 Pitch tier（.TextGrid 可直接被 Praat 打开读取）

local function num(v)
  if v == nil or v == 0 then return "0" end
  return string.format("%.3f", v)
end

function export(record)
  local frames = (record.series and record.series.frames) or {}
  local dur = record.durationSec or 0
  local lines = {}

  table.insert(lines, 'File type = "ooTextFile"')
  table.insert(lines, '"TextGrid"')
  table.insert(lines, "")
  table.insert(lines, "xmin = 0")
  table.insert(lines, "xmax = " .. num(dur))
  table.insert(lines, "tiers? <exists>")
  table.insert(lines, "size = 1")
  table.insert(lines, "item []:")
  table.insert(lines, "    item [1]:")
  table.insert(lines, '        class = "Pitch"')
  table.insert(lines, '        name = "f0"')
  table.insert(lines, "        xmin = 0")
  table.insert(lines, "        xmax = " .. num(dur))
  table.insert(lines, "        points: size = " .. #frames)

  for i = 1, #frames do
    local f = frames[i]
    table.insert(lines, "        points [" .. i .. "]:")
    table.insert(lines, "            number = " .. num(f.t))
    table.insert(lines, "            value = " .. num(f.f0))
  end

  return {
    filename = "voice.TextGrid",
    content = table.concat(lines, "\n") .. "\n",
  }
end
