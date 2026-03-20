# Frontend Watch

Guidance for running and troubleshooting the current frontend watch workflow.

## Overview
- `webstir watch` runs the Bun dev server for frontend workspaces.
- `spa` and `ssg` serve rebuilt frontend output directly from the workspace build directory.
- `full` uses the same frontend host and proxies `/api/*` to the supervised backend runtime.
- Hot updates apply when the changed asset can be targeted directly; otherwise the browser falls back to a full reload after rebuild.

## CLI Commands
- Default frontend loop: `webstir watch --workspace <absolute-path>`
- Bind a different address or port: `webstir watch --workspace <absolute-path> --host 0.0.0.0 --port 8088`
- One-off frontend build: `bunx webstir-frontend build --workspace <absolute-path>`
- Targeted frontend rebuild: `bunx webstir-frontend rebuild --workspace <absolute-path> --changed-file <absolute-path>`

## Failure Recovery
1. Stop `webstir watch`, then start it again.
2. If dependencies drift, run `bun install` in the workspace, then restart the watch loop.
3. Rebuild once with `bunx webstir-frontend build --workspace <absolute-path>` to confirm the frontend package can emit fresh output outside the long-running watch loop.
4. If the issue is limited to `full`, rerun the workspace with `webstir watch` and confirm the backend runtime restarts cleanly after a backend edit.

## Fallbacks
- Clearing `build/frontend` and `dist/frontend` is safe; the next build or watch cycle will repopulate outputs.
- Frontend-only validation can use `bunx webstir-frontend build` or `bunx webstir-frontend rebuild` directly.
- Backend-backed validation in `full` mode should still use `webstir watch` so the `/api` proxy and runtime restarts stay in the loop.
