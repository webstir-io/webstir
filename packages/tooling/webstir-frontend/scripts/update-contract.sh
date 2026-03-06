#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/update-contract.sh [x.y.z|--latest] [--exact] [--fast]

Updates @webstir-io/module-contract (defaults to latest when no version is provided),
installs deps, then builds and tests the frontend package. Does NOT publish. If
everything passes, run scripts/publish.sh <bump> separately.

Examples:
  scripts/update-contract.sh                # use latest
  scripts/update-contract.sh --latest       # explicit latest
  scripts/update-contract.sh 0.1.9          # specific version (caret range)
  scripts/update-contract.sh 0.1.9 --exact  # set exact version instead of ^range
  scripts/update-contract.sh 0.1.9 --fast   # lockfile-only update; skip build/test
EOF
  exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
MONOREPO_ROOT="$(git -C "$ROOT_DIR" rev-parse --show-toplevel)"
PACKAGE_NAME="$(node -p "require('./package.json').name" 2>/dev/null)"

has_script() {
  local script_name="$1"
  node -e "const fs=require('fs'); const pkg=JSON.parse(fs.readFileSync('package.json','utf8')); const has=!!(pkg.scripts && Object.prototype.hasOwnProperty.call(pkg.scripts, '${script_name}')); process.exit(has ? 0 : 1);"
}

main() {
  local ver=""
  local exact="false"
  local fast="false"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --latest)
        ver="__resolve_latest__"
        ;;
      --exact)
        exact="true"
        ;;
      --fast)
        fast="true"
        ;;
      -h|--help)
        usage ;;
      *)
        if [[ -n "$ver" && "$ver" != "__resolve_latest__" ]]; then
          echo "error: duplicate version argument '$1'" >&2
          usage
        fi
        ver="$1"
        ;;
    esac
    shift || true
  done

  if [[ -z "$ver" || "$ver" == "__resolve_latest__" ]]; then
    echo "› Resolving latest @webstir-io/module-contract version"
    ver="$(npm view @webstir-io/module-contract version 2>/dev/null || true)"
    if [[ -z "$ver" ]]; then
      echo "error: unable to resolve latest @webstir-io/module-contract version" >&2
      exit 1
    fi
  fi

  if [[ ! $ver =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "error: invalid version '$ver' (expected x.y.z)" >&2
    usage
  fi

  cd "$ROOT_DIR"

  local spec
  if [[ "$exact" == "true" ]]; then
    spec="$ver"
  else
    spec="^$ver"
  fi

  echo "› Setting @webstir-io/module-contract to $spec"
  npm pkg set "dependencies.@webstir-io/module-contract=$spec"

  echo "› bun install (refresh workspace lockfile)"
  if [[ "$fast" == "true" ]]; then
    bun install --cwd "$MONOREPO_ROOT" --filter "$PACKAGE_NAME" --lockfile-only
  else
    bun install --cwd "$MONOREPO_ROOT" --filter "$PACKAGE_NAME"
  fi

  local frontend_ver
  frontend_ver="$(node -p "require('./package.json').version" 2>/dev/null || echo 'unknown')"
  local installed_contract
  installed_contract="$(node -p "try { require('@webstir-io/module-contract/package.json').version } catch { 'unknown' }" 2>/dev/null || echo 'unknown')"
  echo "› Frontend package: @webstir-io/webstir-frontend@${frontend_ver}"
  echo "› Contract installed: @webstir-io/module-contract@${installed_contract}"

  if [[ "$fast" != "true" ]]; then
    if has_script build; then
      echo "› bun run build"
      bun run build
    fi

    if has_script test; then
      echo "› bun run test"
      bun run test
    fi

    if has_script smoke; then
      echo "› bun run smoke"
      bun run smoke
    fi
  fi

  echo
  echo "Contract update complete: @webstir-io/module-contract@$spec"
}

main "$@"
