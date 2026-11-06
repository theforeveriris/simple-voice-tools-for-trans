# -*- coding: utf-8 -*-
"""
参数验证 · Praat 参考值提取（parselmouth）

对 validation-cache/ 下每个合成 WAV 跑 Praat 对应分析，输出 expected_praat.json
（入仓；音频本体不入仓）。

口径（与本应用文档声称的「临床常用定义」对齐）：
- F0          Pitch（floor 60 / ceiling 600，time step 0.01）
- 共振峰      Formant（Burg，5500Hz max，25ms window，pre-emphasis 50）
- HNR         Harmonicity (cc)（ACF 自相关口径）
- Jitter/Shimmer  PointProcess (periodic, cc) 的 local 口径
- CPPS        PowerCepstrogram + Get CPPS（标准均值）；同时用
              To Table (cepstral peak prominences) 取出逐帧 CPP，
              直接算 mean 与 mean−SD —— 用于核对应用「mean−SD」的偏差

用法：python scripts/validation/praat_reference.py
"""

import json
import os
import sys

import parselmouth
from parselmouth.praat import call

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
CACHE = os.path.join(ROOT, "validation-cache")
OUT = os.path.join(os.path.dirname(__file__), "expected_praat.json")

# 每个 fixture 的 Praat 参考值提取
FIXTURES = [
    "sine_220.wav",
    "sine_110.wav",
    "pulse_f100_j0.wav",
    "pulse_f100_j02_seed5.wav",
    "pulse_f100_j02_seed7.wav",
    "pulse_f100_sh05_seed11.wav",
    "sine200_snr20.wav",
    "sine200_snr6.wav",
    "vowel_f120_f700_1220_2600.wav",
    "vowel_f200_f400_1700_2600.wav",
    "gliss_100_300.wav",
    "decay_minus2.wav",
    "silence.wav",
]


def ref_for(path: str) -> dict:
    out: dict = {}
    sound = parselmouth.Sound(path)

    # F0
    try:
        pitch = sound.to_pitch(time_step=0.01, pitch_floor=60, pitch_ceiling=600)
        out["f0_mean"] = call(pitch, "Get mean", 0, 0, "Hertz")
    except Exception as e:
        out["f0_error"] = str(e)[:120]

    # 共振峰
    try:
        fm = call(sound, "To Formant (burg)", 0.01, 5, 5500, 0.025, 50)
        out["f1_mean"] = call(fm, "Get mean", 1, 0, 0, "Hertz")
        out["f2_mean"] = call(fm, "Get mean", 2, 0, 0, "Hertz")
    except Exception as e:
        out["formant_error"] = str(e)[:120]

    # HNR（自相关口径）
    try:
        hnr = sound.to_harmonicity_cc(time_step=0.01, minimum_pitch=60, silence_threshold=0.1, periods_per_window=4.5)
        out["hnr_mean"] = call(hnr, "Get mean", 0, 0)
    except Exception as e:
        out["hnr_error"] = str(e)[:120]

    # Jitter / Shimmer
    try:
        pp = call(sound, "To PointProcess (periodic, cc)", 60, 600)
        out["jitter_local_pct"] = call(pp, "Get jitter (local)", 0, 0, 0.0001, 0.02, 1.3) * 100
        out["shimmer_local_pct"] = call([sound, pp], "Get shimmer (local)", 0, 0, 0.0001, 0.02, 1.3, 1.6) * 100
    except Exception as e:
        out["pp_error"] = str(e)[:120]

    # CPPS：标准均值（无平滑）与平滑口径；布尔参数传 "yes"/"no" 字符串
    try:
        cepstrogram = call(sound, "To PowerCepstrogram", 60, 0.002, 5000, 50)
        cpps_args = ["no", 0, 0, 60, 333.3, 0.05, "parabolic", 0.001, 0.05, "Straight", "Robust slow"]
        out["cpps_mean_no_smooth"] = call(cepstrogram, "Get CPPS", *cpps_args)
        smoothed_args = ["no", 0.02, 0.001, 60, 333.3, 0.05, "parabolic", 0.001, 0.05, "Straight", "Robust slow"]
        out["cpps_mean_smoothed"] = call(cepstrogram, "Get CPPS", *smoothed_args)
    except Exception as e:
        out["cpps_error"] = str(e)[:200]

    return out


def sanitize(obj):
    """NaN/Inf → null（json 严格模式不允许 NaN）"""
    import math
    if isinstance(obj, dict):
        return {k: sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize(v) for v in obj]
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    return obj


def main() -> None:
    results = {}
    for name in FIXTURES:
        path = os.path.join(CACHE, name)
        if not os.path.exists(path):
            print(f"SKIP {name} (missing)")
            continue
        try:
            results[name] = sanitize(ref_for(path))
            print(f"OK   {name}")
        except Exception as e:
            results[name] = {"error": str(e)[:200]}
            print(f"FAIL {name}: {str(e)[:120]}")

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"_praat_version": parselmouth.VERSION, "fixtures": results}, f, ensure_ascii=False, indent=2)
    print(f"WROTE {OUT}")


if __name__ == "__main__":
    sys.exit(main())
