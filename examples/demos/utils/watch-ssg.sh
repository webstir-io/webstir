#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMOS_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKSPACE_ROOT="$(cd "${DEMOS_ROOT}/../.." && pwd)"
source "${SCRIPT_DIR}/provider-helpers.sh"

usage() {
  cat <<'EOF'
Usage:
  watch-ssg.sh <base|site> [<webstir-watch-args...>]

Examples:
  watch-ssg.sh base
  watch-ssg.sh site --runtime frontend
EOF
}

VARIANT="${1:-}"
if [[ -z "${VARIANT}" || "${VARIANT}" == "help" || "${VARIANT}" == "--help" || "${VARIANT}" == "-h" ]]; then
  usage
  exit 0
fi

case "${VARIANT}" in
  base|site )
    shift
    ;;
  * )
    echo "Unknown SSG variant: ${VARIANT}" >&2
    usage >&2
    exit 1
    ;;
esac

set_local_provider_specs "${WORKSPACE_ROOT}"
build_local_providers

exec "${SCRIPT_DIR}/watch-demo.sh" ssg "${VARIANT}" "$@"
