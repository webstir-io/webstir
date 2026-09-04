# Testing

How the active Bun monorepo tests the CLI, provider packages, and proof apps.

## Overview

- Goal: protect the developer-facing contract, not maximize line coverage.
- Focus: CLI behavior, generated workspaces, watch/runtime behavior, and publish outputs.
- Primary surfaces: `orchestrators/bun/tests/**` plus package-local `tests/**`.
- Default gate: deterministic source checks, one framework package-graph build, package tests and meaningful smoke checks against that output, orchestrator contract/integration tests, browser proofs, one packed npm install, and the portal build.
- Orchestrator core and browser files run in separate two-worker pools. Each file remains isolated and tests within a file remain sequential.

## What We Test

- CLI workflows: `init`, `build`, `watch`, `test`, `publish`, `smoke`, and generators
- Contracts: folder layout, emitted artifacts, exit codes, and manifest summaries
- Watch behavior: HMR, reloads, backend restarts, and `/api/*` proxying
- Canonical `webstir test` proof workspace: `full`, kept near the built-in `full` template except for explicit watch/runtime proof deltas
- Proof apps: `auth-crud` and `dashboard` as consumer-path browser validation for both publish and watch behavior, not separate required `webstir test` lanes
- Package behavior inside `@webstir-io/webstir-frontend`, `@webstir-io/webstir-backend`, and `@webstir-io/webstir-testing`

## Test Types

- Orchestrator integration tests under `orchestrators/bun/tests/**/*.ts`
- Package tests under `packages/tooling/*/tests/**/*.test.js`
- Meaningful package smoke scripts for backend scaffolding and the testing provider
- Browser publish proofs in the default Bun orchestrator gate
- Browser watch proofs in the default Bun orchestrator gate

## Running Tests

- Full required gate: `bun run test` or `bun run check:required`
- Repo-wide formatting baseline: `bun run format`
- Repo-wide formatting check: `bun run check:biome`
- Repo-wide lint sweep: `bun run lint`
- Bun orchestrator only: `bun run --filter @webstir-io/webstir test`
- Bun orchestrator core tests: `bun run --filter @webstir-io/webstir test:core`
- Bun orchestrator browser tests: `bun run --filter @webstir-io/webstir test:browser`
- Frontend package: `bun run --filter @webstir-io/webstir-frontend test`
- Backend package: `bun run --filter @webstir-io/webstir-backend test`
- Generated workspace tests: `webstir test --workspace /absolute/path/to/workspace`
- Canonical repo example: `bun run webstir -- test --workspace "$PWD/examples/demos/full"`

## How `webstir test` Works

1. Rebuild the required workspace surfaces.
2. Discover tests under `src/**/tests`.
3. Compile them into `build/**`.
4. Run the compiled suites through the canonical testing provider.

Only `webstir test` supports `--runtime <frontend|backend|all>`.

In this repo, `examples/demos/full` is the canonical workspace for the `webstir test` flow. It stays aligned with `orchestrators/bun/resources/templates/full/src/**` outside a small set of proof-only watch/runtime files, and `bun run --filter @webstir-io/webstir check:full-demo-sync` enforces that boundary. `auth-crud` and `dashboard` belong to the browser-proof layer instead: publish-mode and watch-mode browser coverage live in the required gate. Any app-local tests inside those demos should be treated as reference coverage rather than a separate required gate.

## What We Avoid

- Treating archived `.NET` harnesses as the current source of truth
- Documenting unsupported flags or workflows as if they were active
- Locking tests to private implementation details when a contract-level assertion is enough

## Reliability Notes

- Integration tests use isolated temp workspaces and copied fixtures.
- Watch tests prefer explicit readiness and port checks over long sleeps.
- Browser flows focus on shipped proof apps so regressions surface on real consumer paths.
- PR and `main` run the same required gate. Package-local `test` and `smoke` commands still build first for focused use; the repo gate uses their `:built` forms after one shared graph build.
- GitHub `CI` runs `bun run check:required`. The separate dependency audit runs only for lockfile pull requests, on demand, and weekly; transport failures are retried while vulnerability findings fail immediately.

## Related Docs

- CLI reference — [cli](../reference/cli.md)
- Workflows — [workflows](../reference/workflows.md)
- Watch — [watch](../how-to/watch.md)
- Test — [test](../how-to/test.md)
