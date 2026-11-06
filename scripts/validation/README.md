# 声音参数验证设施

对全部声音参数做正确性验证：构造真值回归 + Praat 交叉验证。

## 三层验证

| 层 | 文件 | 作用 |
|----|------|------|
| 1. 构造真值 | `scripts/validation/truth.json` | 频率/共振峰/注入抖动/已知 SNR/已知衰减，真值由构造给出 |
| 2. TS 管线回归 | `src/lib/audio/validation/validation.test.ts` | 跑完整分析管线，对构造真值断言 + 写 results.json |
| 3. Praat 交叉验证 | `scripts/validation/expected_praat.json` | 同一 WAV 喂 parselmouth，对比 F0/共振峰/Jitter/Shimmer/HNR/CPPS |

## 使用方式

```bash
# 1. 生成合成信号（确定性种子）
python scripts/validation/synth_fixtures.py

# 2. 提取 Praat 参考值（需要 pip install praat-parselmouth）
python scripts/validation/praat_reference.py

# 3. 跑 TS 管线验证 + 生成对比报告
npx vitest run src/lib/audio/validation/validation.test.ts
python scripts/validation/report.py

# 查看报告
cat VERIFICATION-REPORT.md
```

## 文件说明

- `validation-cache/` — 合成 WAV + 运行结果（git 已忽略，不入仓）
- `scripts/validation/truth.json` — 构造真值（入仓，确定性可复现）
- `scripts/validation/expected_praat.json` — Praat 参考值（入仓）
- `src/lib/audio/validation/fixtures.ts` — WAV 读取器
- `src/lib/audio/validation/validation.test.ts` — TS 侧验证测试

## 已验证的修复

| 参数 | 修复 | 验证结果 |
|------|------|----------|
| Shimmer | 段扫描（含相邻峰）→ 周期峰值插值 | 与 Praat 偏差 0.1%（旧实现偏低 ~40%） |
| HNR | YIN 置信度换算（23dB 饱和）→ 归一化自相关 | 与 Praat 偏差 0.4–6.8dB（旧实现偏差 18–32dB） |
| CPPS | mean−SD → mean | 去除人为压低，对齐 Hillenbrand 标准口径 |

## 已知差异

- **CPPS 量级**：本口径（dB 谱 + 1/N 归一化）约为 Praat（ln 谱 + 内部缩放）的 1/20，绝对数值不可直接比较
- **Jitter/Shimmer 噪声敏感性**：峰检测法在噪声下偏高（sine200_snr20: jitter +2.1%, shimmer +12.7%），Praat 用交叉相关更稳健
- **共振峰**：纯音（sine）的 Praat Burg 会把基频当成"共振峰"，仅元音信号可对比
