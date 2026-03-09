#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMOS_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKSPACE_ROOT="$(cd "${DEMOS_ROOT}/../.." && pwd)"
source "${SCRIPT_DIR}/provider-helpers.sh"

set_local_provider_specs "${WORKSPACE_ROOT}"
build_local_providers

usage() {
  cat <<'EOF'
Usage:
  enable-feature.sh <project|ssg|ssg-base|ssg-site|spa|api|full> <feature> [<feature-args...>]

Notes:
  - If <project> is one of ssg|ssg-base|ssg-site|spa|api|full, it targets the corresponding demo folder.
  - Otherwise, <project> can be a directory path (absolute or relative).
  - Additional args are passed to `webstir enable ...` before the workspace flag.

Examples:
  enable-feature.sh ssg search
  enable-feature.sh ssg-base search
  enable-feature.sh ssg-site search
  enable-feature.sh ssg scripts home
  enable-feature.sh ./ssg/site search
  enable-feature.sh /abs/path/to/project client-nav
EOF
}

PROJECT_INPUT="${1:-}"
FEATURE="${2:-}"
if [[ -z "${PROJECT_INPUT}" || -z "${FEATURE}" || "${PROJECT_INPUT}" == "help" || "${PROJECT_INPUT}" == "--help" || "${PROJECT_INPUT}" == "-h" ]]; then
  usage
  exit 0
fi

shift 2

project_dir_from_mode() {
  local mode="$1"
  case "${mode}" in
    ssg )
      echo "${DEMOS_ROOT}/ssg/site"
      ;;
    ssg-base )
      echo "${DEMOS_ROOT}/ssg/base"
      ;;
    ssg-site )
      echo "${DEMOS_ROOT}/ssg/site"
      ;;
    spa )
      echo "${DEMOS_ROOT}/spa"
      ;;
    api )
      echo "${DEMOS_ROOT}/api"
      ;;
    full|fullstack )
      echo "${DEMOS_ROOT}/full"
      ;;
    * )
      return 1
      ;;
  esac
}

PROJECT_DIR=""
if PROJECT_DIR="$(project_dir_from_mode "${PROJECT_INPUT}")"; then
  :
else
  if [[ -d "${DEMOS_ROOT}/${PROJECT_INPUT}" ]]; then
    PROJECT_DIR="${DEMOS_ROOT}/${PROJECT_INPUT}"
  elif [[ -d "${WORKSPACE_ROOT}/${PROJECT_INPUT}" ]]; then
    PROJECT_DIR="${WORKSPACE_ROOT}/${PROJECT_INPUT}"
  elif [[ -d "${PROJECT_INPUT}" ]]; then
    PROJECT_DIR="$(cd "${PROJECT_INPUT}" && pwd)"
  else
    echo "Project directory not found for: ${PROJECT_INPUT}" >&2
    usage >&2
    exit 1
  fi
fi

echo "Enabling '${FEATURE}' in ${PROJECT_DIR}..."
cd "${WORKSPACE_ROOT}"
exec bun run webstir -- enable "${FEATURE}" "$@" --workspace "${PROJECT_DIR}"
