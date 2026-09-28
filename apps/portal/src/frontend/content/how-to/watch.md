# Watch

Use `watch` as the default development loop for HTML-first apps.

## Command

```bash
webstir watch --workspace /absolute/path/to/workspace
```

## What It Does

1. Reads the app's layers from its files: pages (`src/frontend`) and server (`src/backend/index.ts`).
2. Builds the frontend of an app with pages with the same pipeline as `webstir build`, and serves it, so what watch shows is what a build produces. Without a server, it also renders build-time views as the publish will.
3. Starts the backend build watcher and runtime when the app has a server.
4. Proxies `/api/*` to the backend runtime when the app has pages and a server.
5. Rebuilds on changes under `src/**` and `types/**`, then updates the browser:
   - a CSS edit swaps the stylesheet in place
   - a page script edit shows the page again from the new code, in place, when client-nav is on (the page reloads without it)
   - anything else reloads the page
6. Keeps serving the last valid page when an edit fails a build check, and reports the error.

The old `--frontend-runtime` flag has been removed. Watch follows the app's layers directly.

## What To Validate

Use the proof apps as the baseline:

- `bun run watch:auth-crud` to validate email-code sign-in (the code is in the terminal), validation recovery, redirect-after-post, and CRUD flows on the batteries
- `bun run watch:dashboard` to validate shell and panel fragment refreshes

## Readiness

The backend runtime reports readiness with `API server running`. The orchestrator waits for the port to open before declaring the backend ready.
The watch suite covers frontend rebuilds, in-place page refresh, CSS hot swaps and removed-flag handling, and apps with pages and a server have integration coverage for frontend edits, backend edits, and `/api` proxying.

An app with a server and no pages gets a backend-only loop; `webstir init api <directory>` starts one.

## Related Docs

- [Workflows](../reference/workflows.md)
- [Test](./test.md)
- [Publish](./publish.md)
