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
        else:
            v = (phase / math.pi) % 2 - 1
        out.append(v * env(i, n, attack, decay) * gain)
    return out

def noise(length, decay=2, cutoff=.2, attack=.002, gain=1, seed=1):
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
    return mix((0, sweep(380, 760, .075, "tri", decay=1.6)),
               (0, noise(.04, decay=3, cutoff=.5, gain=.18, seed=2)))

def bump():
    return mix((0, sweep(170, 90, .09, "sine", decay=2.5)),
               (0, noise(.05, decay=4, cutoff=.08, gain=.5, seed=3)))

def land_log():
    return mix((0, sweep(420, 300, .09, "sine", decay=5, attack=.001)),
               (0, sweep(1150, 900, .03, "sine", decay=4, attack=.001, gain=.35)),
               (0, noise(.02, decay=4, cutoff=.6, gain=.25, seed=4)))

def land_lily():
    return mix((0, sweep(520, 980, .07, "sine", decay=3)),
               (0, noise(.05, decay=3, cutoff=.35, gain=.15, seed=5)))

def coin():
    return mix((0, bell(988, .10, ((1, 1), (2, .3), (3, .12)), decay=8)),
               (.07, bell(1319, .35, ((1, 1), (2, .3), (3, .12)), decay=6)))

def squash():
    return mix((0, sweep(140, 45, .25, "sine", decay=2.2, attack=.001, gain=1.2)),
               (0, noise(.22, decay=2.5, cutoff=.45, gain=.8, seed=6)),
               (.03, sweep(900, 520, .18, "square", decay=1.4, gain=.25)))

def splash():
    parts = [(0, noise(.55, decay=2.2, cutoff=.30, gain=1, seed=7)),
             (0, sweep(220, 80, .18, "sine", decay=2, gain=.6))]
    rng = random.Random(8)
    for k in range(6):
        f = rng.uniform(500, 1100)
        parts.append((.08 + k * .055 + rng.uniform(0, .02), sweep(f, f * 1.8, .05, "sine", decay=2, gain=.22)))
    return mix(*parts)

def bell_ding():
    return bell(1480, .32, decay=7)

def train():
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
    y, soft = 0.0, []
    for v in horn:
        y += .35 * (v - y)
        soft.append(y)
    parts = [(0, soft), (0, noise(1.1, decay=1.2, cutoff=.06, attack=.05, gain=1.4, seed=9))]
    for k in range(6):
        parts.append((.15 + k * .14, noise(.03, decay=3, cutoff=.5, gain=.35, seed=10 + k)))
    return mix(*parts)

def eagle():
    n, out, phase = seconds(.75), [], 0.0
    for i in range(n):
        t, u = i / RATE, i / n
        f = 2600 * (1 - .45 * u) * (1 + .04 * math.sin(TAU * 28 * t))
        phase += TAU * f / RATE
        mod = math.sin(phase * .5)
        v = math.sin(phase + 1.6 * mod)
        out.append(v * min(1, t / .04) * (1 - u) ** 1.2)
    return mix((0, out), (0, noise(.75, decay=1.5, cutoff=.7, attack=.04, gain=.18, seed=20)))

def restart():
    return mix((0, sweep(523, 523, .07, "square", decay=2, gain=.5)),
               (.06, sweep(659, 659, .07, "square", decay=2, gain=.5)),
               (.12, sweep(784, 784, .14, "square", decay=2.5, gain=.5)))

def midi(note):
    return 440 * 2 ** ((note - 69) / 12)

def tone(freq, length, shape, decay=3, gain=1, duty=.5):
    n, out = seconds(length), []
    for i in range(n):
        ph = (i * freq / RATE) % 1
        if shape == "pulse":
            v = .5 if ph < duty else -.5
        else:
            v = 4 * abs(ph - .5) - 1
        t = i / RATE
        out.append(v * min(1, t / .004) * math.exp(-t * decay) * min(1, (n - i) / 60) * gain)
    return out

def title_music():
    step = .2
    lead = [72, 76, 79, 76, 84, None, 79, None, 76, None, 79, 81, 79, 76, 72, None,
            69, 72, 76, 72, 81, None, 76, None, 72, None, 76, 77, 76, 72, 69, None,
            65, 69, 72, 69, 77, None, 72, None, 69, None, 72, 74, 72, 69, 65, None,
            67, 71, 74, 71, 79, None, 74, None, 74, None, 71, 74, 79, 77, 76, 74]
    roots = [48, 45, 41, 43]
    parts = []
    for k, note in enumerate(lead):
        t = k * step
        if note is not None:
            parts.append((t, tone(midi(note), .19, "pulse", decay=6, gain=.30, duty=.25)))
            parts.append((t + .1, tone(midi(note + 12), .09, "pulse", decay=12, gain=.06, duty=.5)))
        root = roots[k // 16] + (12 if k % 2 else 0)
        parts.append((t, tone(midi(root), .19, "tri", decay=4, gain=.45)))
        if k % 4 == 0:
            parts.append((t, sweep(130, 45, .12, "sine", decay=2.5, attack=.001, gain=.55)))
        if k % 2 == 1:
            parts.append((t, noise(.04, decay=4, cutoff=.9, gain=.12, seed=100 + k)))
        if k % 8 == 4:
            parts.append((t, noise(.12, decay=3, cutoff=.5, gain=.28, seed=200 + k)))
    out = mix(*parts)
    total = seconds(len(lead) * step)
    for i in range(total, len(out)):
        out[i - total] += out[i]
    return out[:total]

def ambience():
    length = 24
    n = seconds(length)
    rng = random.Random(30)
    out, y1, y2 = [], 0.0, 0.0
    for i in range(n):
        t = i / RATE
        gust = .55 + .30 * math.sin(TAU * t / 8) + .15 * math.sin(TAU * t / 6 + 1)
        y1 += .015 * (rng.uniform(-1, 1) - y1)
        y2 += .04 * (y1 - y2)
        out.append(y2 * gust * 9)
    fade = seconds(1.5)
    for i in range(fade):
        u = i / fade
        out[i] = out[i] * u + out[n - fade + i] * (1 - u)
    birds = []
    t = .8
    while t < length - 1.2:
        f = rng.uniform(2300, 3800)
        for k in range(rng.randint(2, 4)):
            chirp = []
            m = seconds(rng.uniform(.06, .11))
            ph = 0.0
            for i in range(m):
                u = i / m
                ph += TAU * f * (1 + .35 * math.sin(math.pi * u)) / RATE
                chirp.append(math.sin(ph) * math.sin(math.pi * u) * .14)
            birds.append((t + k * .13, chirp))
        t += rng.uniform(1.6, 4.0)
    out = [a + b for a, b in zip(out, mix(*birds) + [0.0] * n)]
    return out

STREAMS = {"title": (title_music, .75), "ambience": (ambience, .5)}

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
    parser.add_argument("--music", type=Path, default=root / "game" / "music")
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
    args.music.mkdir(parents=True, exist_ok=True)
    for name, (build, peak) in STREAMS.items():
        samples = normalise(build(), peak)
        wav = args.music / (name + ".wav")
        write_wav(wav, samples)
        print(f"{name:9s} {len(samples) / RATE:5.2f} s  {wav.stat().st_size:6d} bytes (stream)")

if __name__ == "__main__":
    main()
