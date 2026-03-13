# Services

Long-running helpers that keep the Bun watch loop small and predictable.

The active implementation no longer uses the older `DevService` / `WatchService` / `ChangeService` class structure. Instead, the Bun orchestrator composes a small set of focused helpers.

## Active Pieces

- `DevServer`: serves `build/frontend/**`, emits SSE status/reload events, and proxies `/api/*` in `full` mode
- `WorkspaceWatcher`: watches `src/**` and `types/**`, batching changes and full reload triggers
- `FrontendWatchDaemonClient`: launches `webstir-frontend watch-daemon` and forwards structured diagnostics
- `WatchCoordinator` (frontend package): performs incremental frontend rebuilds and decides between HMR and full reloads
- `BackendRuntimeSupervisor`: starts and restarts `build/backend/index.js` after successful backend builds

## Responsibilities Split

- Orchestrator commands decide which helpers are needed for the workspace mode.
- The frontend package owns incremental frontend build logic and HMR decisions.
- The Bun orchestrator owns process supervision, HTTP serving, and proxying.

## Change Flow

- Frontend file changes flow through `WorkspaceWatcher` to the frontend watch daemon.
- The frontend daemon emits diagnostics that the orchestrator turns into browser status, HMR, or reload events.
- Backend rebuild completions flow through `startBackendWatch()` and trigger `BackendRuntimeSupervisor.restart()`.

## Why This Matters

This split keeps the active system simple:

- frontend logic stays in the frontend package
- backend build logic stays in the backend package
- the CLI remains a coordinator instead of a second implementation of those pipelines

## Related Docs

- Engine — [engine](engine.md)
- Dev service — [devservice](devservice.md)
- Servers — [servers](servers.md)
- Watch workflow — [watch](../how-to/watch.md)
