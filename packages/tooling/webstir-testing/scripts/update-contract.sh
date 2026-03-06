#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/update-contract.sh [x.y.z|--latest] [--exact] [--fast]

Updates @webstir-io/testing-contract (defaults to latest when no version is provided),
installs deps, then builds and tests the testing package. Does NOT publish. If
everything passes, run the repo's release process separately.

Examples:
  scripts/update-contract.sh                # use latest
  scripts/update-contract.sh --latest       # explicit latest
  scripts/update-contract.sh 0.1.2          # specific version (caret range)
  scripts/update-contract.sh 0.1.2 --exact  # set exact version instead of ^range
  scripts/update-contract.sh 0.1.2 --fast   # lockfile-only update; skip build/test
EOF
  exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

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
        usage
        ;;
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
    echo "› Resolving latest @webstir-io/testing-contract version"
    ver="$(npm view @webstir-io/testing-contract version 2>/dev/null || true)"
    if [[ -z "$ver" ]]; then
      echo "error: unable to resolve latest @webstir-io/testing-contract version" >&2
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

  echo "› Setting @webstir-io/testing-contract to $spec"
  npm pkg set "dependencies.@webstir-io/testing-contract=$spec"

  echo "› npm install (refresh lockfile)"
  if [[ "$fast" == "true" ]]; then
    npm install --package-lock-only --no-audit --no-fund --ignore-scripts
  else
    npm install --no-audit --no-fund
  fi

  local pkg_version
  pkg_version="$(node -p "require('./package.json').version" 2>/dev/null || echo 'unknown')"
  local installed_contract
  installed_contract="$(npm ls @webstir-io/testing-contract --json 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);const v=(j.dependencies&&j.dependencies['@webstir-io/testing-contract']&&j.dependencies['@webstir-io/testing-contract'].version)||'';console.log(v||'unknown')}catch{console.log('unknown')}})")"
  echo "› Testing package: @webstir-io/webstir-testing@${pkg_version}"
  echo "› Contract installed: @webstir-io/testing-contract@${installed_contract}"

  if [[ "$fast" != "true" ]]; then
    if has_script build; then
      echo "› npm run build"
      npm run build
    fi

    if has_script test; then
      echo "› npm test"
      npm test
    fi

    if has_script smoke; then
      echo "› npm run smoke"
      npm run smoke
    fi
  fi

  echo
  echo "Contract update complete: @webstir-io/testing-contract@$spec"
}

main "$@"
