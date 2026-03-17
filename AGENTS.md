# AGENTS.md

Monorepo baseline for Webstir.

## Layout
- `packages/contracts/*`: canonical publishable contract packages.
- `packages/tooling/*`: canonical publishable TypeScript framework/tooling packages.
- `apps/portal`: first-party docs app workspace.
- `examples/demos/*`: example workspaces used to verify framework behavior.
- `orchestrators/dotnet`: the .NET orchestrator, CLI, engine, and embedded framework copies.

## Source Of Truth
- Prefer editing `packages/**` when changing the publishable TypeScript packages.
- Treat `orchestrators/dotnet/**` as a frozen archival tree. Do not sync canonical package changes into it unless the task is explicitly about historical `.NET` maintenance.
- When docs refer to repo paths, prefer the monorepo layout above rather than the legacy single-repo names.

## Code Size
- Prefer keeping code files to about 500 lines or fewer when practical.
- Split large files by responsibility when it improves clarity; do not force file splits that make the code harder to follow.

## Validation
- JS/TS work: use `bun` from the repo root when possible.
- .NET orchestrator work: run `dotnet` commands from the repo root or `orchestrators/dotnet`.
- Prefer package-local validation first, then widen to repo-level checks when the change warrants it.

## Path-Specific Notes
### `packages/tooling/webstir-backend`
- Use `bun run build` for small changes.
- Use `bun run smoke` for scaffold or template changes; use `WEBSTIR_BACKEND_SMOKE_FASTIFY=skip` or `WEBSTIR_BACKEND_SMOKE_FASTIFY_RUN=skip` when you intentionally need lighter Fastify coverage.
- Release prep: `bun run build && bun run smoke && bun run test`.

### `packages/tooling/webstir-frontend`
- Start with `README.md` and the package exports before changing public surfaces.
- Validate with `bun run build`, `bun run test`, and `bun run smoke` as needed.
- The published tarball ships `src/`, `scripts/`, `tests/`, and `tsconfig.json`; keep them publish-ready.
- Use `bun run release -- <patch|minor|major>` for version bumps.

### `orchestrators/dotnet`
- Read `.codex/instructions.md`, `.codex/style.md`, and `.codex/testing.md` before edits.
- Use `./Utilities/scripts/format-build.sh` before handoff.
- Keep diffs minimal and behavior-preserving; prefer repo helpers such as `AppWorkspace` and `Engine.Extensions` for paths and file operations when appropriate.
