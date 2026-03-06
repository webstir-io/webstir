#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMOS_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKSPACE_ROOT="$(cd "${DEMOS_ROOT}/../.." && pwd)"
source "${SCRIPT_DIR}/provider-helpers.sh"

usage() {
  cat <<'EOF'
Usage:
  serve-demo.sh <ssg|spa|api|full> [base|site] [--host <host>] [--port <port>]

Notes:
  - Publishes the demo, then serves dist/frontend locally.
  - SSG requires a variant: base or site.
  - API publishes backend artifacts but has no frontend to serve.

Env:
  WEBSTIR_DEMO_HOST (default: 127.0.0.1)
  WEBSTIR_DEMO_PORT (default: 4173)

Examples:
  serve-demo.sh ssg base
  serve-demo.sh ssg site --port 4400
  serve-demo.sh spa
EOF
}

MODE="${1:-}"
if [[ -z "${MODE}" || "${MODE}" == "--help" || "${MODE}" == "-h" ]]; then
  usage
  exit 0
fi

case "${MODE}" in
  ssg|spa|api|full )
    ;;
  * )
    echo "Unknown demo mode: ${MODE}" >&2
    usage >&2
    exit 1
    ;;
esac

shift

VARIANT=""
if [[ "${MODE}" == "ssg" ]]; then
  VARIANT="${1:-}"
  case "${VARIANT}" in
    base|site )
      ;;
    * )
      echo "SSG requires a variant: base or site." >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
fi

HOST="${WEBSTIR_DEMO_HOST:-127.0.0.1}"
PORT="${WEBSTIR_DEMO_PORT:-4173}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host )
      HOST="${2:-}"
      shift 2
      ;;
    --port )
      PORT="${2:-}"
      shift 2
      ;;
    --help|-h )
      usage
      exit 0
      ;;
    * )
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "${MODE}" == "ssg" ]]; then
  DEMO_DIR="${DEMOS_ROOT}/ssg/${VARIANT}"
else
  DEMO_DIR="${DEMOS_ROOT}/${MODE}"
fi

if [[ ! -d "${DEMO_DIR}" ]]; then
  echo "Demo directory not found: ${DEMO_DIR}" >&2
  exit 1
fi

set_local_provider_specs "${WORKSPACE_ROOT}"

echo "Publishing ${MODE} demo at ${DEMO_DIR}..."
(
  cd "${DEMO_DIR}"
  if [[ "${MODE}" == "api" ]]; then
    dotnet run --project "${WORKSPACE_ROOT}/orchestrators/dotnet/CLI" -- publish --runtime backend
  else
    dotnet run --project "${WORKSPACE_ROOT}/orchestrators/dotnet/CLI" -- publish --runtime frontend
  fi
)

if [[ "${MODE}" == "api" ]]; then
  echo "API demo has no frontend output to serve."
  exit 0
fi

FRONTEND_DIR="${DEMO_DIR}/dist/frontend"
if [[ ! -d "${FRONTEND_DIR}" ]]; then
  echo "Missing publish output: ${FRONTEND_DIR}" >&2
  exit 1
fi

export SERVE_ROOT="${FRONTEND_DIR}"
export SERVE_HOST="${HOST}"
export SERVE_PORT="${PORT}"

node <<'NODE'
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const root = process.env.SERVE_ROOT;
const host = process.env.SERVE_HOST || "127.0.0.1";
const port = Number.parseInt(process.env.SERVE_PORT || "4173", 10);

if (!root) {
  console.error("SERVE_ROOT is required.");
  process.exit(1);
}

const rootResolved = path.resolve(root);
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".map": "application/json; charset=utf-8"
};

const getRelativePath = (requestUrl) => {
  const { pathname } = new URL(requestUrl, "http://localhost");
  const decoded = decodeURIComponent(pathname);
  const normalized = path.posix.normalize(decoded);
  const stripped = normalized.replace(/^(\.\.(\/|\\|$))+/, "");
  return stripped.replace(/^\/+/, "");
};

const isWithinRoot = (candidate) => {
  const resolved = path.resolve(candidate);
  return resolved === rootResolved || resolved.startsWith(rootResolved + path.sep);
};

const findFile = (relativePath) => {
  const basePath = path.join(rootResolved, relativePath);
  const hasExt = path.extname(relativePath) !== "";
  const candidates = [];

  if (hasExt) {
    candidates.push(basePath);
  }

  candidates.push(path.join(basePath, "index.html"));

  if (!hasExt) {
    candidates.push(`${basePath}.html`);
  }

  for (const candidate of candidates) {
    if (!isWithinRoot(candidate)) {
      continue;
    }
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) {
        return { path: candidate, stat };
      }
    } catch {
      // ignore missing files
    }
  }

  return null;
};

const server = http.createServer((req, res) => {
  if (!req.url || (req.method !== "GET" && req.method !== "HEAD")) {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method not allowed.");
    return;
  }

  const relativePath = getRelativePath(req.url);
  const file = findFile(relativePath);

  if (!file) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found.");
    return;
  }

  const ext = path.extname(file.path).toLowerCase();
  const headers = {
    "Content-Type": mimeTypes[ext] || "application/octet-stream",
    "Content-Length": file.stat.size,
    "Cache-Control": "no-cache"
  };

  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
    return;
  }

  const stream = fs.createReadStream(file.path);
  stream.on("error", () => {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Server error.");
  });
  stream.pipe(res);
});

server.listen(port, host, () => {
  console.log(`Serving ${rootResolved}`);
  console.log(`http://${host}:${port}/`);
});
NODE
