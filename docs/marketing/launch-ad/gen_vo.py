"""Make one French voice clip per line of vo_lines.json with Kokoro (Apache 2.0).

  python3 gen_vo.py models/model.onnx models/ff_siwis.bin [speed]

The model and the ff_siwis voice come from onnx-community/Kokoro-82M-v1.0-ONNX
on Hugging Face (see README.md). Writes vo/lines/01.wav to 12.wav at 24 kHz.
"""
import json
import os
import sys

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

model, voice_file = sys.argv[1], sys.argv[2]
speed = float(sys.argv[3]) if len(sys.argv) > 3 else 1.05

# kokoro-onnx reads its voices from an .npz file, so wrap the one voice in one.
os.makedirs("models", exist_ok=True)
voice = np.fromfile(voice_file, dtype=np.float32).reshape(-1, 1, 256)
np.savez("models/voice.npz", fr=voice)
kokoro = Kokoro(model, "models/voice.npz")

os.makedirs("vo/lines", exist_ok=True)
for i, line in enumerate(json.load(open("vo_lines.json")), 1):
    samples, sr = kokoro.create(line["text"], voice="fr", speed=speed, lang="fr-fr")
    sf.write(f"vo/lines/{i:02d}.wav", samples, sr)
    print(f"{i:02d} {len(samples) / sr:.2f}s {line['text']}")
