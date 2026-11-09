"""Puhu's sounds, made from nothing but sine waves and a little noise.

Writes the 29 WAVs the app plays (48 kHz, 16-bit, stereo) into sounds/.
Every sound is synthesised here, so they are Puhu's own: soft, round and short,
a few of them an owl's "hoo". Run it again after changing a recipe:

    python scripts/make-sounds.py
"""

from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, lfilter

SR = 48000
OUT = Path(__file__).resolve().parent.parent / "sounds"
rng = np.random.default_rng(7)

# Notes, Hz.
A3, D4, F4, G4, A4 = 220.0, 293.66, 349.23, 392.0, 440.0
C5, D5, E5, G5, A5 = 523.25, 587.33, 659.25, 783.99, 880.0
C6, E6, G6, C7 = 1046.5, 1318.5, 1568.0, 2093.0


# greeting.ts's PACE: [beat time, seconds] pairs, straight lines in between.
PACE = [(0, 0), (0.2, 0.25), (0.64, 0.95), (0.96, 1.4), (0.98, 1.55), (1.46, 2.2), (1.5, 2.3),
        (2.06, 3.15), (2.38, 3.65), (2.96, 4.4), (4.6, 5.7)]


def paced(beat):
    """Seconds since the greeting's start for a beat time, as greeting.ts's paced()."""
    for (a0, a1), (b0, b1) in zip(PACE, PACE[1:]):
        if beat <= b0:
            return a1 + (beat - a0) / (b0 - a0) * (b1 - a1)
    return PACE[-1][1] + (beat - PACE[-1][0])


def silence(seconds):
    return np.zeros(int(SR * seconds))


def place(track, sound, at):
    """Adds `sound` into `track` starting at `at` seconds, growing the track if needed."""
    start = int(SR * at)
    end = start + len(sound)
    if end > len(track):
        track = np.concatenate([track, np.zeros(end - len(track))])
    track[start:end] += sound
    return track


def env(n, attack=0.005, decay=0.12):
    """A soft attack, then an exponential fall."""
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    a = a * a * (3 - 2 * a)
    return a * np.exp(-np.maximum(t - attack, 0) / decay)


def glide(f0, f1, seconds, curve=1.0):
    """A frequency that slides from f0 to f1 (exponentially, `curve` shapes how early)."""
    n = int(SR * seconds)
    p = np.linspace(0, 1, n) ** curve
    return f0 * (f1 / f0) ** p


def osc(freq, partials=((1, 1.0),), vibrato=(0, 0)):
    """A tone following `freq` (an array, Hz), with its overtones and an optional vibrato (Hz, depth)."""
    n = len(freq)
    t = np.arange(n) / SR
    rate, depth = vibrato
    f = freq * (1 + depth * np.sin(2 * np.pi * rate * t))
    phase = 2 * np.pi * np.cumsum(f) / SR
    return sum(amp * np.sin(k * phase) for k, amp in partials)


def tone(f0, seconds, f1=None, partials=((1, 1.0), (2, 0.18), (3, 0.05)), attack=0.006, decay=0.12, vibrato=(0, 0), curve=1.0):
    freq = glide(f0, f1 or f0, seconds, curve)
    return osc(freq, partials, vibrato) * env(len(freq), attack, decay)


def bell(f, seconds=0.9, decay=0.35, bright=1.0):
    """A soft bell: higher partials fade sooner."""
    n = int(SR * seconds)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for ratio, amp, d in ((1, 1.0, 1.0), (2.0, 0.32 * bright, 0.55), (3.01, 0.12 * bright, 0.35), (4.2, 0.06 * bright, 0.22)):
        out += amp * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t / (decay * d))
    return out * env(n, 0.003, 10)


def noise(seconds, low, high, attack=0.01, decay=0.1):
    n = int(SR * seconds)
    b, a = butter(2, [low / (SR / 2), min(high, SR / 2 - 100) / (SR / 2)], btype="band")
    return lfilter(b, a, rng.standard_normal(n)) * env(n, attack, decay)


def hoot(f, seconds=0.26, level=1.0):
    """An owl's soft "hoo": a round tone that bends up into its note, with some breath."""
    n = int(SR * seconds)
    t = np.arange(n) / SR
    freq = f * (1 - 0.06 * np.exp(-t / 0.035)) * (1 - 0.025 * t / seconds)
    body = osc(freq, ((1, 1.0), (2, 0.12), (3, 0.03)), vibrato=(5.5, 0.006))
    shape = np.clip(t / 0.05, 0, 1) ** 1.5 * np.clip((seconds - t) / 0.09, 0, 1) ** 1.2
    breath = noise(seconds, 300, 1800, 0.05, 10) * 0.18
    return level * (body + breath) * shape


def sweep(seconds, low0, low1, width=1.8, level=1.0):
    """Noise whose band slides from low0 to low1 Hz (a whoosh)."""
    n = int(SR * seconds)
    out = np.zeros(n)
    hop = 480
    centres = glide(low0, low1, seconds)
    src = rng.standard_normal(n + hop)
    for i in range(0, n, hop):
        c = centres[min(i, n - 1)]
        b, a = butter(2, [c / width / (SR / 2), min(c * width, SR / 2 - 200) / (SR / 2)], btype="band")
        seg = lfilter(b, a, src[i : i + hop * 2])[hop // 2 : hop // 2 + hop]
        out[i : i + hop] = seg[: len(out[i : i + hop])]
    t = np.arange(n) / SR
    shape = np.sin(np.pi * np.clip(t / seconds, 0, 1)) ** 1.4
    return level * out * shape


def room(x, wet=0.14):
    """A small soft room (a Schroeder reverb), so nothing sounds dry and sharp."""
    tail = np.concatenate([x, np.zeros(int(SR * 0.35))])
    out = np.zeros_like(tail)
    for ms, g in ((29.7, 0.72), (37.1, 0.7), (41.1, 0.68), (43.7, 0.66)):
        d = int(SR * ms / 1000)
        y = tail.copy()
        for i in range(d, len(y), d):
            y[i : i + d] += g * y[i - d : i][: len(y[i : i + d])]
        out += y
    out /= 4
    for ms, g in ((5.0, 0.7), (1.7, 0.7)):
        d = int(SR * ms / 1000)
        b = np.zeros(d + 1)
        b[0], b[-1] = -g, 1
        a = np.zeros(d + 1)
        a[0], a[-1] = 1, -g
        out = lfilter(b, a, out)
    return tail * (1 - wet) + out * wet


def chord(*parts):
    """Sounds placed at times: chord((sound, at), …)."""
    track = silence(0.01)
    for s, at in parts:
        track = place(track, s, at)
    return track


# ── The recipes ──────────────────────────────────────────────────────────────

def make():
    s = {}
    # The island and the pointer: tiny, quiet, round.
    s["hover"] = tone(1760, 0.05, decay=0.012)
    s["tick"] = chord((noise(0.02, 2500, 7000, 0.0005, 0.004), 0), (tone(2400, 0.03, decay=0.006), 0))
    s["blip"] = tone(1320, 0.09, 1400, decay=0.025)
    s["pop"] = tone(380, 0.22, 950, decay=0.06, curve=0.35)
    s["peek"] = chord((tone(560, 0.16, 980, decay=0.045, curve=0.4), 0), (tone(820, 0.2, 1320, decay=0.05, curve=0.4), 0.075))
    s["open"] = chord((tone(C5, 0.32, G5, decay=0.11, curve=0.5), 0), (tone(G5, 0.3, C6, decay=0.09, curve=0.5) * 0.35, 0.05))
    s["close"] = chord((tone(G5, 0.3, C5, decay=0.1, curve=0.5), 0), (tone(C5, 0.28, G4, decay=0.08, curve=0.5) * 0.3, 0.05))
    s["wink"] = tone(1180, 0.12, 1650, decay=0.035, curve=0.5)
    # Work: sending, attaching, searching, thinking.
    s["send"] = chord((sweep(0.32, 500, 3200, level=0.9), 0), (tone(C6, 0.2, G6, decay=0.05) * 0.25, 0.14))
    s["attach"] = chord((s["pop"], 0), (bell(E6, 0.5, 0.12) * 0.35, 0.12), (bell(G6, 0.5, 0.12) * 0.3, 0.2), (bell(C7, 0.5, 0.14) * 0.28, 0.28))
    s["work"] = chord((tone(G5, 0.16, decay=0.05), 0), (tone(C6, 0.2, decay=0.07), 0.08))
    s["think"] = chord(*[(tone(f, 0.08, f * 1.25, decay=0.025) * 0.8, at) for f, at in ((720, 0), (880, 0.11), (790, 0.22))])
    s["search"] = tone(900, 0.36, 1450, decay=0.14, vibrato=(11, 0.012), curve=0.7)
    # Asking and answering.
    s["approval"] = chord((bell(E5, 0.7, 0.3), 0), (bell(A5, 0.8, 0.34), 0.16))
    s["approve"] = chord((bell(C6, 0.5, 0.16), 0), (bell(E6, 0.55, 0.2) * 0.9, 0.07))
    s["question"] = chord((tone(C5, 0.22, E5, decay=0.09, curve=0.6), 0), (tone(E5, 0.34, A5, decay=0.13, vibrato=(6, 0.01), curve=0.5), 0.17))
    s["finish"] = chord(*[(bell(f, 0.9, 0.3) * lv, at) for f, at, lv in ((C5, 0, 0.8), (E5, 0.09, 0.8), (G5, 0.18, 0.85), (C6, 0.29, 1.0))])
    s["error"] = chord((tone(D4, 0.3, partials=((1, 1), (2, 0.35), (3, 0.2), (5, 0.06)), decay=0.12), 0), (tone(A3, 0.45, partials=((1, 1), (2, 0.35), (3, 0.2), (5, 0.06)), decay=0.18), 0.19))
    s["rate"] = tone(660, 0.55, 430, decay=0.22, partials=((1, 1), (2, 0.25)), vibrato=(4, 0.006), curve=0.8)
    # Puhu himself: an owl's hello, his moods.
    s["greet"] = chord((hoot(G4, 0.2), 0), (hoot(F4, 0.32), 0.27))
    s["love"] = chord(*[(bell(f, 0.5, 0.14) * 0.7, at) for f, at in ((C6, 0), (E6, 0.07), (G6, 0.14))], (sweep(0.4, 3000, 7000, level=0.08), 0.1))
    s["proud"] = chord((tone(G5, 0.14, partials=((1, 1), (2, 0.3), (3, 0.12)), decay=0.06), 0), (tone(C6, 0.55, partials=((1, 1), (2, 0.3), (3, 0.12)), decay=0.22, vibrato=(5.5, 0.006)), 0.12))
    s["annoyed"] = chord((tone(240, 0.16, 215, partials=((1, 1), (2, 0.4), (3, 0.2)), decay=0.07), 0), (tone(205, 0.3, 175, partials=((1, 1), (2, 0.4), (3, 0.2)), decay=0.12), 0.17))
    s["dizzy"] = tone(720, 0.85, 420, decay=0.4, vibrato=(8, 0.09), partials=((1, 1), (2, 0.15)), curve=0.9)
    s["slap"] = tone(320, 0.5, 300, decay=0.2, vibrato=(16, 0.28), partials=((1, 1), (2, 0.2)))
    s["gulp"] = chord((tone(520, 0.2, 170, decay=0.08, curve=0.5), 0), (tone(140, 0.25, 90, decay=0.08) * 0.6, 0.12))
    s["sleep"] = tone(A4, 0.4, 330, decay=0.2, partials=((1, 1), (2, 0.08)), curve=0.8)
    s["yawn"] = chord((tone(480, 0.62, 340, decay=0.3, vibrato=(3, 0.04), curve=1.4) * np.concatenate([np.linspace(0.4, 1, int(SR * 0.2)), np.ones(int(SR * 0.62) - int(SR * 0.2))]), 0), (noise(0.6, 400, 2000, 0.1, 0.25) * 0.12, 0))
    # The launch, on greeting.ts's beat times through its PACE table: wings beating on
    # the way down, the landing, the feathers shaken out, two glances, hoo-hoo, a wing
    # waved, settling in.
    flaps = [(sweep(0.09, 500, 1600, level=0.22) * (0.6 + 0.4 * i / 3), paced(0.2 + i * 0.125)) for i in range(4)]
    ruffle = [(noise(0.035, 1500, 6000, 0.002, 0.012) * 0.5 * (1 - i / 5), paced(1.06 + i * 0.045)) for i in range(6)]
    s["greeting"] = chord(
        *flaps,
        (tone(150, 0.16, 110, decay=0.05) * 0.55, paced(0.64)),
        (s["pop"] * 0.9, paced(0.65)),
        *ruffle,
        (tone(1500, 0.05, decay=0.012) * 0.18, paced(1.52)),
        (tone(1320, 0.05, decay=0.012) * 0.18, paced(1.76)),
        (hoot(G4, 0.18), paced(2.03)),
        (hoot(F4, 0.3), paced(2.21)),
        (sweep(0.18, 900, 2400, level=0.08), paced(2.38)),
        (bell(G6, 0.5, 0.14) * 0.3, paced(2.44)),
        (bell(C7, 0.4, 0.1) * 0.25, paced(2.72)),
        (tone(G5, 0.45, C5, decay=0.18, curve=0.6) * 0.3, paced(2.9)),
    )
    return s


# How loud each sound is (RMS, 0…1): the island's own sounds stay quiet, alerts
# and the launch a little louder. A peak never passes 0.7.
LOUD = {
    "annoyed": 0.028, "approval": 0.066, "approve": 0.038, "attach": 0.05, "blip": 0.009,
    "close": 0.014, "dizzy": 0.055, "error": 0.072, "finish": 0.1, "greet": 0.063,
    "greeting": 0.049, "gulp": 0.051, "hover": 0.004, "love": 0.045, "open": 0.018,
    "peek": 0.018, "pop": 0.012, "proud": 0.062, "question": 0.053, "rate": 0.04,
    "search": 0.026, "send": 0.016, "slap": 0.024, "sleep": 0.021, "think": 0.028,
    "tick": 0.002, "wink": 0.007, "work": 0.016, "yawn": 0.035,
}


def write(name, x):
    x = room(x)
    # Trim the silent tail and fade the last 30 ms, so nothing clicks.
    loud = np.nonzero(np.abs(x) > np.abs(x).max() * 0.002)[0]
    x = x[: loud[-1] + 1 if len(loud) else len(x)]
    fade = min(len(x), int(SR * 0.03))
    x[-fade:] *= np.linspace(1, 0, fade)
    rms = np.sqrt((x**2).mean()) or 1
    x = x * min(LOUD[name] / rms, 0.7 / (np.abs(x).max() or 1))
    stereo = np.stack([x, np.concatenate([np.zeros(18), x[:-18]])], axis=1)
    wavfile.write(OUT / f"{name}.wav", SR, (stereo * 32767).astype(np.int16))


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    sounds = make()
    assert set(sounds) == set(LOUD), set(sounds) ^ set(LOUD)
    for name, x in sorted(sounds.items()):
        write(name, x)
        print(f"{name:10s} {len(x) / SR:.2f} s")
