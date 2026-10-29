#!/usr/bin/env python3
"""Synthesised work sounds for shots whose generated audio is effectively empty.

Measured on 2026-09-16, the grok-imagine clips used for the Cloudtilt cut carry
almost no sound: seven of nine shots spend 64-100% of their length below -45 dB,
and the steam-nozzle shot sits at -71 dBFS -- a hissing nozzle with no hiss. The
Codex cut dealt with it by lifting each shot up to +48 dB, which on a -71 dBFS
source mostly lifts the generator's noise floor.

So a shot can carry a `foley` recipe here, built from filtered noise and tones,
shaped to the action it accompanies: a steady stream, a hiss, a drum's hum with
the swish of bristles passing, the rhythm of a brush going back and forth. These
are synthetic sounds, not recordings from the shop, and are described as such
wherever the film is reported.

Every recipe renders EXACTLY n samples at 48 kHz stereo, so it can be summed with
the shot's own audio sample for sample.
"""
from __future__ import annotations

import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

SR = 48000


def _graph(kind: str, dur: float, rate: float) -> str:
    """An ffmpeg lavfi graph ending in [out], mono or stereo."""
    d = f"{dur + 0.2:.3f}"
    if kind == "water":
        # A continuous pour: broadband, a little flutter as the stream breaks up.
        return (f"anoisesrc=color=pink:amplitude=0.6:sample_rate={SR}:duration={d},"
                f"highpass=f=250,lowpass=f=7000,tremolo=f=9:d=0.2[out]")
    if kind == "steam":
        # High, airy hiss with a slow waver in pressure.
        return (f"anoisesrc=color=white:amplitude=0.5:sample_rate={SR}:duration={d},"
                f"highpass=f=2200,lowpass=f=12000,"
                f"asetnsamples=n=256,volume='0.8+0.2*sin(2*PI*t*1.3)':eval=frame[out]")
    if kind == "scrub":
        # Bristles on wet mesh: a band of noise that swells on every stroke.
        # |sin(pi*t*R)| has R peaks per second, one per stroke.
        return (f"anoisesrc=color=white:amplitude=0.6:sample_rate={SR}:duration={d},"
                f"bandpass=f=3200:width_type=o:width=2.2,"
                f"asetnsamples=n=256,volume='0.15+0.85*pow(abs(sin(PI*t*{rate})),3)':eval=frame[out]")
    if kind == "tick":
        # A small detail brush: quieter, higher, quicker.
        return (f"anoisesrc=color=white:amplitude=0.4:sample_rate={SR}:duration={d},"
                f"bandpass=f=5200:width_type=o:width=1.6,"
                f"asetnsamples=n=256,volume='0.1+0.9*pow(abs(sin(PI*t*{rate})),4)':eval=frame[out]")
    if kind == "machine":
        # Motor hum, a low rumble, and the swish of bristle rows passing the shoe
        # at the drum's pass rate.
        return (f"sine=frequency=96:sample_rate={SR}:duration={d},volume=0.25[a];"
                f"anoisesrc=color=brown:amplitude=0.6:sample_rate={SR}:duration={d},"
                f"lowpass=f=500[b];"
                f"anoisesrc=color=white:amplitude=0.4:sample_rate={SR}:duration={d},"
                f"bandpass=f=2500:width_type=o:width=1.5,"
                f"asetnsamples=n=256,volume='0.3+0.7*pow(abs(sin(PI*t*{rate})),2)':eval=frame[c];"
                f"[a][b][c]amix=inputs=3:normalize=0[out]")
    if kind == "cloth":
        # A folded cloth dragged over damp foam.
        return (f"anoisesrc=color=pink:amplitude=0.4:sample_rate={SR}:duration={d},"
                f"bandpass=f=900:width_type=o:width=2,"
                f"asetnsamples=n=256,volume='0.4+0.6*pow(abs(sin(PI*t*{rate})),2)':eval=frame[out]")
    raise ValueError(f"unknown foley kind {kind!r}")


def render(kind: str, n_samples: int, rate: float = 4.0, seed_shift: int = 0) -> np.ndarray:
    """Float32 stereo array of shape (n_samples, 2), unit RMS."""
    dur = n_samples / SR
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "f.wav"
        graph = _graph(kind, dur, rate) + f";[out]aformat=sample_fmts=s16:channel_layouts=stereo," \
                                         f"atrim=start_sample={seed_shift}," \
                                         f"asetpts=PTS-STARTPTS,atrim=end_sample={n_samples}[o]"
        r = subprocess.run(["ffmpeg", "-v", "error", "-filter_complex", graph, "-map", "[o]",
                            "-c:a", "pcm_s16le", str(out), "-y"], capture_output=True, text=True)
        if r.returncode != 0:
            raise SystemExit(f"foley {kind} failed: {r.stderr.strip()[-600:]}")
        with wave.open(str(out), "rb") as w:
            x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
    # frombuffer is read-only; the fades below write in place.
    x = x.reshape(-1, 2).copy()
    if len(x) < n_samples:
        x = np.pad(x, ((0, n_samples - len(x)), (0, 0)))
    x = x[:n_samples]
    rms = float(np.sqrt(np.mean(x ** 2))) or 1.0
    # A short fade at each end so the cut into and out of the shot does not click.
    f = min(480, n_samples // 4)
    ramp = np.linspace(0, 1, f, dtype=np.float32)[:, None]
    x[:f] *= ramp
    x[-f:] *= ramp[::-1]
    return x / rms


def read_wav(p: Path) -> np.ndarray:
    with wave.open(str(p), "rb") as w:
        x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
    return x.reshape(-1, 2)


def write_wav(p: Path, x: np.ndarray) -> None:
    y = np.clip(x, -1, 1)
    with wave.open(str(p), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((y * 32767).astype(np.int16).tobytes())


def db(v: float) -> float:
    return 20 * np.log10(max(v, 1e-9))


def mix_shot(native_wav: Path, out_wav: Path, foley: dict | None,
             native_target_db: float = -24.0, native_cap_db: float = 24.0,
             empty_below_db: float = -60.0) -> dict:
    """Normalise the shot's own audio, add its foley, peak-limit, write in place.

    Returns what was done, so the build can report it.
    """
    x = read_wav(native_wav)
    n = len(x)
    rms_in = float(np.sqrt(np.mean(x ** 2)))
    report = {"native_rms_db": round(db(rms_in), 1)}
    if db(rms_in) < empty_below_db:
        # Lifting an empty track only lifts the generator's noise floor.
        x = x * 0.0
        report["native_gain_db"] = None
    else:
        g = min(max(0.0, native_target_db - db(rms_in)), native_cap_db)
        x = x * (10 ** (g / 20))
        report["native_gain_db"] = round(g, 1)
    if foley:
        f = render(foley["kind"], n, foley.get("rate", 4.0))
        x = x + f * (10 ** (foley["level_db"] / 20))
        report["foley"] = f"{foley['kind']} @ {foley['level_db']} dB"
    peak = float(np.abs(x).max()) or 1.0
    ceiling = 10 ** (-3 / 20)
    if peak > ceiling:
        x = x * (ceiling / peak)
    report["out_rms_db"] = round(db(float(np.sqrt(np.mean(x ** 2)))), 1)
    write_wav(out_wav, x)
    return report
