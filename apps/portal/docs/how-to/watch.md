# Watch

Use `watch` as the default development loop for HTML-first apps.
SPA now defaults to Bun-first watch. `ssg` and `full` remain on the legacy frontend watch path, and `--frontend-runtime legacy` keeps the old SPA behavior when needed.

## Command

```bash
webstir watch --workspace /absolute/path/to/workspace
webstir watch --workspace /absolute/path/to/workspace --frontend-runtime legacy
```

## What It Does

1. Detects the workspace mode from `package.json`.
2. Starts Bun-first frontend watch for `spa` by default and the legacy frontend watch daemon for `ssg` and `full`.
3. Starts the backend build watcher and runtime for `api` and `full` workspaces.
4. Serves `build/frontend/**` through the Bun dev server when a frontend surface exists.
5. Proxies `/api/*` to the backend runtime in `full` mode.
6. Rebuilds on changes under `src/**` and `types/**`.

For `spa`, `--frontend-runtime legacy` swaps back to the older daemon-backed path. Non-`spa` modes currently reject `--frontend-runtime bun`.

## What To Validate

Use the proof apps as the baseline:

- `bun run watch:auth-crud` to validate sign-in, validation recovery, redirect-after-post, and CRUD flows
- `bun run watch:dashboard` to validate shell and panel fragment refreshes

## Readiness

The backend runtime reports readiness with `API server running`. The orchestrator waits for the port to open before declaring the backend ready.
The Bun-first SPA path has its own integration coverage for JS HMR, CSS hot refresh, and unsupported-mode rejection.

To get a backend-only loop, scaffold an `api` workspace with `webstir init api <directory>`.

## Related Docs

- [Workflows](../reference/workflows.md)
- [Test](./test.md)
- [Publish](./publish.md)
