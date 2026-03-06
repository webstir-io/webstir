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
    if [[ -d "${candidate}/orchestrators/dotnet/CLI" ]]; then
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

if command -v webstir >/dev/null 2>&1; then
  exec webstir watch "${ROOT_DIR}" "$@"
fi

CLI_PROJECT="${WORKSPACE_ROOT}/orchestrators/dotnet/CLI"
if [[ ! -d "${CLI_PROJECT}" ]]; then
  echo "[webstir-hub] Could not find Webstir CLI project at ${CLI_PROJECT}" >&2
  echo "[webstir-hub] Install Webstir (webstir on PATH) or run from the webstir-io workspace." >&2
  exit 1
fi

cd "${WORKSPACE_ROOT}"
exec dotnet run --project "${CLI_PROJECT}" -- watch --project "webstir-hub" "$@"
