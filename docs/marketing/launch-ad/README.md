# Launch ad (27 October 2026)

A 52 second vertical video (1080x1920, 30 fps) for Reels, TikTok, Shorts and WhatsApp status. Twelve animated scenes live in `ad.html`. The music and sound effects come from `music.py`, and a French voiceover goes on top. The ad names no country, because KolabReport sells wherever customers can pay with FedaPay or by bank transfer.

## Files

| File | What it holds |
| --- | --- |
| `ad.html` | The 12 scenes and the timeline. `window.renderAt(t)` draws the frame at `t` seconds. |
| `timings.json` | Start and end of each scene, in seconds. `ad.html` and `music.py` both read it. |
| `render.mjs` | Takes screenshots of `ad.html` with Playwright and pipes them into ffmpeg. |
| `render-all.sh` | Renders the video in three parts at once, joins them, then runs `music.py`. |
| `music.py` | Writes `music.wav` (120 BPM, drop on the logo) and `sfx.wav` (whooshes, pops, clicks). |
| `vo_lines.json` | The 12 voiceover lines and the second each one starts. |
| `voix-off.txt` | The same lines, for a person who records them. |
| `gen_vo.py` | Makes the 12 lines with the Kokoro voice model. |
| `mix_vo.py` | Places the voice lines, lowers the music under them and writes the final MP4. |
| `legende.txt` | French caption for the post. |
| `legende-disponible.txt` | French caption for the posts once sign-up is open. |
| `fonts/` | Instrument Sans and Inter Tight, so the render needs no network. |

Videos and audio files stay out of git (see `.gitignore`). Rebuild them from the source.

## Build the video

You need the repo's `node_modules` (`npm ci` at the root), Python 3 with numpy, and ffmpeg.

```sh
cd docs/marketing/launch-ad
sh render-all.sh          # about 10 minutes on 4 CPUs
```

This writes `video_raw.mp4`, `music.wav` and `sfx.wav`. To preview a few frames first, run `node render.mjs stills 5 12.5 48`. The PNG files land in `stills/`.

For a version without a voice:

```sh
ffmpeg -i video_raw.mp4 -i music.wav -i sfx.wav \
  -filter_complex "[1]volume=0.8[m];[2]volume=1.0[s];[m][s]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1:LRA=9[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart kolabreport_lancement_sans_voix.mp4
```

## Add the voice

There are three ways to get the 12 lines: ElevenLabs (see below), Kokoro, or a person reading the script.

With Kokoro, free and Apache 2.0. The files come from Hugging Face, so the environment must allow `huggingface.co`.

```sh
python3 -m venv .venv && .venv/bin/pip install kokoro-onnx soundfile
mkdir -p models
curl -L -o models/model.onnx https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model.onnx
curl -L -o models/ff_siwis.bin https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/ff_siwis.bin
.venv/bin/python gen_vo.py models/model.onnx models/ff_siwis.bin
```

If Hugging Face is blocked, the kokoro-onnx GitHub release has the same model: `kokoro-v1.0.onnx`, and `voices-v1.0.bin`, which holds every voice. Take the French one out of it:

```sh
curl -L -o models/model.onnx https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -L -o models/voices.bin https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
.venv/bin/python -c "import numpy as np; np.load('models/voices.bin')['ff_siwis'].tofile('models/ff_siwis.bin')"
```

With a person reading `voix-off.txt`: leave about one second of silence between lines and save the recording as `vo/full.m4a` (any format ffmpeg reads). `mix_vo.py` splits it on the pauses.

Then mix:

```sh
python3 mix_vo.py kolabreport_lancement_27oct.mp4
```

Each line starts at its time in `vo_lines.json`. A line too long for its scene is sped up by 18% at most. The music drops by about 13 dB while the voice speaks, so the voice sits about 9 dB above it, and the whole mix is set to -14 LUFS, the level social apps expect.

## The ending once sign-up is open

From 27 October, "Lancement le 27 octobre" is out of date. `AD_ENDING=disponible` swaps it for "Disponible maintenant", in scene 3 and in the last scene, and reads the last voice line from `text_disponible` in `vo_lines.json` (KRB-244):

```sh
AD_ENDING=disponible sh render-all.sh
AD_ENDING=disponible .venv/bin/python gen_vo.py models/model.onnx models/ff_siwis.bin
python3 mix_vo.py kolabreport_disponible.mp4
```

A person reading the script ends with this line instead: "Kolab Report. Disponible maintenant. Rendez-vous sur kolabreport point com." Post it with `legende-disponible.txt`.

## Change the ad

- Scene text is in `ad.html`, in French.
- To make a scene longer or shorter, change `timings.json`, then move the `at` times in `vo_lines.json` to match. The music follows the new timings.
- The first voiced version came from ElevenLabs (voice "Paul K, French Ad & Trailer", model eleven_v4), one node per line in the flow "KolabReport lancement voix off". Audio made on a free ElevenLabs plan is not licensed for commercial use, so that version must not run. Post the Kokoro version or one read by a person, or make the ElevenLabs one again during a paid month.

## Licences

- Fonts: Instrument Sans and Inter Tight, SIL Open Font License 1.1.
- Music and sound effects: generated by `music.py` with no samples, so Mocktar Technologies owns them.
- Kokoro model: Apache 2.0, commercial use allowed.
