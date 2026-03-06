#!/usr/bin/env bash

set -euo pipefail

cat >&2 <<'EOF'
error: this package is an embedded framework copy under orchestrators/dotnet/Framework/**.
Run the canonical release helper from packages/tooling/webstir-backend instead.
EOF
exit 1
