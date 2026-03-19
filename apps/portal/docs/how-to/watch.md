# Watch

Use `watch` as the default development loop for HTML-first apps.
SPA and `full` now use Bun-native watch. `ssg` remains on the legacy frontend watch path intentionally for this phase, and `--frontend-runtime legacy` is now only for `ssg`.

## Command

```bash
webstir watch --workspace /absolute/path/to/workspace
webstir watch --workspace /absolute/path/to/workspace --frontend-runtime bun
webstir watch --workspace /absolute/path/to/workspace --frontend-runtime legacy
```

## What It Does

1. Detects the workspace mode from `package.json`.
2. Starts Bun-native frontend watch for `spa` and `full`, and the legacy frontend watch daemon for `ssg`.
3. Starts the backend build watcher and runtime for `api` and `full` workspaces.
4. Serves the frontend through Bun when a frontend surface exists.
5. Proxies `/api/*` to the backend runtime in `full` mode.
6. Rebuilds on changes under `src/**` and `types/**`.

`ssg` stays on the legacy frontend runtime for now. `--frontend-runtime bun` currently supports `spa` and `full` only. `--frontend-runtime legacy` is intentionally limited to `ssg`.

## What To Validate

Use the proof apps as the baseline:

- `bun run watch:auth-crud` to validate sign-in, validation recovery, redirect-after-post, and CRUD flows
- `bun run watch:dashboard` to validate shell and panel fragment refreshes

## Readiness

The backend runtime reports readiness with `API server running`. The orchestrator waits for the port to open before declaring the backend ready.
The Bun-native SPA path has integration coverage for JS HMR, CSS hot refresh, and unsupported-mode rejection. `full` also has Bun-native integration coverage for frontend edits, backend edits, and `/api` proxying.

To get a backend-only loop, scaffold an `api` workspace with `webstir init api <directory>`.

## Related Docs

- [Workflows](../reference/workflows.md)
- [Test](./test.md)
- [Publish](./publish.md)
