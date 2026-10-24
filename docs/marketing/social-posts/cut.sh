#!/bin/sh
# Cuts the 52 s launch ad to 28 s for TikTok and Reels ads (KRB-246).
#   sh cut.sh ../launch-ad/kolabreport_disponible.mp4 out/kolabreport_28s_disponible.mp4
# It keeps the hook (s1), the logo (s3, first 2 s), one section per expert and the AI (s5, s6),
# then the free trial and the end card (s11, s12). The scenes change on hard cuts, so the
# picture needs no transition. Every cut sits on a beat at 120 BPM, and the two sides of each
# join sit at the same place in the bar, so the music keeps time.
set -eu
in=$1
out=$2

# Start and end of each part, in seconds of the full ad (see ../launch-ad/timings.json).
parts="0:4 8:10 16:27 41:52"

filter=""
inputs=""
n=0
for part in $parts; do
  a=${part%:*}
  b=${part#*:}
  fade_out=$(awk "BEGIN { print $b - $a - 0.012 }")
  # 12 ms fades at each join stop the audio from clicking.
  filter="$filter[0:v]trim=$a:$b,setpts=PTS-STARTPTS[v$n];"
  filter="$filter[0:a]atrim=$a:$b,asetpts=PTS-STARTPTS,afade=t=in:d=0.012,afade=t=out:st=$fade_out:d=0.012[a$n];"
  inputs="$inputs[v$n][a$n]"
  n=$((n + 1))
done
filter="$filter${inputs}concat=n=$n:v=1:a=1[v][a]"

mkdir -p "$(dirname "$out")"
ffmpeg -y -v error -i "$in" -filter_complex "$filter" -map "[v]" -map "[a]" \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -r 30 \
  -c:a aac -b:a 192k -ar 48000 -movflags +faststart "$out"
echo "wrote $out"
