# Workflows

End-to-end flows driven by the Bun CLI. Workflows coordinate the canonical frontend, backend, and testing packages so a workspace can move from source files to a running or publishable server-first HTML app.

## Core Commands

- `webstir init`
- `webstir build`
- `webstir watch`
- `webstir test`
- `webstir publish`
- `webstir smoke`
- `webstir operations`
- `webstir agent`
- `webstir doctor`
- `webstir add-page`
- `webstir add-route`
- `webstir add-job`
- `webstir add-test`

## Default Path

When in doubt, use this path:

1. `webstir init full <directory>`
2. Add document pages with `webstir add-page`
3. Keep forms, redirects, auth, and request-time HTML in `src/backend/module.ts`
4. Use `webstir add-route` for backend endpoints that need manifest metadata or inspection visibility
5. Define request-time views in `src/backend/module.ts` when a page needs server-loaded data at request time
6. Enable `client-nav` only after the baseline HTML flow is already correct
7. Use `webstir doctor` to confirm scaffold health and backend manifest health before shipping
8. Use `webstir repair` to restore scaffold drift without changing the app shape
9. Use `webstir publish` plus the Bun Docker deployment contract for shipped `api` and `full` workspaces

## Flow Shape

1. Resolve the workspace and detect which surfaces exist.
2. Choose the active build plan from `webstir.mode`:
   - `spa` and `ssg` => frontend
   - `api` => backend
   - `full` => frontend + backend
   - `full` is the main lane for server-first apps with forms, redirects, auth, and optional enhancement.
3. Run the canonical package logic from `packages/tooling/**`.
4. Emit `build/**` for development and test work.
5. Emit `dist/frontend/**` for publish-ready frontend assets when a frontend surface exists.
6. Start or supervise long-running services only when the workflow requires them.

## Workflow Contracts

### `init`

- Creates a starter workspace for `spa`, `ssg`, `api`, or `full`
- Writes source roots under `src/**` plus `types/**`

### `build`

- Runs the frontend and/or backend package pipelines for the workspace mode
- Writes `build/frontend/**` and `build/backend/**`

### `watch`

- Starts Bun-native frontend watch for `spa`, `ssg`, and `full`
- Starts the backend build watcher and runtime for `api` and `full`
- Proxies `/api/*` in full-stack watch mode

### `test`

- Rebuilds the required surfaces
- Discovers tests under `src/**/tests`
- Executes compiled suites through the active testing provider

### `publish`

- Produces optimized frontend assets under `dist/frontend/**`
- Produces backend bundles under `build/backend/**`
- Validates the same runtime shape that the proof apps use in publish mode
- For published `api` and `full`, pair the workspace with the supported Bun Docker deployment helper under `orchestrators/bun/resources/deployment/docker`

## Runtime Scope

Only `webstir test` supports `--runtime <frontend|backend|all>`.

`build`, `watch`, and `publish` follow the workspace mode instead of a runtime flag. If you need a backend-only loop, use an `api` workspace. If you need frontend-only output, use `spa` or `ssg`.

## Practical Reference

If you want to see the workflows exercised against real applications, use:

- `examples/demos/full` as the canonical `webstir test` and server-first workflow reference
- `examples/demos/auth-crud` as a proof app for richer auth and CRUD flows, not the canonical scaffold shape
- `examples/demos/dashboard` as a deliberate enhancement proof, not a default architecture target

Together those demos cover the current HTML-first runtime across redirect-after-post, fragment updates, sessions, auth gates, and publish-mode validation.

## Recipe Benchmarks

Use the pinned recipe apps and benchmark runner when you want to prove the current agent-facing lane instead of just describing it:

- `examples/demos/full` is the scaffold-aligned golden-path recipe
- `examples/demos/auth-crud` is the richer auth and CRUD proof recipe
- `examples/demos/dashboard` is the fragment-refresh proof recipe
- `bun run benchmark:agent-tasks` runs the current benchmark plan across those recipes

That benchmark intentionally stays close to the real framework operations: `doctor`, `backend-inspect`, `test`, and `publish`.

## Related Docs

- [Solution Overview](../explanations/solution.md)
- [Watch](../how-to/watch.md)
- [Test](../how-to/test.md)
- [Publish](../how-to/publish.md)
