-- CSV 帧序列导出（示例导出桥）
-- export(record) 返回 { filename, content }；record.series.frames 为帧级序列
-- 每帧一行：t,f0_hz,rms_db,f1_hz,f2_hz（缺失值为空）

function export(record)
  local frames = (record.series and record.series.frames) or {}
  local lines = {}

  table.insert(lines, "t,f0_hz,rms_db,f1_hz,f2_hz")
  for i = 1, #frames do
    local f = frames[i]
    local f0 = f.f0 and string.format("%.1f", f.f0) or ""
    local rms = f.rmsDb and string.format("%.1f", f.rmsDb) or ""
    local f1 = f.f1 and string.format("%.0f", f.f1) or ""
    local f2 = f.f2 and string.format("%.0f", f.f2) or ""
    table.insert(lines, string.format("%.3f,%s,%s,%s,%s", f.t, f0, rms, f1, f2))
  end

  return {
    filename = "frames.csv",
    content = table.concat(lines, "\n") .. "\n",
  }
end
