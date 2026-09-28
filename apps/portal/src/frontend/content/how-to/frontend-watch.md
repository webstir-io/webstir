# Frontend Watch

Guidance for running and troubleshooting the current frontend watch workflow.

## Overview
- `webstir watch` builds every frontend workspace with the same pipeline as `webstir build` and serves the result from the workspace build directory. `spa`, `ssg` and `full` differ only in what the server does around it.
- `full` proxies `/api/*` to the supervised backend runtime and renders server views per request.
- After a rebuild, the browser updates by what changed:
  - **CSS** swaps in place.
  - **A page script** (anything under `src/frontend/pages/<page>/` that compiles to JavaScript): with client-nav, the page is shown again from the new code, where it is. The old page's cleanup runs, the new code's `load` and `setup` run, and `<main>` is swapped. Scroll, focus, the app shell and anything outside `<main>` stay. Without client-nav, the page reloads.
  - **Anything else** (HTML, the app shell, `app.ts`) reloads the page.
- A rebuild that fails a build check (a binding in an SPA page, a browser page rule) keeps serving the last valid page and reports the error.

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
- Backend-backed validation in an app with a server should still use `webstir watch` so the `/api` proxy and runtime restarts stay in the loop.
