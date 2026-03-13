# Watch

Use `watch` as the default development loop for HTML-first apps.

## Command

```bash
webstir watch --workspace /absolute/path/to/workspace
```

Optional scope filter:

```bash
webstir watch --workspace /absolute/path/to/workspace --runtime backend
```

## What It Does

1. Builds the active frontend and backend surfaces.
2. Runs tests for the selected runtime scope.
3. Starts the frontend dev server.
4. Starts the backend runtime when the workspace has `src/backend`.
5. Proxies `/api/*` through the frontend dev server in full-stack mode.
6. Rebuilds changed surfaces as files move under `src/**`.

## What To Validate

Use the proof apps as the baseline:

- `bun run watch:auth-crud` to validate sign-in, validation recovery, redirect-after-post, and CRUD flows
- `bun run watch:dashboard` to validate shell and panel fragment refreshes

## Readiness

The backend runtime reports readiness with `API server running`. The orchestrator waits for that line, then probes `/api/health` before declaring the backend ready.

## Related Docs

- [Workflows](../reference/workflows.md)
- [Test](./test.md)
- [Publish](./publish.md)
