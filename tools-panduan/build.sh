#!/usr/bin/env bash
# Rekam ulang SEMUA video panduan dengan satu perintah, lalu kecilkan ukuran + buat poster, dan taruh di ../panduan.
# Pakai (dari folder tools-panduan):   ./build.sh            # semua video
#                                      ./build.sh 04 10      # hanya video yang namanya memuat 04 atau 10
# Butuh: Node 22+, Playwright (npm i -g playwright), ffmpeg.
set -euo pipefail
cd "$(dirname "$0")"
REPO="$(cd .. && pwd)"; PORT="${PORT:-8788}"; OUT="${OUT:-$(mktemp -d)}"
export NODE_PATH="$(npm root -g)"
node --experimental-sqlite server.mjs "$REPO" saas "$PORT" >"$OUT/server.log" 2>&1 &
SRV=$!; trap 'kill $SRV 2>/dev/null || true' EXIT
for i in $(seq 1 30); do curl -s "localhost:$PORT/api/coach" >/dev/null 2>&1 && break; sleep 0.5; done
node --experimental-sqlite record.mjs saas "$PORT" "$OUT" "$@"
for f in "$OUT"/*.webm; do
  n="$(basename "${f%.webm}")"
  ffmpeg -loglevel error -y -i "$f" -c:v libvpx-vp9 -crf 38 -b:v 0 -an "$REPO/panduan/$n.webm"
  ffmpeg -loglevel error -y -ss 4 -i "$f" -frames:v 1 -q:v 4 "$REPO/panduan/$n.jpg"
  echo "ok $n  $(du -k "$REPO/panduan/$n.webm" | cut -f1) KB"
done
