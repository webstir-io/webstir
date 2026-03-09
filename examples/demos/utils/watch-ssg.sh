#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
usage() {
  cat <<'EOF'
Usage:
  watch-ssg.sh <base|site> [<webstir-watch-args...>]

Examples:
  watch-ssg.sh base
  watch-ssg.sh site --port 4300
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

exec "${SCRIPT_DIR}/watch-demo.sh" ssg "${VARIANT}" "$@"
