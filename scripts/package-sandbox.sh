#!/usr/bin/env bash
# Build the static site and produce sandbox upload zips.
#
#   dist/sandbox-website.zip   — index.html at zip root → select Website only
#   dist/sandbox-container.zip — Dockerfile + out/ + server → select Container only
#
# Zip layout: files at the zip root (no wrapper directory), per platform rules.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "→ Ensuring pricing book + building static export…"
node scripts/ensure-book.mjs
BUILD_TARGET=static npx next build

if [[ ! -f out/index.html ]]; then
  echo "error: out/index.html missing after build" >&2
  exit 1
fi

mkdir -p dist
WEBSITE_ZIP="$ROOT/dist/sandbox-website.zip"
CONTAINER_ZIP="$ROOT/dist/sandbox-container.zip"
rm -f "$WEBSITE_ZIP" "$CONTAINER_ZIP"

echo "→ Website zip (index.html at root)…"
# S3 key becomes <shortname>/index.html — contents of out/ must be zip root.
( cd out && zip -r "$WEBSITE_ZIP" . -x '*.DS_Store' )

echo "→ Container zip (Dockerfile at root + prebuilt out/)…"
# Minimal context: image COPYs only out/ and the static server.
zip -r "$CONTAINER_ZIP" Dockerfile out scripts/static-server.mjs -x '*.DS_Store'

echo
echo "Done."
echo "  Website  (select Website only):   $WEBSITE_ZIP"
echo "            unzip -l … | head → should show index.html at top level"
echo "  Container (select Container only): $CONTAINER_ZIP"
echo
unzip -l "$WEBSITE_ZIP" | head -20
echo "…"
unzip -l "$CONTAINER_ZIP" | head -20
