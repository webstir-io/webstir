#!/usr/bin/env bash
set -euo pipefail

set_local_provider_specs() {
  local workspace_root="$1"

  local frontend_spec="${workspace_root}/packages/tooling/webstir-frontend"
  if [[ -z "${WEBSTIR_FRONTEND_PROVIDER_SPEC+x}" && -d "${frontend_spec}" ]]; then
    export WEBSTIR_FRONTEND_PROVIDER_SPEC="${frontend_spec}"
  fi

  local backend_spec="${workspace_root}/packages/tooling/webstir-backend"
  if [[ -z "${WEBSTIR_BACKEND_PROVIDER_SPEC+x}" && -d "${backend_spec}" ]]; then
    export WEBSTIR_BACKEND_PROVIDER_SPEC="${backend_spec}"
  fi

  local testing_spec="${workspace_root}/packages/tooling/webstir-testing"
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
  if command -v bun >/dev/null 2>&1; then
    bun run --cwd "${spec}" build
  else
    echo "Missing bun; unable to build ${label} provider at ${spec}." >&2
    return 1
  fi
}

build_local_providers() {
  build_local_provider "frontend" "${WEBSTIR_FRONTEND_PROVIDER_SPEC:-}"
  build_local_provider "backend" "${WEBSTIR_BACKEND_PROVIDER_SPEC:-}"
  build_local_provider "testing" "${WEBSTIR_TESTING_PROVIDER_SPEC:-}"
}
