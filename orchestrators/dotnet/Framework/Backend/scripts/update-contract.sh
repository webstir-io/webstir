#!/usr/bin/env bash

set -euo pipefail

cat >&2 <<'EOF'
error: this package is an embedded framework copy under orchestrators/dotnet/Framework/**.
Update @webstir-io/module-contract from packages/tooling/webstir-backend/scripts/update-contract.sh instead.
EOF
exit 1
