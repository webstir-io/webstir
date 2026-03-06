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
exec "${SCRIPT_DIR}/watch-demo.sh" api "$@"
