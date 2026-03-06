# Webstir Backend – Repo Guidance (Agents)

## Scope & Priorities
- Package: `@webstir-io/webstir-backend`
- Purpose: backend module provider (tsc + esbuild + manifest hydration + scaffolds).
- Optimize for: correctness of build/watch flows, smoke reliability, lean diffs.

## Daily Workflow
- Read the repo root `AGENTS.md` first; rules here extend it for this package.
- Default Node version: >= 20.18.x (matches package `engines` field).
- Prefer TypeScript ESM; follow existing formatting (no trailing semicolons).
- Use `bun run build` before committing TypeScript changes.
- Use `bun run smoke` for high-confidence validation (skips tsc when PATH cleared).
- Fastify scaffold smoke can be skipped via env:
  - `WEBSTIR_BACKEND_SMOKE_FASTIFY=skip` — skip install/type-check/run.
  - `WEBSTIR_BACKEND_SMOKE_FASTIFY_RUN=skip` — compile only, skip running health check.

## Key Scripts
- `bun run build` — TypeScript compile to `dist/`.
- `bun run test` — runs Node test runner for backend tests (rarely used; keep green).
- `bun run smoke` — exercises scaffold provisioning + build/publish + Fastify health check.
- `bun run release` / `scripts/publish.sh` — bump version, run build/test/smoke, and create a package-scoped release tag that the monorepo workflow publishes.

## Release Notes
- Ensure clean git tree and passing build/smoke before running `scripts/publish.sh`.
- Run `bun run sync:framework-embedded` after canonical package manifest changes when you are not using the release helper; `scripts/publish.sh` does this automatically for its target package.
- Publish script intentionally does not call `npm publish`; GitHub Actions publishes from the package-scoped release tag.
- After publishing, sync versions via `orchestrators/dotnet/Utilities/scripts/sync-framework-versions.sh`.
- Published tarball now includes `src/`, `scripts/`, `tests/`, and `tsconfig.json`; keep them build-ready since downstream repos rebuild straight from the package.

## Implementation Hints
- Provider build flow: tsc (optional via `WEBSTIR_BACKEND_TYPECHECK=skip`), discover entry points, esbuild transpile/bundle, manifest hydration.
- Incremental builds use esbuild `context()`; reuse only applies when `incremental: true` and mode != publish.
- Scaffold assets live under `templates/backend/**`; update tests/smoke if templates change.
- Diagnostics returned to orchestrator are filtered by `WEBSTIR_BACKEND_LOG_LEVEL=info|warn|error`.

## Validation Ladder (repo-specific)
- Small change: `bun run build`.
- Scaffold/template changes: `bun run smoke` (use env toggles if needed).
- Release prep: `bun run build && bun run smoke && bun run test`.

## Docs & References
- README: usage, manifest integration, Fastify scaffold instructions.
- Publish script: `scripts/publish.sh` (check when updating release flow).
- Smoke script: `scripts/smoke.mjs` (includes Fastify toggles and checks).
