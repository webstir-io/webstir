# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands

```bash
# Install dependencies
bun install

# Build & test all workspaces
bun run build
bun run test

# Filter to a specific package
bun run --filter @webstir-io/webstir-backend build
bun run --filter @webstir-io/webstir-backend test

# Smoke tests (scaffold/template validation)
bun run --filter @webstir-io/webstir-backend smoke
# Lighter Fastify coverage: WEBSTIR_BACKEND_SMOKE_FASTIFY=skip bun run --filter @webstir-io/webstir-backend smoke

# Contracts only
bun run build:contracts
bun run test:contracts

# Bun orchestrator tests (uses Bun test runner + Playwright)
bun run --filter @webstir-io/webstir test

# Run a single backend test (Node test runner, operates on built JS)
node --test packages/tooling/webstir-backend/dist/tests/add.test.js

# Run a single Bun orchestrator test
bun test ./tests/init.integration.test.ts

# Watch a demo workspace for local dev
bun run watch:full    # fullstack demo
bun run watch:spa     # SPA demo
bun run watch:ssg     # SSG demo

# CLI entry point
bun run webstir -- init ssg ./my-site
```

## Architecture

**Monorepo** using Bun workspaces. TypeScript 5.7 (ES2022, NodeNext modules, strict mode). ESM-only throughout.

### Packages

- **`packages/contracts/module-contract`** — Zod schemas and TypeScript types defining the `ModuleProvider` interface (resolveWorkspace, build, getScaffoldAssets). All tooling packages depend on this.
- **`packages/contracts/testing-contract`** — Contract for the testing framework.
- **`packages/tooling/webstir-backend`** — Backend provider: TypeScript compilation via esbuild, Fastify 5 routing, session management, scaffold templates. Tests use Node's built-in `node --test` with `node:assert/strict`.
- **`packages/tooling/webstir-frontend`** — Frontend provider: SSG/SPA/SSR modes, markdown processing, image optimization (sharp), HTML minification. Same test setup as backend.
- **`packages/tooling/webstir-testing`** — Testing runner and CLI.
- **`orchestrators/bun`** — Primary CLI that bundles everything for end-user consumption. Tests use Bun's test runner with Playwright for browser automation.

### Apps & Demos

- **`apps/portal`** — Docusaurus 3 documentation site, deployed to GitHub Pages.
- **`examples/demos/*`** — Validation workspaces (spa, api, full, auth-crud, dashboard, ssg) that verify framework behavior against local package changes.

### Key Patterns

- **ModuleProvider interface**: Central abstraction — each provider implements `resolveWorkspace()`, `build()`, and `getScaffoldAssets()`.
- **Hardened path resolution**: Env vars (`WORKSPACE_ROOT`, `WEBSTIR_WORKSPACE_ROOT`) or inference from `import.meta.url`. Several recent commits harden this.
- **Contract-first**: Contracts are minimal with no heavy dependencies; tooling packages implement them. Edit contracts before tooling when changing interfaces.
- **Build outputs**: Backend and frontend both use esbuild. Output goes to `build/` directories with manifests and diagnostics.

## Source of Truth

- Edit `packages/**` for publishable TypeScript packages.
- `orchestrators/dotnet` is a frozen archival tree — do not modify unless the task explicitly involves .NET maintenance.
- Prefer package-local validation first (`bun run --filter <pkg> build && test`), then widen to repo-level checks.

## Conventions

- Keep code files ~500 lines or fewer; split by responsibility when it improves clarity.
- Backend/frontend tooling: build before testing (tests run against `dist/`).
- Release prep for tooling packages: `bun run build && bun run smoke && bun run test`.
- Frontend tarball ships `src/`, `scripts/`, `tests/`, and `tsconfig.json` — keep them publish-ready.

## CI

CI runs a required repo gate plus a separate portal build when portal-specific inputs change. Extended browser/watch coverage runs in its own workflow. Release publishing is triggered by `release/**` tags with npm provenance.
