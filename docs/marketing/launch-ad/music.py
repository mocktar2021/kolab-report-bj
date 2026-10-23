"""Soundtrack for the KolabReport launch ad: an Afrobeats-style groove at
120 BPM with a build into a drop on the logo, plus transition and interface
sound effects placed on the scene timings. Writes music.wav and sfx.wav."""
import json
import wave
import numpy as np

SR = 44100
DUR = 52.0
BPM = 120
BEAT = 60 / BPM
STEP = BEAT / 4  # sixteenth note
N = int(SR * DUR)
rng = np.random.default_rng(7)
T = json.load(open("timings.json"))


def t_arr(sec):
    return np.arange(int(SR * sec)) / SR


def place(buf, sig, at, gain=1.0):
    i = int(at * SR)
    if i >= len(buf):
        return
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[: j - i] * gain


def fft_filter(x, lo=None, hi=None, slope=0.15):
    """Smooth band filter in the frequency domain (lo/hi in Hz)."""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    g = np.ones_like(f)
    if hi:
        g *= 1 / (1 + (f / hi) ** (1 / slope * 0.6))
    if lo:
        g *= 1 / (1 + (lo / np.maximum(f, 1)) ** (1 / slope * 0.6))
    return np.fft.irfft(X * g, n=len(x))


def reverb(x, sec=1.6, decay=0.45, wet=0.18):
    ir_t = t_arr(sec)
    ir = rng.standard_normal(len(ir_t)) * np.exp(-ir_t / decay)
    ir = fft_filter(ir, lo=300, hi=7000)
    ir /= np.sqrt(np.sum(ir ** 2))
    n = len(x) + len(ir)
    y = np.fft.irfft(np.fft.rfft(x, n) * np.fft.rfft(ir, n), n)[: len(x)]
    return x + wet * y


def note(name):
    names = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
    pitch, octave = name[:-1], int(name[-1])
    midi = 12 * (octave + 1) + names[pitch]
    return 440 * 2 ** ((midi - 69) / 12)


# ---------- instruments ----------
def kick():
    t = t_arr(0.45)
    f = 48 + 110 * np.exp(-t / 0.035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t / 0.16) * 1.0 + rng.standard_normal(len(t)) * np.exp(-t / 0.004) * 0.15


def clap():
    t = t_arr(0.35)
    env = np.zeros_like(t)
    for k, d in enumerate([0, 0.011, 0.022]):
        env += (t >= d) * np.exp(-np.maximum(t - d, 0) / (0.012 if k < 2 else 0.11))
    return fft_filter(rng.standard_normal(len(t)), lo=900, hi=6000) * env * 0.5


def shaker(acc):
    t = t_arr(0.07)
    return fft_filter(rng.standard_normal(len(t)), lo=6000, hi=14000) * np.exp(-t / 0.018) * (0.16 if acc else 0.08)


def talking_drum(freq):
    t = t_arr(0.3)
    f = freq * (1 + 0.5 * np.exp(-t / 0.03)) * (1 - 0.12 * t / 0.3)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t / 0.09) * 0.35


def bass(freq, length):
    t = t_arr(length)
    env = np.minimum(1, t / 0.01) * np.exp(-t / 0.5)
    s = np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(4 * np.pi * freq * t)
    return np.tanh(1.6 * s) * env * 0.55


def marimba(freq):
    t = t_arr(0.6)
    s = np.sin(2 * np.pi * freq * t) * np.exp(-t / 0.22) + 0.35 * np.sin(2 * np.pi * freq * 3.9 * t) * np.exp(-t / 0.05)
    return s * np.minimum(1, t / 0.002) * 0.22


def pad(freqs, length):
    t = t_arr(length)
    s = np.zeros_like(t)
    for fr in freqs:
        for det in (-0.004, 0, 0.004):
            for h, a in ((1, 1), (2, 0.35), (3, 0.18), (4, 0.08)):
                s += a * np.sin(2 * np.pi * fr * (1 + det) * h * t + rng.uniform(0, 6.28))
    env = np.minimum(1, t / 0.4) * np.minimum(1, (length - t) / 0.4)
    return fft_filter(s, hi=2200) * env * 0.035


def riser(length, lo=300, hi=6000):
    t = t_arr(length)
    noise = rng.standard_normal(len(t))
    out = np.zeros_like(t)
    seg = int(SR * 0.05)
    for i in range(0, len(t), seg):
        k = i / len(t)
        c = lo * (hi / lo) ** k
        out[i:i + seg] = fft_filter(noise[i:i + seg], lo=c * 0.6, hi=c * 1.6)
    f = 200 * (8 ** (t / length))
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.15
    return (out * 0.5 + tone) * (t / length) ** 2


def impact():
    t = t_arr(1.8)
    boom = np.sin(2 * np.pi * np.cumsum(38 + 60 * np.exp(-t / 0.08)) / SR) * np.exp(-t / 0.55)
    crash = fft_filter(rng.standard_normal(len(t)), lo=3000, hi=12000) * np.exp(-t / 0.5) * 0.3
    return boom * 0.9 + crash


# ---------- arrangement ----------
music = np.zeros(N)
drums = np.zeros(N)
DROP = T["s3"][0]          # logo
LIFT = T["s12"][0]         # end card
END_HIT = 51.0

chords = [  # one bar each, A minor feel: Am, F, C, G
    (note("A1"), [note("A3"), note("C4"), note("E4")], [note("A4"), note("C5"), note("E5"), note("C5")]),
    (note("F1"), [note("F3"), note("A3"), note("C4")], [note("F4"), note("A4"), note("C5"), note("A4")]),
    (note("C2"), [note("C4"), note("E4"), note("G4")], [note("C5"), note("E5"), note("G5"), note("E5")]),
    (note("G1"), [note("G3"), note("B3"), note("D4")], [note("G4"), note("B4"), note("D5"), note("B4")]),
]
BAR = 4 * BEAT
n_bars = int(np.ceil(DUR / BAR))

for b in range(n_bars):
    t0 = b * BAR
    root, padv, arp = chords[b % 4]
    full = DROP <= t0 < END_HIT
    intro = t0 < DROP
    # pads all along, louder in the intro
    place(music, pad(padv, BAR + 0.2), t0, 1.4 if intro else 0.8)
    if intro:
        # sparse intro: shaker and a heartbeat kick from the second bar
        for s in range(16):
            if s % 2 == 1:
                place(drums, shaker(s % 4 == 3), t0 + s * STEP, 0.7)
        if b >= 1:
            place(drums, kick(), t0, 0.7)
            place(drums, kick(), t0 + 8 * STEP, 0.5)
        for s in (0, 6, 10):
            place(music, marimba(arp[s % 4] * 2), t0 + s * STEP, 0.5)
        continue
    if not full:
        continue
    for s in (0, 6, 8):
        place(drums, kick(), t0 + s * STEP, 1.0)
    if b % 2 == 1:
        place(drums, kick(), t0 + 14 * STEP, 0.6)
    for s in (4, 12):
        place(drums, clap(), t0 + s * STEP, 1.0)
    for s in range(16):
        place(drums, shaker(s % 4 == 2), t0 + s * STEP)
    for s, fr in ((3, 180), (6, 150), (11, 200), (14, 160)):
        place(drums, talking_drum(fr), t0 + s * STEP)
    for s, mul in ((0, 1), (3, 1), (6, 2), (10, 1), (12, 2)):
        place(music, bass(root * mul, STEP * 3), t0 + s * STEP)
    for k, s in enumerate((0, 2, 3, 6, 8, 10, 11, 14)):
        place(music, marimba(arp[k % 4] * 2), t0 + s * STEP, 0.8)

# builds and hits
place(music, riser(DROP - 4.5), 4.5, 0.9)
place(music, impact(), DROP, 1.0)
place(music, riser(2.0, 800, 8000), LIFT - 2.0, 0.7)
place(music, impact(), LIFT, 0.8)
place(music, impact(), END_HIT, 1.0)
for fr in chords[0][1]:
    t = t_arr(1.0)
    place(music, np.sin(2 * np.pi * fr * 2 * t) * np.exp(-t / 0.4) * 0.12, END_HIT)
# drums stop on the last hit
drums[int(END_HIT * SR):] *= np.exp(-np.arange(N - int(END_HIT * SR)) / (SR * 0.05))

# sidechain: the kick ducks pads and bass
duck = np.ones(N)
for b in range(n_bars):
    for s in (0, 6, 8):
        at = b * BAR + s * STEP
        if DROP <= at < END_HIT:
            i = int(at * SR)
            env = 1 - 0.45 * np.exp(-np.arange(int(0.25 * SR)) / (SR * 0.07))
            j = min(N, i + len(env))
            duck[i:j] = np.minimum(duck[i:j], env[: j - i])
music = reverb(music * duck, wet=0.22) + reverb(drums, sec=0.8, decay=0.2, wet=0.08)
fade = np.ones(N)
fade[-int(0.6 * SR):] = np.linspace(1, 0, int(0.6 * SR))
music = np.tanh(music * 0.9) * fade

# ---------- sound effects on the picture ----------
sfx = np.zeros(N)


def whoosh():
    t = t_arr(0.5)
    out = np.zeros_like(t)
    noise = rng.standard_normal(len(t))
    seg = int(SR * 0.025)
    for i in range(0, len(t), seg):
        k = i / len(t)
        c = 600 + 4500 * np.sin(np.pi * k)
        out[i:i + seg] = fft_filter(noise[i:i + seg], lo=c * 0.5, hi=c * 1.5)
    return out * np.sin(np.pi * t / 0.5) ** 2 * 0.35


def pop(pitch=900):
    t = t_arr(0.12)
    f = pitch * (1 + 0.8 * np.exp(-t / 0.01))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.035) * 0.3


def click():
    t = t_arr(0.04)
    return fft_filter(rng.standard_normal(len(t)), lo=1500, hi=8000) * np.exp(-t / 0.006) * 0.35


def key():
    t = t_arr(0.03)
    return fft_filter(rng.standard_normal(len(t)), lo=2500, hi=9000) * np.exp(-t / 0.004) * 0.08


for sid, (a, b) in T.items():
    if a > 0:
        place(sfx, whoosh(), a - 0.3)

S = {k: v[0] for k, v in T.items()}
pops = [
    (S["s3"] + 1.1, 1100),
    (S["s4"] + 0.5, 800), (S["s4"] + 3.5, 1200),
    (S["s5"] + 1.6, 1000), (S["s5"] + 2.0, 1300), (S["s5"] + 2.6, 1300),
    (S["s6"] + 3.3, 900), (S["s6"] + 3.5, 1000), (S["s6"] + 4.9, 1250),
    (S["s8"] + 0.7, 700), (S["s8"] + 0.92, 800), (S["s8"] + 1.14, 900),
    (S["s9"] + 1.75, 800), (S["s9"] + 2.4, 1000), (S["s9"] + 2.55, 1150),
    (S["s10"] + 0.7, 800), (S["s10"] + 1.4, 1100),
    (S["s11"] + 1.1, 900), (S["s11"] + 1.32, 1000), (S["s11"] + 1.54, 1150),
    (S["s12"] + 1.9, 1100),
]
for at, p in pops:
    place(sfx, pop(p), at)
for i in range(10):
    place(sfx, pop(1500 + 80 * i) * 0.5, S["s1"] + 0.7 + i * 0.07)
for at in (S["s4"] + 3.2, S["s6"] + 4.6):
    place(sfx, click(), at)
t_type = S["s6"] + 1.1
while t_type < S["s6"] + 3.5:
    place(sfx, key(), t_type)
    t_type += 0.055 + rng.uniform(0, 0.05)


def write(path, x):
    x = np.clip(x, -1, 1)
    data = (np.stack([x, x], axis=1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())


write("music.wav", music / max(1e-9, np.max(np.abs(music))) * 0.9)
write("sfx.wav", sfx)
print("ok", DUR, "s")
