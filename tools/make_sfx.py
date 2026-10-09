"""Original M5 sound effects, synthesised from scratch (stdlib only, no samples).

Writes 16-bit mono WAVs to a temporary folder and converts them to the SPU2
ADPCM .adp files Sound.Sfx loads with AthenaEnv's tools/wav2adp.js. Set
ATHENA_ENV if AthenaEnv is not in ~/AthenaEnv.
"""
import argparse
import math
import os
from pathlib import Path
import random
import struct
import subprocess
import tempfile
import wave

RATE = 22050
TAU = 2 * math.pi


def seconds(s):
    return int(s * RATE)


def env(i, n, attack=.005, release=None):
    """Linear attack then exponential-ish decay over n samples."""
    t = i / RATE
    a = min(1, t / attack) if attack > 0 else 1
    u = i / max(1, n - 1)
    return a * (1 - u) ** (release if release else 2)


def sweep(f0, f1, length, shape="sine", decay=2, attack=.004, gain=1):
    n, out, phase = seconds(length), [], 0.0
    for i in range(n):
        u = i / n
        f = f0 * (f1 / f0) ** u
        phase += TAU * f / RATE
        if shape == "sine":
            v = math.sin(phase)
        elif shape == "square":
            v = .6 if math.sin(phase) >= 0 else -.6
        elif shape == "tri":
            v = 2 / math.pi * math.asin(math.sin(phase))
        else:  # saw
            v = (phase / math.pi) % 2 - 1
        out.append(v * env(i, n, attack, decay) * gain)
    return out


def noise(length, decay=2, cutoff=.2, attack=.002, gain=1, seed=1):
    """One-pole low-passed white noise; cutoff 0..1 (fraction of a sample step)."""
    rng, n, out, y = random.Random(seed), seconds(length), [], 0.0
    for i in range(n):
        y += cutoff * (rng.uniform(-1, 1) - y)
        out.append(y * env(i, n, attack, decay) * gain)
    return out


def bell(freq, length, partials=((1, 1), (2.76, .5), (5.4, .25), (8.9, .12)), decay=3, gain=1):
    n, out = seconds(length), []
    for i in range(n):
        t = i / RATE
        v = sum(a * math.sin(TAU * freq * r * t) * math.exp(-t * decay * r ** .5) for r, a in partials)
        out.append(v * min(1, t / .002) * gain)
    return out


def mix(*parts):
    """parts: (offset seconds, samples) pairs."""
    n = max(seconds(o) + len(s) for o, s in parts)
    out = [0.0] * n
    for o, s in parts:
        k = seconds(o)
        for i, v in enumerate(s):
            out[k + i] += v
    return out


def normalise(samples, peak=.9):
    m = max(abs(v) for v in samples) or 1
    return [v * peak / m for v in samples]


def hop():
    # Soft rising "pip" with a breathy edge, like a light jump.
    return mix((0, sweep(380, 760, .075, "tri", decay=1.6)),
               (0, noise(.04, decay=3, cutoff=.5, gain=.18, seed=2)))


def bump():
    return mix((0, sweep(170, 90, .09, "sine", decay=2.5)),
               (0, noise(.05, decay=4, cutoff=.08, gain=.5, seed=3)))


def land_log():
    # Hollow wooden knock.
    return mix((0, sweep(420, 300, .09, "sine", decay=5, attack=.001)),
               (0, sweep(1150, 900, .03, "sine", decay=4, attack=.001, gain=.35)),
               (0, noise(.02, decay=4, cutoff=.6, gain=.25, seed=4)))


def land_lily():
    return mix((0, sweep(520, 980, .07, "sine", decay=3)),
               (0, noise(.05, decay=3, cutoff=.35, gain=.15, seed=5)))


def coin():
    # Two-note arcade chime (B5 then E6).
    return mix((0, bell(988, .10, ((1, 1), (2, .3), (3, .12)), decay=8)),
               (.07, bell(1319, .35, ((1, 1), (2, .3), (3, .12)), decay=6)))


def squash():
    # Car hit: thump, crunch and a squeaky "squawk".
    return mix((0, sweep(140, 45, .25, "sine", decay=2.2, attack=.001, gain=1.2)),
               (0, noise(.22, decay=2.5, cutoff=.45, gain=.8, seed=6)),
               (.03, sweep(900, 520, .18, "square", decay=1.4, gain=.25)))


def splash():
    parts = [(0, noise(.55, decay=2.2, cutoff=.30, gain=1, seed=7)),
             (0, sweep(220, 80, .18, "sine", decay=2, gain=.6))]
    rng = random.Random(8)
    for k in range(6):  # Bubbles.
        f = rng.uniform(500, 1100)
        parts.append((.08 + k * .055 + rng.uniform(0, .02), sweep(f, f * 1.8, .05, "sine", decay=2, gain=.22)))
    return mix(*parts)


def bell_ding():
    # Level-crossing bell, played on each blink of the signal.
    return bell(1480, .32, decay=7)


def train():
    # Horn chord (two detuned saws) over a rumble with wheel clacks.
    horn = []
    n = seconds(.9)
    p1 = p2 = p3 = 0.0
    for i in range(n):
        p1 += TAU * 311 / RATE
        p2 += TAU * 370 / RATE
        p3 += TAU * 466 / RATE
        v = ((p1 / math.pi) % 2 - 1) + ((p2 / math.pi) % 2 - 1) + .6 * ((p3 / math.pi) % 2 - 1)
        t = i / RATE
        horn.append(v * min(1, t / .03) * min(1, (n - i) / seconds(.15)) * .32)
    # Low-pass the horn a little so it is less buzzy.
    y, soft = 0.0, []
    for v in horn:
        y += .35 * (v - y)
        soft.append(y)
    parts = [(0, soft), (0, noise(1.1, decay=1.2, cutoff=.06, attack=.05, gain=1.4, seed=9))]
    for k in range(6):
        parts.append((.15 + k * .14, noise(.03, decay=3, cutoff=.5, gain=.35, seed=10 + k)))
    return mix(*parts)


def eagle():
    # Descending screech with vibrato.
    n, out, phase = seconds(.75), [], 0.0
    for i in range(n):
        t, u = i / RATE, i / n
        f = 2600 * (1 - .45 * u) * (1 + .04 * math.sin(TAU * 28 * t))
        phase += TAU * f / RATE
        mod = math.sin(phase * .5)  # Rough, raspy sideband.
        v = math.sin(phase + 1.6 * mod)
        out.append(v * min(1, t / .04) * (1 - u) ** 1.2)
    return mix((0, out), (0, noise(.75, decay=1.5, cutoff=.7, attack=.04, gain=.18, seed=20)))


def restart():
    # Quick upward arpeggio for a new run.
    return mix((0, sweep(523, 523, .07, "square", decay=2, gain=.5)),
               (.06, sweep(659, 659, .07, "square", decay=2, gain=.5)),
               (.12, sweep(784, 784, .14, "square", decay=2.5, gain=.5)))


SOUNDS = {
    "hop": (hop, .55), "bump": (bump, .6), "land_log": (land_log, .7), "land_lily": (land_lily, .6),
    "coin": (coin, .8), "squash": (squash, .95), "splash": (splash, .85), "bell": (bell_ding, .7),
    "train": (train, .9), "eagle": (eagle, .8), "restart": (restart, .55),
}


def write_wav(path, samples):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, v)) * 32767)) for v in samples))


def main():
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=root / "game" / "sfx")
    parser.add_argument("--wav", type=Path, help="Also keep the WAVs here (for listening on the host)")
    parser.add_argument("--athena", type=Path, default=Path(os.environ.get("ATHENA_ENV", Path.home() / "AthenaEnv")))
    args = parser.parse_args()
    encoder = args.athena / "tools" / "wav2adp.js"
    if not encoder.is_file():
        parser.error(f"{encoder} not found; set ATHENA_ENV or --athena")
    args.output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        wav_dir = args.wav or Path(tmp)
        wav_dir.mkdir(parents=True, exist_ok=True)
        for name, (build, peak) in SOUNDS.items():
            samples = normalise(build(), peak)
            wav = wav_dir / (name + ".wav")
            write_wav(wav, samples)
            adp = args.output / (name + ".adp")
            subprocess.run(["node", str(encoder), str(wav), str(adp)], check=True, capture_output=True)
            print(f"{name:9s} {len(samples) / RATE:5.2f} s  {adp.stat().st_size:6d} bytes")


if __name__ == "__main__":
    main()
