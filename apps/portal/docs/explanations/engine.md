# Engine

Core implementation that powers the active Bun CLI. In the current monorepo, the engine is the orchestration code under `orchestrators/bun/src` plus the canonical provider packages under `packages/tooling/**`.

## Overview

- Parses CLI commands and workspace paths.
- Chooses the active build plan from `webstir.mode`.
- Loads the canonical frontend, backend, and testing packages.
- Coordinates build, publish, watch, test, and scaffold flows.
- Keeps the live runtime Bun-first while leaving the older `.NET` tree archival.

## Responsibilities

- Resolve the workspace descriptor from `package.json`.
- Run frontend and backend providers in the right order for the workspace mode.
- Serve `build/frontend/**` in watch mode and proxy `/api/*` when both surfaces are active.
- Supervise the Bun-native frontend watch path for `spa`, `ssg`, and `full`, plus the backend runtime in long-running loops.
- Keep command output compact and machine-friendly enough for CI and smoke flows.

## Structure

- CLI entrypoint: `orchestrators/bun/src/cli.ts`
- Command execution: `build.ts`, `publish.ts`, `watch.ts`, `test.ts`, `smoke.ts`
- Workspace and mode resolution: `workspace.ts`, `build-plan.ts`, `types.ts`
- Provider loading: `providers.ts`
- Watch runtime: `frontend-watch.ts`, `api-watch.ts`, `full-watch.ts`
- Dev server and runtime supervision: `dev-server.ts`, `backend-runtime.ts`

## Workflow Model

### `init`

- Copies Bun-owned template assets from `orchestrators/bun/assets/templates/**`
- Writes `package.json`, `base.tsconfig.json`, and the mode-specific `src/**` layout

### `build`

- Runs the current build plan for the workspace mode
- Emits readable development artifacts under `build/**`

### `publish`

- Reuses the same providers in publish mode
- Emits optimized frontend assets under `dist/frontend/**`
- Emits backend publish output under `build/backend/**`

### `watch`

- `spa`: Bun-native frontend watch
- `ssg`: Bun-native frontend watch + Bun dev server
- `api`: backend watcher + runtime supervisor
- `full`: Bun-native frontend watch plus backend watcher/runtime and `/api/*` proxying

### `test`

- Rebuilds the requested surfaces
- Compiles discovered `src/**/tests/**` suites
- Runs them through the canonical testing provider

## Watch Runtime Pieces

- `bun-generated-frontend-watch.ts`: Bun-native generated frontend host used by `spa` and `full`
- `bun-ssg-watch.ts`: Bun-native frontend watch session used by `ssg`
- `DevServer`: static file server with SSE status/reload events and optional `/api/*` proxying
- `WorkspaceWatcher`: watches `src/**` and `types/**`, batching changes and full reload events
- `BackendRuntimeSupervisor`: starts `build/backend/index.js`, waits for readiness, and restarts on successful rebuilds

## Provider Boundary

The orchestrator does not implement frontend and backend compilation itself. It delegates to the canonical packages:

- `@webstir-io/webstir-frontend`
- `@webstir-io/webstir-backend`
- `@webstir-io/webstir-testing`

That boundary is the active source of truth for build and runtime behavior.

## Outputs

- Dev: `build/frontend/**` and/or `build/backend/**`
- Publish: `dist/frontend/**` plus backend publish output in `build/backend/**`
- Generated workspace state: `.webstir/frontend-manifest.json`

## Testing

Favor end-to-end command coverage and provider/package tests over internal-unit archaeology. The active test surfaces live in `orchestrators/bun/tests/**` and the package `tests/**` directories, not in the archived `.NET` harness.

## Related Docs

- Solution overview — [solution](solution.md)
- CLI reference — [cli](../reference/cli.md)
- Workflows — [workflows](../reference/workflows.md)
- Services — [services](services.md)
- Servers — [servers](servers.md)
- Workspace — [workspace](workspace.md)
