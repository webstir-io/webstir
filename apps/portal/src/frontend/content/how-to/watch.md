# Watch

Use `watch` as the default development loop for HTML-first apps.

## Command

```bash
webstir watch --workspace /absolute/path/to/workspace
```

## What It Does

1. Detects the workspace mode from `package.json`.
2. Builds the frontend of `spa`, `ssg` and `full` workspaces with the same pipeline as `webstir build`, and serves it, so what watch shows is what a build produces.
3. Starts the backend build watcher and runtime for `api` and `full` workspaces.
4. Proxies `/api/*` to the backend runtime in `full` mode.
5. Rebuilds on changes under `src/**` and `types/**`, then updates the browser:
   - a CSS edit swaps the stylesheet in place
   - a page script edit shows the page again from the new code, in place, when client-nav is on (the page reloads without it)
   - anything else reloads the page
6. Keeps serving the last valid page when an edit fails a build check, and reports the error.

The old `--frontend-runtime` flag has been removed. Frontend watch follows the workspace mode directly.

## What To Validate

Use the proof apps as the baseline:

- `bun run watch:auth-crud` to validate sign-in, validation recovery, redirect-after-post, and CRUD flows
- `bun run watch:dashboard` to validate shell and panel fragment refreshes

## Readiness

The backend runtime reports readiness with `API server running`. The orchestrator waits for the port to open before declaring the backend ready.
The watch suite covers SPA rebuilds, in-place page refresh, CSS hot swaps and removed-flag handling, and `full` has integration coverage for frontend edits, backend edits, and `/api` proxying.

To get a backend-only loop, scaffold an `api` workspace with `webstir init api <directory>`.

## Related Docs

- [Workflows](../reference/workflows.md)
- [Test](./test.md)
- [Publish](./publish.md)
