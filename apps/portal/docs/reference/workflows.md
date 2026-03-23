# Workflows

End-to-end flows driven by the Bun CLI. Workflows coordinate the canonical frontend, backend, and testing packages so a workspace can move from source files to a running or publishable application.

## Core Commands

- `webstir init`
- `webstir build`
- `webstir watch`
- `webstir test`
- `webstir publish`
- `webstir smoke`
- `webstir add-page`
- `webstir add-route`
- `webstir add-job`
- `webstir add-test`

## Flow Shape

1. Resolve the workspace and detect which surfaces exist.
2. Choose the active build plan from `webstir.mode`:
   - `spa` and `ssg` => frontend
   - `api` => backend
   - `full` => frontend + backend
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
- For local production checks, pair the published workspace with the Bun sandbox helper under `orchestrators/bun/resources/deployment/sandbox`

## Runtime Scope

Only `webstir test` supports `--runtime <frontend|backend|all>`.

`build`, `watch`, and `publish` follow the workspace mode instead of a runtime flag. If you need a backend-only loop, use an `api` workspace. If you need frontend-only output, use `spa` or `ssg`.

## Practical Reference

If you want to see the workflows exercised against real applications, use:

- `examples/demos/full` as the canonical `webstir test` and full-stack workflow reference
- `examples/demos/auth-crud` and `examples/demos/dashboard` as browser/publish proof apps, not extra required `webstir test` lanes

Together those demos cover the current HTML-first runtime across redirect-after-post, fragment updates, sessions, and publish-mode validation.

## Related Docs

- [Solution Overview](../explanations/solution.md)
- [Watch](../how-to/watch.md)
- [Test](../how-to/test.md)
- [Publish](../how-to/publish.md)
