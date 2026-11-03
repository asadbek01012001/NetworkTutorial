#!/usr/bin/env bash
# Builds the site and backend and puts them on the production server.
# Uses SSH key login as root. Videos are only uploaded with --media.
#
#   bash scripts/deploy.sh            # frontend + backend + content
#   bash scripts/deploy.sh --media    # also compress/encode/upload new videos
set -euo pipefail

SERVER=root@185.191.141.166
APP=/opt/networktutorial
cd "$(dirname "$0")/.."

echo "== build frontend"
npm run build >/dev/null

echo "== build backend (linux)"
(cd backend && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o networktutorial-linux .)

if [[ "${1:-}" == "--media" ]]; then
  echo "== videos: compress media-src -> media-web, encode -> media-server, upload new ones"
  mkdir -p media-web media-server
  for f in media-src/*.mp4; do
    o="media-web/$(basename "$f")"
    [[ -f "$o" && "$o" -nt "$f" ]] && continue
    ffmpeg -v error -y -i "$f" -c:v libx264 -preset slow -crf 28 -tune animation -pix_fmt yuv420p \
      -c:a aac -b:a 96k -movflags +faststart -sn "$o.tmp.mp4" && mv "$o.tmp.mp4" "$o"
  done
  node scripts/encode-media.mjs media-web media-server
  ssh "$SERVER" "df -h / | tail -1"
  for f in media-server/*.dat; do
    id=$(basename "$f")
    [[ -f "media-server/.up_$id" && "media-server/.up_$id" -nt "$f" ]] && continue
    scp -q "$f" "$SERVER:$APP/media/$id.part"
    ssh "$SERVER" "mv $APP/media/$id.part $APP/media/$id"
    touch "media-server/.up_$id"
    echo "uploaded $id"
  done
fi

echo "== upload"
scp -q backend/networktutorial-linux "$SERVER:$APP/backend/networktutorial.new"
scp -q -r backend/content/lessons.json backend/content/exam.json backend/content/tests backend/content/timelines "$SERVER:$APP/backend/content/"
ssh "$SERVER" "rm -rf $APP/dist.new && mkdir -p $APP/dist.new"
scp -q -r dist/* "$SERVER:$APP/dist.new/"

echo "== switch and restart"
ssh "$SERVER" "set -e
  mv $APP/backend/networktutorial.new $APP/backend/networktutorial
  chmod 755 $APP/backend/networktutorial
  rm -rf $APP/dist.old && mv $APP/dist $APP/dist.old && mv $APP/dist.new $APP/dist && rm -rf $APP/dist.old
  chown -R networktutorial:networktutorial $APP
  systemctl restart networktutorial
  sleep 2
  systemctl is-active networktutorial
  curl -s -o /dev/null -w 'backend: %{http_code}\n' http://127.0.0.1:8080/"
