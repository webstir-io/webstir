#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$ROOT_DIR/build/frontend"
DIST_DIR="$ROOT_DIR/dist/frontend"

FRONTEND_CLI="$ROOT_DIR/node_modules/.bin/webstir-frontend"
if [[ ! -f "$FRONTEND_CLI" ]]; then
  echo "[publish] Missing $FRONTEND_CLI" >&2
  echo "[publish] Install dependencies first (npm install)." >&2
  exit 1
fi

rm -rf "$BUILD_DIR" >/dev/null 2>&1 || true
rm -rf "$DIST_DIR" >/dev/null 2>&1 || true

"$FRONTEND_CLI" build -w "$ROOT_DIR"
"$FRONTEND_CLI" publish -w "$ROOT_DIR" -m ssg
