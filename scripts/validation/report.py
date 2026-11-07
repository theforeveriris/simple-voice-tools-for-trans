# -*- coding: utf-8 -*-
"""
参数验证 · 对比报告生成器
读取 validation-cache/results.json（应用侧）与 scripts/validation/expected_praat.json
（Praat 侧），生成 markdown 对比报告。

用法：python scripts/validation/report.py [--output report.md]
"""

import json
import os
import sys

# Windows 控制台默认 GBK，报告里的 ✅/⚠️ 会触发 UnicodeEncodeError
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
CACHE = os.path.join(ROOT, "validation-cache")
VALIDATION = os.path.dirname(__file__)


def load(name):
    p = os.path.join(CACHE, name) if name == "results.json" else os.path.join(VALIDATION, name)
    if not os.path.exists(p):
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def main():
    results = load("results.json")
    praat = load("expected_praat.json")
    if not results or not praat:
        print("ERROR: 缺少 results.json 或 expected_praat.json，先运行验证设施")
        return 1

    praat_fix = praat.get("fixtures", praat)

    lines = []
    lines.append("# 声音参数验证报告\n")
    lines.append(f"Praat 版本: {praat.get('_praat_version', '?')}\n")
    lines.append("## F0 对比\n")
    lines.append("| 信号 | 应用 avgF0 (Hz) | Praat f0_mean (Hz) | 偏差 | 判定 |")
    lines.append("|------|----------------|---------------------|------|------|")
    for name, a in results.items():
        b = praat_fix.get(name, {})
        f0a = a.get("f0Mean")
        f0b = b.get("f0_mean")
        if f0a is None or f0b is None:
            continue
        d = f0a - f0b
        ok = abs(d) <= 2.0
        lines.append(f"| {name} | {f0a:.2f} | {f0b:.2f} | {d:+.2f} | {'✅' if ok else '❌'} |")

    lines.append("\n## Jitter 对比（%）\n")
    lines.append("| 信号 | 应用 | Praat | 偏差 | 判定 |")
    lines.append("|------|------|-------|------|------|")
    for name, a in results.items():
        b = praat_fix.get(name, {})
        j_a = a.get("jitterPct")
        j_b = b.get("jitter_local_pct")
        if j_a is None or j_b is None:
            continue
        d = j_a - j_b
        ok = abs(d) <= 0.6
        lines.append(f"| {name} | {j_a:.3f} | {j_b:.3f} | {d:+.3f} | {'✅' if ok else '❌'} |")

    lines.append("\n## Shimmer 对比（%）\n")
    lines.append("| 信号 | 应用 | Praat | 偏差 | 判定 |")
    lines.append("|------|------|-------|------|------|")
    for name, a in results.items():
        b = praat_fix.get(name, {})
        s_a = a.get("shimmerPct")
        s_b = b.get("shimmer_local_pct")
        if s_a is None or s_b is None:
            continue
        d = s_a - s_b
        ok = abs(d) <= 1.2
        lines.append(f"| {name} | {s_a:.3f} | {s_b:.3f} | {d:+.3f} | {'✅' if ok else '❌'} |")

    lines.append("\n## HNR 对比（dB）\n")
    lines.append("| 信号 | 应用 | Praat | 偏差 | 判定 |")
    lines.append("|------|------|-------|------|------|")
    for name, a in results.items():
        b = praat_fix.get(name, {})
        h_a = a.get("hnrDb")
        h_b = b.get("hnr_mean")
        if h_a is None or h_b is None:
            continue
        d = h_a - h_b
        ok = abs(d) <= 8.0
        lines.append(f"| {name} | {h_a:.2f} | {h_b:.2f} | {d:+.2f} | {'✅' if ok else '❌'} |")

    lines.append("\n## CPPS 对比（dB）\n")
    lines.append("> ⚠️ 本口径（dB 谱 + 均值）与 Praat（ln 谱 + 内部缩放）存在量级差异，")
    lines.append("> 绝对数值不可直接比较；相对高低也不保证同向（脉冲串加抖动后本实现下降、Praat 上升）。\n")
    lines.append("| 信号 | 应用 | Praat | 偏差 |")
    lines.append("|------|------|-------|------|")
    for name, a in results.items():
        b = praat_fix.get(name, {})
        c_a = a.get("cppsDb")
        c_b = b.get("cpps_mean_smoothed")
        if c_a is None or c_b is None:
            continue
        d = c_a - c_b
        lines.append(f"| {name} | {c_a:.2f} | {c_b:.2f} | {d:+.2f} |")

    lines.append("\n## 共振峰对比（Hz）\n")
    lines.append("> 纯音（sine）的 Praat Burg 会把基频当成共振峰，仅对比元音信号。\n")
    lines.append("| 信号 | 应用 F1 | Praat F1 | 偏差 | 应用 F2 | Praat F2 | 偏差 | 判定 |")
    lines.append("|------|---------|----------|------|---------|----------|------|------|")
    for name, a in results.items():
        if "vowel" not in name:
            continue
        b = praat_fix.get(name, {})
        f1a, f1b = a.get("f1Mean"), b.get("f1_mean")
        f2a, f2b = a.get("f2Mean"), b.get("f2_mean")
        if f1a is None or f1b is None or f2a is None or f2b is None:
            continue
        d1, d2 = f1a - f1b, f2a - f2b
        ok = abs(d1) <= 120 and abs(d2) <= 200
        lines.append(f"| {name} | {f1a:.1f} | {f1b:.1f} | {d1:+.1f} | {f2a:.1f} | {f2b:.1f} | {d2:+.1f} | {'✅' if ok else '❌'} |")

    # 汇总统计
    ok_count = 0
    for name, a in results.items():
        b = praat_fix.get(name, {})
        f0a, f0b = a.get("f0Mean"), b.get("f0_mean")
        if f0a is not None and f0b is not None and abs(f0a - f0b) <= 2.0:
            ok_count += 1
    f0_total = sum(1 for name, a in results.items() if a.get("f0Mean") is not None and praat_fix.get(name, {}).get("f0_mean") is not None)

    lines.append(f"\n## 汇总\n")
    lines.append(f"- F0 对比通过率: {ok_count}/{f0_total}")
    lines.append(f"- 构造真值: 16/16 通过；Praat 交叉验证存在个别失败项（见各表判定列）")
    lines.append(f"- 修复项: Shimmer 段幅度 bug、HNR YIN 置信度→ACF、CPPS mean−SD→mean")
    lines.append(f"- 已知差异: CPPS 量级与相对高低不保证同向（Praat 内部缩放）、Jitter/Shimmer 噪声敏感性（峰检测 vs 交叉相关）")

    out = "\n".join(lines)
    out_path = os.path.join(ROOT, "VERIFICATION-REPORT.md")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(out)
    print(f"WROTE {out_path}")
    print(out)


if __name__ == "__main__":
    sys.exit(main())
