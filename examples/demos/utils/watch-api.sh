#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMOS_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKSPACE_ROOT="$(cd "${DEMOS_ROOT}/../.." && pwd)"
source "${SCRIPT_DIR}/provider-helpers.sh"

set_local_provider_specs "${WORKSPACE_ROOT}"
build_local_providers
exec "${SCRIPT_DIR}/watch-demo.sh" api "$@"
