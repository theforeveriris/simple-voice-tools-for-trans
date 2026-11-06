# -*- coding: utf-8 -*-
"""
参数验证 · 合成信号发生器
生成确定性（种子固定）的合成语音信号 WAV（32kHz / 单声道 / 16bit PCM），
作为「构造真值」层：真值由构造给出，任何算法回归都会让断言立刻失败。

用法：
    python scripts/validation/synth_fixtures.py

输出：
    validation-cache/*.wav        音频（git 已忽略，不入仓）
    scripts/validation/truth.json 构造真值（入仓，确定性可复现）
"""

import json
import os
import wave

import numpy as np
from scipy.signal import lfilter

SR = 32000
ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
CACHE = os.path.join(ROOT, "validation-cache")
TRUTH_PATH = os.path.join(os.path.dirname(__file__), "truth.json")


def write_wav(name: str, x: np.ndarray) -> None:
    x = np.clip(x, -1.0, 1.0)
    pcm = (x * 32767).astype("<i2")
    path = os.path.join(CACHE, name)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def sine(f0: float, dur: float, amp: float = 0.5) -> np.ndarray:
    t = np.arange(int(dur * SR)) / SR
    return amp * np.sin(2 * np.pi * f0 * t)


def pulse_train(
    f0: float,
    dur: float,
    amp: float = 0.5,
    pulse_width: int = 96,
    jitter_pct: float = 0.0,
    shimmer_pct: float = 0.0,
    seed: int = 1,
) -> np.ndarray:
    """脉冲串：周期可注入 ±jitter_pct 随机扰动，幅度可注入 ±shimmer_pct。"""
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    x = np.zeros(n)
    t = 0.0
    while t < dur:
        period = (1.0 / f0) * (1.0 + jitter_pct * (rng.random() * 2 - 1))
        a = amp * (1.0 + shimmer_pct * (rng.random() * 2 - 1))
        i0 = int(t * SR)
        w = min(pulse_width, n - i0)
        if w <= 0:
            break
        u = np.arange(w) / max(1, pulse_width)
        x[i0 : i0 + w] += a * 0.5 * (1 - np.cos(2 * np.pi * u))
        t += period
    return x


def klatt_vowel(
    f0_at,
    formants,
    dur: float,
    harmonics: int = 40,
    amp: float = 0.5,
) -> np.ndarray:
    """源-滤波元音：谐波脉冲源（-6dB/八度）+ 二极点共振器级联。真值由构造给出。"""
    n = int(dur * SR)
    t = np.arange(n) / SR
    phase = 2 * np.pi * np.cumsum(f0_at(t)) / SR
    src = np.zeros(n)
    for k in range(1, harmonics + 1):
        src += np.sin(k * phase) / k
    src /= np.max(np.abs(src)) + 1e-12
    y = src
    for f, bw in formants:
        r = np.exp(-np.pi * bw / SR)
        b = 2 * r * np.cos(2 * np.pi * f / SR)
        c = -r * r
        a = 1 - b - c
        y = lfilter([a], [1, -b, -c], y)
    y /= np.max(np.abs(y)) + 1e-12
    return amp * y


def add_noise(x: np.ndarray, snr_db: float, seed: int = 42) -> np.ndarray:
    rng = np.random.default_rng(seed)
    rms = np.sqrt(np.mean(x**2))
    sigma = rms * (10 ** (-snr_db / 20))
    return x + rng.normal(0, sigma, x.shape)


def main() -> None:
    os.makedirs(CACHE, exist_ok=True)
    truth = {}

    def record(name, **kw):
        truth[name] = kw

    # ---- 音高真值 ----
    x = sine(220, 1.0)
    write_wav("sine_220.wav", x)
    record("sine_220.wav", kind="sine", f0=220.0, dur=1.0)

    x = sine(110, 1.0)
    write_wav("sine_110.wav", x)
    record("sine_110.wav", kind="sine", f0=110.0, dur=1.0)

    # ---- Jitter / Shimmer 构造真值 ----
    # 理论 jitter(local)（±a 均匀扰动）= (2/3)·a ×100%
    x = pulse_train(100, 1.0, pulse_width=96)
    write_wav("pulse_f100_j0.wav", x)
    record("pulse_f100_j0.wav", kind="pulse", f0=100.0, jitter_injected=0.0, shimmer_injected=0.0, dur=1.0)

    x = pulse_train(100, 1.0, jitter_pct=0.02, seed=5, pulse_width=96)
    write_wav("pulse_f100_j02_seed5.wav", x)
    record("pulse_f100_j02_seed5.wav", kind="pulse", f0=100.0, jitter_injected=0.02, shimmer_injected=0.0, dur=1.0)

    x = pulse_train(100, 1.0, jitter_pct=0.02, seed=7, pulse_width=96)
    write_wav("pulse_f100_j02_seed7.wav", x)
    record("pulse_f100_j02_seed7.wav", kind="pulse", f0=100.0, jitter_injected=0.02, shimmer_injected=0.0, dur=1.0)

    x = pulse_train(100, 1.0, shimmer_pct=0.05, seed=11, pulse_width=96)
    write_wav("pulse_f100_sh05_seed11.wav", x)
    record("pulse_f100_sh05_seed11.wav", kind="pulse", f0=100.0, jitter_injected=0.0, shimmer_injected=0.05, dur=1.0)

    # ---- HNR 构造真值（已知 SNR）----
    x = add_noise(sine(200, 1.5), 20.0, seed=42)
    write_wav("sine200_snr20.wav", x)
    record("sine200_snr20.wav", kind="sine+noise", f0=200.0, snr_db=20.0, dur=1.5)

    x = add_noise(sine(200, 1.5), 6.0, seed=43)
    write_wav("sine200_snr6.wav", x)
    record("sine200_snr6.wav", kind="sine+noise", f0=200.0, snr_db=6.0, dur=1.5)

    # ---- 共振峰真值（源-滤波构造）----
    x = klatt_vowel(lambda t: np.full_like(t, 120.0), [(700, 80), (1220, 90), (2600, 120)], 1.0)
    write_wav("vowel_f120_f700_1220_2600.wav", x)
    record("vowel_f120_f700_1220_2600.wav", kind="vowel", f0=120.0, formants=[[700, 80], [1220, 90], [2600, 120]], dur=1.0)

    x = klatt_vowel(lambda t: np.full_like(t, 200.0), [(400, 80), (1700, 90), (2600, 120)], 1.0)
    write_wav("vowel_f200_f400_1700_2600.wav", x)
    record("vowel_f200_f400_1700_2600.wav", kind="vowel", f0=200.0, formants=[[400, 80], [1700, 90], [2600, 120]], dur=1.0)

    # ---- 滑音（轨迹 / VRP / MPT 口径）----
    x = klatt_vowel(lambda t: 100 + (300 - 100) * t / 2.0, [(700, 80), (1220, 90), (2600, 120)], 2.0)
    write_wav("gliss_100_300.wav", x)
    record("gliss_100_300.wav", kind="gliss", f0_start=100.0, f0_end=300.0, dur=2.0)

    # ---- 响度衰减（-2 dB/s 线性衰减）----
    base = pulse_train(150, 3.0, amp=0.5, pulse_width=96)
    t = np.arange(base.shape[0]) / SR
    x = base * (10 ** (-2.0 * t / 20.0))
    write_wav("decay_minus2.wav", x)
    record("decay_minus2.wav", kind="decay", f0=150.0, decay_db_per_sec=-2.0, dur=3.0)

    # ---- 静音（门限 / MPT=0）----
    x = np.zeros(int(0.5 * SR))
    write_wav("silence.wav", x)
    record("silence.wav", kind="silence", dur=0.5)

    with open(TRUTH_PATH, "w", encoding="utf-8") as f:
        json.dump({"sampleRate": SR, "fixtures": truth}, f, ensure_ascii=False, indent=2)
    print(f"OK: {len(truth)} fixtures -> {CACHE}")
    print(f"OK: truth -> {TRUTH_PATH}")


if __name__ == "__main__":
    main()
