# Testing

How the active Bun monorepo tests the CLI, provider packages, and proof apps.

## Overview

- Goal: protect the developer-facing contract, not maximize line coverage.
- Focus: CLI behavior, generated workspaces, watch/runtime behavior, and publish outputs.
- Primary surfaces: `orchestrators/bun/tests/**` plus package-local `tests/**`.
- Default gate: deterministic package checks, orchestrator contract/integration tests, and publish-mode browser proofs.
- Separate watch browser tests cover the noisiest infrastructure path without expanding the required gate.

## What We Test

- CLI workflows: `init`, `build`, `watch`, `test`, `publish`, `smoke`, and generators
- Contracts: folder layout, emitted artifacts, exit codes, and manifest summaries
- Watch behavior: HMR, reloads, backend restarts, and `/api/*` proxying
- Canonical `webstir test` proof workspace: `full`
- Proof apps: `auth-crud` and `dashboard` as consumer-path browser validation and publish proofs, including the manual `Watch Browser Tests` workflow, not separate required `webstir test` lanes
- Package behavior inside `@webstir-io/webstir-frontend`, `@webstir-io/webstir-backend`, and `@webstir-io/webstir-testing`

## Test Types

- Orchestrator integration tests under `orchestrators/bun/tests/**/*.ts`
- Package tests under `packages/tooling/*/tests/**/*.test.js`
- Browser publish proofs in the default Bun orchestrator gate
- Browser watch proofs in a separate watch browser test workflow
- Smoke scripts where a package exposes `bun run smoke`

## Running Tests

- Repo-wide active workspaces: `bun run test`
- Repo-wide required tests plus watch browser tests: `bun run test:with-watch-browser`
- Watch browser tests: `bun run test:watch-browser`
- Repo required CI mirror: `bun run check:required`
- Repo required CI mirror plus watch browser tests: `bun run check:with-watch-browser`
- Bun orchestrator only: `bun run --filter @webstir-io/webstir test`
- Bun orchestrator required tests plus watch browser tests: `bun run --filter @webstir-io/webstir test:with-watch-browser`
- Bun orchestrator watch-browser tests: `bun run --filter @webstir-io/webstir test:browser:watch`
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

In this repo, `examples/demos/full` is the canonical workspace for the `webstir test` flow. `auth-crud` and `dashboard` belong to the browser-proof layer instead: publish-mode browser coverage in the required gate, plus the manual `Watch Browser Tests` workflow when watch-mode confidence matters. Any app-local tests inside those demos should be treated as reference coverage rather than a separate required gate.

## What We Avoid

- Treating archived `.NET` harnesses as the current source of truth
- Documenting unsupported flags or workflows as if they were active
- Locking tests to private implementation details when a contract-level assertion is enough

## Reliability Notes

- Integration tests use isolated temp workspaces and copied fixtures.
- Watch tests prefer explicit readiness and port checks over long sleeps.
- Browser flows focus on shipped proof apps so regressions surface on real consumer paths.
- PR and `main` should run the same required gate; watch browser proofs stay outside that gate and are not a hidden substitute.
- GitHub `CI` runs `bun run check:required`; the `Watch Browser Tests` workflow is manual and runs `bun run test:watch-browser` on demand.

## Related Docs

- CLI reference — [cli](../reference/cli.md)
- Workflows — [workflows](../reference/workflows.md)
- Watch — [watch](../how-to/watch.md)
- Test — [test](../how-to/test.md)
