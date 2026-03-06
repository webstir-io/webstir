#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMOS_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKSPACE_ROOT="$(cd "${DEMOS_ROOT}/../.." && pwd)"

set_local_provider_specs() {
  local frontend_spec="${WORKSPACE_ROOT}/packages/tooling/webstir-frontend"
  if [[ -z "${WEBSTIR_FRONTEND_PROVIDER_SPEC+x}" && -d "${frontend_spec}" ]]; then
    export WEBSTIR_FRONTEND_PROVIDER_SPEC="${frontend_spec}"
  fi

  local backend_spec="${WORKSPACE_ROOT}/packages/tooling/webstir-backend"
  if [[ -z "${WEBSTIR_BACKEND_PROVIDER_SPEC+x}" && -d "${backend_spec}" ]]; then
    export WEBSTIR_BACKEND_PROVIDER_SPEC="${backend_spec}"
  fi

  local testing_spec="${WORKSPACE_ROOT}/packages/tooling/webstir-testing"
  if [[ -z "${WEBSTIR_TESTING_PROVIDER_SPEC+x}" && -d "${testing_spec}" ]]; then
    export WEBSTIR_TESTING_PROVIDER_SPEC="${testing_spec}"
  fi
}

build_local_provider() {
  local label="$1"
  local spec="${2:-}"
  if [[ -z "${spec}" || ! -d "${spec}" || ! -f "${spec}/package.json" ]]; then
    return 0
  fi

  echo "Building ${label} provider at ${spec}..."
  if command -v pnpm >/dev/null 2>&1; then
    pnpm -C "${spec}" run build
  else
    (cd "${spec}" && npm run build)
  fi
}

build_local_providers() {
  build_local_provider "frontend" "${WEBSTIR_FRONTEND_PROVIDER_SPEC:-}"
  build_local_provider "backend" "${WEBSTIR_BACKEND_PROVIDER_SPEC:-}"
  build_local_provider "testing" "${WEBSTIR_TESTING_PROVIDER_SPEC:-}"
}

set_local_provider_specs
build_local_providers

usage() {
  cat <<'EOF'
Usage:
  enable-feature.sh <project|ssg|ssg-base|ssg-site|spa|api|full> <feature> [<feature-args...>]

Notes:
  - If <project> is one of ssg|ssg-base|ssg-site|spa|api|full, it targets the corresponding demo folder.
  - Otherwise, <project> can be a directory path (absolute or relative).
  - Additional args are passed to `webstir enable ...` before the trailing path.

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
dotnet run --project orchestrators/dotnet/CLI -- enable "${FEATURE}" "$@" "${PROJECT_DIR}"
