#!/usr/bin/env bash

set -euo pipefail

cat >&2 <<'EOF'
error: Utilities/scripts/publish.sh is no longer a valid release entrypoint in the canonical webstir monorepo.
Release npm packages from the canonical packages/** directories with their npm run release helpers,
or trigger the Release Package GitHub workflow for the target package.
EOF
exit 1
