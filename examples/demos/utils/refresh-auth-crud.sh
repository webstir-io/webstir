#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/base-refresh.sh"
source "${SCRIPT_DIR}/provider-helpers.sh"

set_local_provider_specs "${WORKSPACE_ROOT_REFRESH_LIB}"
build_local_providers

usage() {
  cat <<'EOF'
Usage:
  refresh-auth-crud.sh [watch] [<webstir-watch-args...>]
EOF
}

if [[ "${1:-}" == "help" || "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

WATCH=0
case "${1:-}" in
  watch )
    WATCH=1
    shift
    ;;
esac

refresh_demo_dir full "${DEMOS_ROOT_REFRESH_LIB}/auth-crud"

if [[ "${WATCH}" -eq 1 ]]; then
  exec "${SCRIPT_DIR}/watch-demo.sh" auth-crud "$@"
fi
