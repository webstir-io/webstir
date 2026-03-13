# Dev Service

Hosts the development web server behavior used during `watch`.

The current Bun implementation is split across `frontend-watch.ts`, `api-watch.ts`, `full-watch.ts`, and `dev-server.ts`, but the responsibility is still the same: keep the local dev loop running with clear status and minimal ceremony.

## Responsibilities
- Serve `build/frontend/**` over HTTP with clean URLs.
- Expose an SSE endpoint to notify connected browsers to reload after frontend rebuilds.
- Proxy `/api/*` to the backend runtime in `full` mode.
- Apply sensible cache headers in dev (HTML not cached; assets short-TTL).

## Lifecycle
1. Start the dev server for frontend-capable workspaces.
2. Start the frontend watch daemon and/or backend runtime depending on workspace mode.
3. Watch `src/**` and `types/**`; on changes:
   - Frontend change → incremental frontend rebuild → broadcast HMR or reload events.
   - Backend change → rebuild backend → restart the runtime if the rebuild succeeded.
   - Root configuration change (`package.json`, `base.tsconfig.json`, `types.global.d.ts`) → full frontend reload.

## Ports & Env
- Web server prints the URL on startup; picks a free port or uses a configured one.
- Node server respects common env vars:
  - `PORT`
  - `WEB_SERVER_URL`
  - `API_SERVER_URL`

## Errors & Resilience
- Clear logs on failures; unrecoverable startup errors return non-zero exit codes via the CLI.
- Backend runtime restarts are serialized to avoid overlap.
- Proxy returns actionable errors if the API target is down.

## Related Docs
- Services overview — services.md
- Servers — servers.md
- Engine — engine.md
- Workflows — ../reference/workflows.md
- Workspace & paths — workspace.md
