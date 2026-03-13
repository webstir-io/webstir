# Watch

Use `watch` as the default development loop for HTML-first apps.

## Command

```bash
webstir watch --workspace /absolute/path/to/workspace
```

## What It Does

1. Detects the workspace mode from `package.json`.
2. Starts the frontend watch daemon for `spa`, `ssg`, and `full` workspaces.
3. Starts the backend build watcher and runtime for `api` and `full` workspaces.
4. Serves `build/frontend/**` through the Bun dev server when a frontend surface exists.
5. Proxies `/api/*` to the backend runtime in `full` mode.
6. Rebuilds on changes under `src/**` and `types/**`.

## What To Validate

Use the proof apps as the baseline:

- `bun run watch:auth-crud` to validate sign-in, validation recovery, redirect-after-post, and CRUD flows
- `bun run watch:dashboard` to validate shell and panel fragment refreshes

## Readiness

The backend runtime reports readiness with `API server running`. The orchestrator waits for the port to open before declaring the backend ready.

To get a backend-only loop, scaffold an `api` workspace with `webstir init api <directory>`.

## Related Docs

- [Workflows](../reference/workflows.md)
- [Test](./test.md)
- [Publish](./publish.md)
