#!/usr/bin/env bash
# Copies finished lesson videos from the course folder into media-src/,
# makes posters for new ones and rebuilds the language timelines.
# Only videos that exist are imported, so it can be re-run as more
# languages get rendered.
#
#   bash scripts/import-videos.sh [course dir]
# Then: bash scripts/deploy.sh --media
set -euo pipefail

COURSE="${1:-C:/Users/PC/Desktop/ip_tutorial/course}"
cd "$(dirname "$0")/.."
mkdir -p media-src public/posters

ids=($(node -e "console.log(require('./backend/content/lessons.json').map(l => l.id).join(' '))"))

for i in "${!ids[@]}"; do
  n=$(printf %02d $((i + 1)))
  id=${ids[$i]}
  dir="$COURSE/lesson$n"
  declare -A src=(
    [uz]="$(ls "$dir"/Dars${n}_*.mp4 2>/dev/null | head -1)"
    [en]="$(ls "$dir"/Lesson${n}_*_EN.mp4 2>/dev/null | head -1)"
    [ru]="$(ls "$dir"/Urok${n}_*_RU.mp4 2>/dev/null | head -1)"
  )
  for lang in uz en ru; do
    f="${src[$lang]}"
    [[ -z "$f" ]] && continue
    # Skip files that are still being rendered (no readable duration yet).
    if ! ffprobe -v error -show_entries format=duration -of csv=p=0 "$f" 2>/dev/null | grep -q '[0-9]'; then
      echo "skip (incomplete) $f"
      continue
    fi
    out="media-src/$id.$lang.mp4"
    if [[ ! -f "$out" || "$f" -nt "$out" ]]; then
      cp "$f" "$out"
      echo "imported $id.$lang"
    fi
    poster="public/posters/$id.$lang.jpg"
    if [[ ! -f "$poster" || "$out" -nt "$poster" ]]; then
      d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out")
      ffmpeg -v error -y -ss "$(awk "BEGIN{print int($d*0.3)}")" -i "$out" -frames:v 1 -vf scale=1280:-2 -q:v 3 "$poster"
    fi
  done
  unset src
done

node scripts/build-timelines.mjs "$COURSE"
