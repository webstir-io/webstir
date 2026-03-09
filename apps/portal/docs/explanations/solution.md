# Solution

Hub for the CLI and host tooling. This doc explains what the solution is, how it’s organized, the technology choices, and how the app works at a high level.

> Active path: the Bun orchestrator in `orchestrators/bun`. Historical `.NET` material remains in-tree for reference only.

## What It Is
- Opinionated Bun-first build tool and project scaffolder.
- Full-stack by default: frontend (HTML/CSS/TS) plus a Node-compatible backend runtime.
- Single CLI surface drives workflows: init, refresh, enable, build, watch, test, publish, smoke, and generators.
- Framework behavior lives in canonical TypeScript packages under `packages/**`; the Bun orchestrator composes them instead of duplicating them.

## Organization
- [CLI](../reference/cli.md): active Bun command reference.
- [Engine](engine.md): historical `.NET` engine internals retained for reference.
- [Templates](../reference/templates.md): workspace shape and generated project structure.
- [Tests](testing.md): behavior-level testing guidance across the solution.

## Technology
- Language/Runtime: Bun for orchestration, TypeScript for framework and generated workspace code.
- Dev server: Bun serves frontend output and handles reload/proxy behavior for local development.
- API runtime: Bun supervises the built backend process and proxies `/api/*` in full-stack watch mode.
- Build system: canonical frontend/backend/testing packages under `packages/tooling/**`.

## How It Works
1. Init
   - `webstir init` scaffolds a `spa`, `ssg`, `api`, or `full` workspace.
2. Build
   - `webstir build` composes the canonical provider packages to emit `build/**`.
3. Watch
   - `webstir watch` runs the Bun dev loop for frontend-only, backend-only, or full-stack workspaces.
4. Test
   - `webstir test` builds the relevant targets, compiles discovered tests, and executes them through the canonical testing providers.
5. Publish
   - `webstir publish` writes publish artifacts to `dist/**`.
6. Inspect and smoke
   - `webstir backend-inspect` prints backend manifest data.
   - `webstir smoke` runs a bounded end-to-end verification flow across build, test, publish, and backend inspect.
7. Generators and mutators
   - `webstir add-page`, `add-test`, `add-route`, `add-job`, `enable`, and `refresh` mutate workspaces directly from the Bun orchestrator.

## Conventions & Structure
 - Base HTML: `src/frontend/app/app.html` must contain a `<main>`; page fragments merge into it.
 - Pages: `src/frontend/pages/<page>/index.html|css|ts` (publish supports `<page>/index.module.css`).
 - App assets: `src/frontend/app/*` copied as-is (e.g., `refresh.js`).
 - Shared types: `src/shared/` (consumed by both frontend and backend).
 - Backend: `src/backend/index.ts` compiled to `build/backend/index.js` and run by Node.
- Outputs:
   - Dev: `build/frontend/**`, `build/backend/**` with readable output and refresh support.
   - Prod: `dist/frontend/pages/<page>/index.<timestamp>.{css|js}`, HTML with rewritten links, per-page `manifest.json`.

## CLI Summary
- `init`
- `refresh`
- `enable`
- `build`
- `publish`
- `watch`
- `test`
- `smoke`
- `backend-inspect`
- `add-page`
- `add-test`
- `add-route`
- `add-job`

See also: [CLI reference](../reference/cli.md)

## Related Docs
- Docs index — [overview](../README.md)
- Templates — [templates](../reference/templates.md)
- Testing — [tests](testing.md)
- Workspace & paths — [workspace](workspace.md)
- CLI reference — [cli reference](../reference/cli.md)

## Scope & Non-Goals
- Keep defaults simple and predictable; prefer conventions over configuration.
- Avoid complex plugin systems and heavy third-party build chains.
- Focus on end-to-end workflows (init → build → watch/test → publish).
