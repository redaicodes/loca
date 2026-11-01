#!/usr/bin/env bash
# Records the 80-second demo from the hosted app and encodes it for X (1080p H.264, no audio).
#   pnpm add -D playwright-core && npx playwright install chromium
#   CH=<path to chromium> bash scripts/video/encode.sh   # writes runs/loca-demo.mp4
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="$PWD/runs/video" node scripts/video/record.cjs
ffmpeg -y -loglevel error -f concat -safe 0 -i runs/video/list.ffconcat \
  -vf "scale=1920:1080:flags=lanczos,fps=30,format=yuv420p" -c:v libx264 -preset slow -crf 18 -movflags +faststart runs/loca-demo.mp4
echo "runs/loca-demo.mp4"
