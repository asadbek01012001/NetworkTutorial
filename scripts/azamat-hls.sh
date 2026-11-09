#!/usr/bin/env bash
# Builds the "Azamat Qodirov darslari" section from compressed lecture videos.
# Give the videos in lesson order (1-dars first):
#
#   bash scripts/azamat-hls.sh a.mp4 b.mp4 c.mp4 ...
#
# For lecture N (azamatNN) it makes:
#   media-azamat/azamatNN/{index.m3u8,key,seg*.ts}  AES-128 encrypted HLS
#   public/posters/azamatNN.jpg                      card picture
# and writes backend/content/azamat.json (ids + durations).
# Upload: bash scripts/deploy.sh --azamat
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p media-azamat public/posters

json="["
n=0
for f in "$@"; do
  n=$((n + 1))
  id=$(printf "azamat%02d" "$n")
  dir="media-azamat/$id"
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
  if [[ ! -f "$dir/index.m3u8" || "$f" -nt "$dir/index.m3u8" ]]; then
    rm -rf "$dir" && mkdir -p "$dir"
    openssl rand 16 > "$dir/key"
    printf 'key\n%s\n' "$dir/key" > "$dir/keyinfo"
    ffmpeg -v error -y -i "$f" -c copy -f hls -hls_time 10 -hls_playlist_type vod \
      -hls_key_info_file "$dir/keyinfo" -hls_segment_filename "$dir/seg%04d.ts" "$dir/index.m3u8"
    rm "$dir/keyinfo"
    echo "$id <- $f ($(ls "$dir" | wc -l) files)"
  fi
  poster="public/posters/$id.jpg"
  if [[ ! -f "$poster" || "$f" -nt "$poster" ]]; then
    ffmpeg -v error -y -ss "$(awk "BEGIN{print int($d*0.3)}")" -i "$f" -frames:v 1 \
      -vf "scale='min(1280,iw)':-2" -q:v 3 "$poster"
  fi
  [[ $n -gt 1 ]] && json+=","
  json+=$'\n'"  {\"id\": \"$id\", \"duration\": $(awk "BEGIN{printf \"%.1f\", $d}")}"
done
printf '%s\n]\n' "$json" > backend/content/azamat.json
echo "backend/content/azamat.json: $n lectures"
