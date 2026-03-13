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
2. Run the canonical package logic from `packages/tooling/**`.
3. Emit `build/**` for development/test work.
4. Emit `dist/frontend/**` for publish-ready frontend assets.
5. Start or supervise long-running services only when the workflow requires them.

## Workflow Contracts

### `init`

- Creates a starter workspace for `spa`, `ssg`, `api`, or `full`
- Writes source roots under `src/**` plus `types/**`

### `build`

- Runs the frontend and/or backend package pipelines for the workspace mode
- Writes `build/frontend/**` and `build/backend/**`

### `watch`

- Runs `build`, then `test`
- Starts the frontend dev server
- Starts the backend runtime when `src/backend` exists
- Proxies `/api/*` in full-stack watch mode

### `test`

- Rebuilds the required surfaces
- Discovers tests under `src/**/tests`
- Executes compiled suites through the active testing provider

### `publish`

- Produces optimized frontend assets under `dist/frontend/**`
- Produces backend bundles under `build/backend/**`
- Validates the same runtime shape that the proof apps use in publish mode

## Runtime Scope

`build`, `watch`, `test`, and `publish` accept `--runtime <frontend|backend|all>` so you can narrow the loop to the surface you are changing.

Examples:

- `webstir watch --runtime backend`
- `webstir test --runtime frontend`
- `webstir publish --runtime backend`

## Practical Reference

If you want to see the workflows exercised against real applications, use:

- `examples/demos/auth-crud`
- `examples/demos/dashboard`

Those proof apps cover the current HTML-first runtime across redirect-after-post, fragment updates, sessions, and publish-mode validation.

## Related Docs

- [Solution Overview](../explanations/solution.md)
- [Watch](../how-to/watch.md)
- [Test](../how-to/test.md)
- [Publish](../how-to/publish.md)
