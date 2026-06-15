# Servers

Development and runtime servers used by Webstir.

## Overview
- Dev Web Server: Bun-hosted static server that serves built frontend assets, publishes watch status over SSE, and applies clean URLs with dev caching.
- Backend Runtime: runs the compiled backend entry (`build/backend/index.js`) and is restarted after successful backend rebuilds.
- Proxy: in `full` mode, the dev server proxies `/api/*` to the backend runtime.

See also: [Engine](engine.md) and [Services](services.md).

## Dev Web Server
- Serves `build/frontend/**` during `watch`.
- Clean URLs: `/about` serves `/pages/about/index.html`; `/` serves `/pages/home/index.html`.
- Live reload: SSE endpoint notifies connected browsers after frontend rebuilds.
- Caching: static assets cache with short TTL in dev; HTML not cached.
- Logs: prints the frontend URL, and in `full` mode also prints the backend origin.

## Backend Runtime
- Entry: `build/backend/index.js` produced by the backend compile step.
- Lifecycle: spawned by `api` or `full` watch; restarted on successful backend rebuilds.
- Environment: receives `PORT`, `API_BASE_URL`, `NODE_ENV`, and the active `WEBSTIR_MODULE_MODE`.
- Health: the default scaffold exposes `GET /api/health`, `GET /healthz`, and `GET /readyz`.

## Proxy Rules
- Path: `/api/*`.
- Method, headers, and body are forwarded to the backend runtime.
- Errors: if the backend is unavailable, the proxy returns a clear `502` response.

## Production

- Frontend publish artifacts live under `dist/frontend/**`.
- Backend publish output stays under `build/backend/**`.
- You can serve published assets with your own static host or CDN, and run the backend runtime separately when the workspace includes one.

## Errors & Resilience
- Dev server survives frontend rebuilds and continues serving.
- Proxy returns actionable messages if the API is unavailable.
- Backend restarts are serialized so one successful rebuild replaces the current process cleanly.

## Related Docs
- Solution overview — [solution](solution.md)
- Engine — [engine](engine.md)
- Services — [services](services.md)
- Pipelines — [pipelines](pipelines.md)
- CLI — [cli](../reference/cli.md)
