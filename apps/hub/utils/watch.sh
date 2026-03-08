#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

resolve_workspace_root() {
  local candidate
  for candidate in \
    "${ROOT_DIR}/.." \
    "${ROOT_DIR}/../.." \
    "${ROOT_DIR}/../../.."
  do
    candidate="$(cd "${candidate}" && pwd)"
    if [[ -f "${candidate}/orchestrators/bun/package.json" ]]; then
      echo "${candidate}"
      return 0
    fi
  done

  return 1
}

if ! WORKSPACE_ROOT="$(resolve_workspace_root)"; then
  echo "[webstir-hub] Could not resolve workspace root from ${ROOT_DIR}" >&2
  exit 1
fi

if [[ ! -f "${WORKSPACE_ROOT}/orchestrators/bun/package.json" ]]; then
  echo "[webstir-hub] Could not find the Bun orchestrator workspace under ${WORKSPACE_ROOT}/orchestrators/bun" >&2
  echo "[webstir-hub] Run this from the webstir monorepo root." >&2
  exit 1
fi

cd "${WORKSPACE_ROOT}"
exec bun run orchestrate:bun -- watch --workspace "${ROOT_DIR}" "$@"
