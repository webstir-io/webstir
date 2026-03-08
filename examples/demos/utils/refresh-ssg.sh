#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/base-refresh.sh"
source "${SCRIPT_DIR}/provider-helpers.sh"

set_local_provider_specs "${WORKSPACE_ROOT_REFRESH_LIB}"
build_local_providers

usage() {
  cat <<'EOF'
Usage:
  refresh-ssg.sh <base|site> [watch] [<webstir-watch-args...>]

Notes:
  - `site` enables common SSG features after refresh.
  - Default site features: client-nav search content-nav gh-deploy
  - Override enabled features with WEBSTIR_SSG_SITE_FEATURES (space-separated).

Examples:
  refresh-ssg.sh base
  refresh-ssg.sh site watch --runtime frontend
  WEBSTIR_SSG_SITE_FEATURES="client-nav search content-nav" refresh-ssg.sh site
EOF
}

VARIANT="${1:-}"
if [[ -z "${VARIANT}" || "${VARIANT}" == "help" || "${VARIANT}" == "--help" || "${VARIANT}" == "-h" ]]; then
  usage
  exit 0
fi

case "${VARIANT}" in
  base|site )
    ;;
  * )
    echo "Unknown SSG variant: ${VARIANT}" >&2
    usage >&2
    exit 1
    ;;
esac

shift

WATCH=0
case "${1:-}" in
  watch )
    WATCH=1
    shift
    ;;
esac

DEMO_DIR="${DEMOS_ROOT_REFRESH_LIB}/ssg/${VARIANT}"
refresh_demo_dir ssg "${DEMO_DIR}"

if [[ "${VARIANT}" == "site" ]]; then
  FEATURES="${WEBSTIR_SSG_SITE_FEATURES:-client-nav search content-nav gh-deploy}"
  HAS_CONTENT_NAV=0
  HAS_GH_DEPLOY=0
  ORDERED_FEATURES=()
  for feature in ${FEATURES}; do
    if [[ "${feature}" == "content-nav" ]]; then
      HAS_CONTENT_NAV=1
      continue
    fi
    if [[ "${feature}" == "gh-deploy" ]]; then
      HAS_GH_DEPLOY=1
      continue
    fi
    ORDERED_FEATURES+=("${feature}")
  done

  if [[ "${HAS_CONTENT_NAV}" -eq 1 ]]; then
    ORDERED_FEATURES+=("content-nav")
  fi
  if [[ "${HAS_GH_DEPLOY}" -eq 1 ]]; then
    ORDERED_FEATURES+=("gh-deploy")
  fi
  echo "Enabling SSG site features: ${ORDERED_FEATURES[*]}"
  for feature in "${ORDERED_FEATURES[@]}"; do
    (
      cd "${WORKSPACE_ROOT_REFRESH_LIB}"
      bun run orchestrate:bun -- enable "${feature}" --workspace "${DEMO_DIR}"
    )
  done
fi

if [[ "${WATCH}" -eq 1 ]]; then
  exec "${SCRIPT_DIR}/watch-demo.sh" ssg "${VARIANT}" "$@"
fi
