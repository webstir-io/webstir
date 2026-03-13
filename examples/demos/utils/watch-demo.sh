#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMOS_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKSPACE_ROOT="$(cd "${DEMOS_ROOT}/../.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  watch-demo.sh <ssg|spa|api|full|auth-crud|dashboard> [base|site] [<webstir-watch-args...>]

Examples:
  watch-demo.sh ssg base
  watch-demo.sh ssg site --port 4300
  watch-demo.sh spa --verbose

Notes:
  - This script does not re-initialize demos. Use the `refresh-*.sh` scripts if you need a clean re-init.
EOF
}

MODE="${1:-}"
if [[ -z "${MODE}" || "${MODE}" == "help" || "${MODE}" == "--help" || "${MODE}" == "-h" ]]; then
  usage
  exit 0
fi

shift

SSG_VARIANT=""
if [[ "${MODE}" == "ssg" ]]; then
  case "${1:-}" in
    base|site )
      SSG_VARIANT="${1}"
      shift
      ;;
    * )
      SSG_VARIANT="site"
      ;;
  esac
fi

DEMO_FOLDER=""
case "${MODE}" in
  ssg )
    DEMO_FOLDER="ssg/${SSG_VARIANT}"
    ;;
  spa )
    DEMO_FOLDER="spa"
    ;;
  api )
    DEMO_FOLDER="api"
    ;;
  full|fullstack )
    DEMO_FOLDER="full"
    ;;
  auth-crud|authcrud )
    DEMO_FOLDER="auth-crud"
    ;;
  dashboard )
    DEMO_FOLDER="dashboard"
    ;;
  * )
    echo "Unknown demo mode: ${MODE}" >&2
    usage >&2
    exit 1
    ;;
esac

DEMO_DIR="${DEMOS_ROOT}/${DEMO_FOLDER}"
if [[ ! -d "${DEMO_DIR}" ]]; then
  echo "Demo folder not found: ${DEMO_DIR}" >&2
  if [[ "${MODE}" == "ssg" ]]; then
    echo "Run: ${SCRIPT_DIR}/refresh-ssg.sh ${SSG_VARIANT}" >&2
  else
    echo "Run: ${SCRIPT_DIR}/refresh-${MODE}.sh" >&2
  fi
  exit 1
fi

echo "Starting watch for ${DEMO_DIR}..."
cd "${WORKSPACE_ROOT}"

stty_state=""
restore_stty() {
  if [[ -n "${stty_state}" ]]; then
    stty "${stty_state}" </dev/tty 2>/dev/null || true
  fi
}

if [[ -t 0 && -r /dev/tty ]]; then
  stty_state="$(stty -g </dev/tty 2>/dev/null || true)"
  if [[ -n "${stty_state}" ]]; then
    stty -echoctl </dev/tty 2>/dev/null || stty -ctlecho </dev/tty 2>/dev/null || true
  fi
fi

trap restore_stty EXIT

exec bun run webstir -- watch --workspace "${DEMO_DIR}" "$@"
