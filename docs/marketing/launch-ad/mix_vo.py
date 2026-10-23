"""Place the voiceover lines on the ad timeline and mix them with the music and SFX.

Input, either:
  vo/lines/01.wav ... 12.wav   one file per line of vo_lines.json (TTS output)
  vo/full.<ext>                one recording of the whole script, split on pauses
Output: vo.wav (52 s, 48 kHz) and the final MP4 with music ducked under the voice.
"""
import glob
import json
import os
import re
import subprocess
import sys

import numpy as np

SR = 48000
DUR = 52.0
LINES = json.load(open("vo_lines.json"))
OUT = sys.argv[1] if len(sys.argv) > 1 else "kolabreport_lancement_27oct_voix.mp4"


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True)


def load(path, start=None, end=None):
    """Decode any audio file to mono float32 at 48 kHz."""
    cmd = ["ffmpeg", "-v", "error"]
    if start is not None:
        cmd += ["-ss", f"{start:.3f}", "-to", f"{end:.3f}"]
    cmd += ["-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"]
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def speech_segments(path, noise="-35dB", gap=0.45):
    """Return (start, end) of the spoken parts, using ffmpeg silencedetect."""
    total = float(run("ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path).stdout)
    log = subprocess.run(["ffmpeg", "-i", path, "-af", f"silencedetect=noise={noise}:d={gap}", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", log)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", log)]
    ends += [total] * (len(starts) - len(ends))
    segs, cur = [], 0.0
    for s, e in zip(starts, ends):
        if s - cur > 0.25:
            segs.append((cur, s))
        cur = e
    if total - cur > 0.25:
        segs.append((cur, total))
    return segs


def trim(x, thr=0.01):
    idx = np.where(np.abs(x) > thr)[0]
    if len(idx) == 0:
        return x
    a = max(idx[0] - int(0.03 * SR), 0)
    b = min(idx[-1] + int(0.08 * SR), len(x))
    return x[a:b]


def clips():
    files = sorted(glob.glob("vo/lines/*.wav"))
    if files:
        assert len(files) == len(LINES), f"{len(files)} files for {len(LINES)} lines"
        return [trim(load(f)) for f in files]
    full = glob.glob("vo/full.*")
    assert full, "no voice found in vo/lines/ or vo/full.*"
    for noise in ("-35dB", "-30dB", "-40dB", "-25dB"):
        for gap in (0.45, 0.6, 0.35, 0.8):
            segs = speech_segments(full[0], noise, gap)
            if len(segs) == len(LINES):
                print(f"split on pauses: noise {noise}, gap {gap}s")
                return [trim(load(full[0], s, e)) for s, e in segs]
    sys.exit(f"could not split the recording into {len(LINES)} lines; last try found {len(segs)}")


def tempo(x, factor):
    """Speed up without changing pitch, through ffmpeg atempo."""
    p = subprocess.run(["ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-",
                        "-af", f"atempo={factor:.4f}", "-f", "f32le", "-"],
                       input=x.astype(np.float32).tobytes(), capture_output=True, check=True)
    return np.frombuffer(p.stdout, dtype=np.float32).copy()


vo = np.zeros(int(DUR * SR), dtype=np.float32)
cs = clips()
for i, (line, x) in enumerate(zip(LINES, cs)):
    nxt = LINES[i + 1]["at"] if i + 1 < len(LINES) else DUR - 0.6
    room = nxt - line["at"] - 0.12
    length = len(x) / SR
    if length > room:
        factor = min(length / room, 1.18)
        x = tempo(x, factor)
        print(f"{line['scene']}: {length:.2f}s in {room:.2f}s, sped up x{factor:.2f}")
    else:
        print(f"{line['scene']}: {length:.2f}s in {room:.2f}s")
    a = int(line["at"] * SR)
    b = min(a + len(x), len(vo))
    vo[a:b] += x[: b - a]

with open("vo_raw.f32", "wb") as f:
    f.write(vo.astype(np.float32).tobytes())
# Voice chain: rumble cut, presence lift, gentle compression, then loudness.
run("ffmpeg", "-y", "-v", "error", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "vo_raw.f32",
    "-af", "highpass=f=90,equalizer=f=3000:t=q:w=1.2:g=3,acompressor=threshold=0.08:ratio=3:attack=8:release=120:makeup=2,alimiter=limit=0.9",
    "-ac", "2", "vo.wav")
os.remove("vo_raw.f32")

# Music ducks about 9 dB under the voice; SFX stay as they are.
run("ffmpeg", "-y", "-v", "error", "-i", "video_raw.mp4", "-i", "music.wav", "-i", "sfx.wav", "-i", "vo.wav",
    "-filter_complex",
    "[3]asplit=2[v][key];"
    "[1]volume=0.8[m];"
    "[m][key]sidechaincompress=threshold=0.02:ratio=6:attack=15:release=350:makeup=1[md];"
    "[2]volume=0.8[s];"
    "[md][s][v]amix=inputs=3:normalize=0,loudnorm=I=-14:TP=-1:LRA=9[a]",
    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-shortest", "-movflags", "+faststart", OUT)
print("wrote", OUT)
