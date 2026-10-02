#!/usr/bin/env bash
# Linux mirror of build-seek-test.ps1 -- produces byte-comparable structure.
# Kept ASCII-only for consistency. Override font with: FONT=/path/to.ttf ./build-seek-test.sh
set -euo pipefail
cd "$(dirname "$0")"

FONT="${FONT:-/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc}"
if [ ! -f "$FONT" ]; then echo "font not found: $FONT" >&2; exit 1; fi
cp "$FONT" font.ttf
echo "font: $FONT -> font.ttf"

COLS=(0xC00000 0x00A000 0x0000C0 0xE0A000 0x8000A0 0x00A0A0 0x606060 0xA0A0A0)

# two drawtext layers: small "T<i>" at top (which SECOND) + big %{n} centre (which FRAME)
for i in $(seq 0 7); do
  LBL="drawtext=fontfile=font.ttf:text=T${i}:fontsize=72:fontcolor=white:x=(w-tw)/2:y=70:box=1:boxcolor=black@0.5:boxborderw=14"
  NUM="drawtext=fontfile=font.ttf:text=%{n}:fontsize=260:fontcolor=white:x=(w-tw)/2:y=(h-th)/2:box=1:boxcolor=black@0.4:boxborderw=24"
  ffmpeg -v error -y -f lavfi -i "color=c=${COLS[$i]}:s=1280x720:r=25:d=1" \
    -vf "${LBL},${NUM}" \
    -c:v libx264 -pix_fmt yuv420p -g 25 -an "seg$i.mp4"
done
echo "segments ok (seg0..seg7)"

build() {
  local n="$1" out="$2"
  : > "list-$n.txt"
  for i in $(seq 0 $((n - 1))); do echo "file 'seg$i.mp4'" >> "list-$n.txt"; done
  ffmpeg -v error -y -f concat -safe 0 -i "list-$n.txt" -c copy -movflags +faststart -an "$out"
}

build 3 probe-seek.mp4
build 8 probe-seek-8s.mp4

ffmpeg -v error -y -i probe-seek.mp4    -c:v libvpx-vp9 -crf 32 -b:v 0 -pix_fmt yuv420p -an probe-seek.webm
ffmpeg -v error -y -i probe-seek-8s.mp4 -c:v libvpx-vp9 -crf 32 -b:v 0 -pix_fmt yuv420p -an probe-seek-8s.webm

echo "--- moov position ---"
for f in probe-seek.mp4 probe-seek-8s.mp4; do
  python3 - "$f" <<'PY'
import sys
d = open(sys.argv[1],'rb').read(4096)
m, t = d.find(b'moov'), d.find(b'mdat')
print(f"FASTSTART {sys.argv[1]}: moov@{m} mdat@{t} -> {'PASS' if 0 <= m < t else 'FAIL'}")
PY
done

echo "--- ffprobe ---"
for f in probe-seek.mp4 probe-seek-8s.mp4 probe-seek.webm probe-seek-8s.webm; do
  echo "$f => $(ffprobe -v error -show_entries stream=codec_name,width,height,pix_fmt,r_frame_rate,nb_frames \
    -show_entries format=duration -of csv=p=0 "$f" | tr '\n' ' ')"
done
echo DONE
