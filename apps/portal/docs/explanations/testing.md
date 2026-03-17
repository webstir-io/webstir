# Testing

How the active Bun monorepo tests the CLI, provider packages, and proof apps.

## Overview

- Goal: protect the developer-facing contract, not maximize line coverage.
- Focus: CLI behavior, generated workspaces, watch/runtime behavior, and publish outputs.
- Primary surfaces: `orchestrators/bun/tests/**` plus package-local `tests/**`.
- Default gate: deterministic package checks, orchestrator contract/integration tests, and publish-mode browser proofs.
- Extended gate: watch-mode browser proofs run as a separate lane because they exercise the noisiest infrastructure path.

## What We Test

- CLI workflows: `init`, `build`, `watch`, `test`, `publish`, `smoke`, and generators
- Contracts: folder layout, emitted artifacts, exit codes, and manifest summaries
- Watch behavior: HMR, reloads, backend restarts, and `/api/*` proxying
- Proof apps: `auth-crud` and `dashboard` as consumer-path validation
- Package behavior inside `@webstir-io/webstir-frontend`, `@webstir-io/webstir-backend`, and `@webstir-io/webstir-testing`

## Test Types

- Orchestrator integration tests under `orchestrators/bun/tests/**/*.ts`
- Package tests under `packages/tooling/*/tests/**/*.test.js`
- Browser publish proofs in the default Bun orchestrator gate
- Browser watch proofs in an isolated extended lane
- Smoke scripts where a package exposes `bun run smoke`

## Running Tests

- Repo-wide active workspaces: `bun run test`
- Repo-wide exhaustive suite: `bun run test:all`
- Isolated watch-browser lane: `bun run test:watch-browser`
- Repo required CI mirror: `bun run check:required`
- Repo required CI mirror plus isolated watch proofs: `bun run check:all`
- Bun orchestrator only: `bun run --filter @webstir-io/webstir test`
- Bun orchestrator exhaustive suite: `bun run --filter @webstir-io/webstir test:all`
- Bun orchestrator watch-browser lane: `bun run --filter @webstir-io/webstir test:browser:watch`
- Frontend package: `bun run --filter @webstir-io/webstir-frontend test`
- Backend package: `bun run --filter @webstir-io/webstir-backend test`
- Generated workspace tests: `webstir test --workspace /absolute/path/to/workspace`

## How `webstir test` Works

1. Rebuild the required workspace surfaces.
2. Discover tests under `src/**/tests`.
3. Compile them into `build/**`.
4. Run the compiled suites through the canonical testing provider.

Only `webstir test` supports `--runtime <frontend|backend|all>`.

## What We Avoid

- Treating archived `.NET` harnesses as the current source of truth
- Documenting unsupported flags or workflows as if they were active
- Locking tests to private implementation details when a contract-level assertion is enough

## Reliability Notes

- Integration tests use isolated temp workspaces and copied fixtures.
- Watch tests prefer explicit readiness and port checks over long sleeps.
- Browser flows focus on shipped proof apps so regressions surface on real consumer paths.
- PR and `main` should run the same required gate; extended watch-browser proofs are a separate lane, not a hidden substitute.
- GitHub `CI` runs `bun run check:required`; `Extended CI` owns `bun run check:all` on a separate schedule/workflow.

## Related Docs

- CLI reference — [cli](../reference/cli.md)
- Workflows — [workflows](../reference/workflows.md)
- Watch — [watch](../how-to/watch.md)
- Test — [test](../how-to/test.md)
