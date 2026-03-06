#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR_REFRESH_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMOS_ROOT_REFRESH_LIB="$(cd "${SCRIPT_DIR_REFRESH_LIB}/.." && pwd)"
WORKSPACE_ROOT_REFRESH_LIB="$(cd "${DEMOS_ROOT_REFRESH_LIB}/../.." && pwd)"

# Shared helper for demo refresh scripts (intentionally small + boring).

refresh_demo_dir() {
  local init_mode="$1"
  local demo_dir="$2"

  if [[ -z "${init_mode}" || -z "${demo_dir}" ]]; then
    echo "refresh_demo_dir requires: <init_mode> <demo_dir>" >&2
    return 1
  fi

  echo "Refreshing ${init_mode} demo at ${demo_dir}..."
  mkdir -p "${demo_dir}"

  rm -rf "${demo_dir}/"{*,.[!.]*,..?*} 2>/dev/null || true

  (
    cd "${WORKSPACE_ROOT_REFRESH_LIB}"
    dotnet run --project orchestrators/dotnet/CLI -- init "${init_mode}" "${demo_dir}"
  )
}
