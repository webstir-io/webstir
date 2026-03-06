#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
MONOREPO_ROOT="$(git -C "$ROOT_DIR" rev-parse --show-toplevel)"

exec node "$MONOREPO_ROOT/tools/release-package.mjs" --package-dir "$ROOT_DIR" "$@"
