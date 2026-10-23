#!/bin/sh
# Renders the 52 s video in three parallel parts (one per CPU), joins them
# into video_raw.mp4, then builds music.wav and sfx.wav.
set -eu
cd "$(dirname "$0")"
node render.mjs video seg_0.mp4 30 52 0 520 > seg_0.log 2>&1 &
node render.mjs video seg_520.mp4 30 52 520 1040 > seg_520.log 2>&1 &
node render.mjs video seg_1040.mp4 30 52 1040 1560 > seg_1040.log 2>&1 &
wait
printf "file 'seg_0.mp4'\nfile 'seg_520.mp4'\nfile 'seg_1040.mp4'\n" > segs.txt
ffmpeg -v error -y -f concat -safe 0 -i segs.txt -c copy -movflags +faststart video_raw.mp4
rm -f seg_*.mp4 seg_*.log segs.txt
python3 music.py
echo "video_raw.mp4, music.wav and sfx.wav are ready"
