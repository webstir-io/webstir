# Webstir Monorepo Migration (Archived)

This migration plan is complete and retained only as brief historical context.

## Final State

- Canonical publishable packages live under `packages/contracts/**` and `packages/tooling/**`.
- The Bun orchestrator and CLI live under `orchestrators/bun`.
- The first-party docs app lives under `apps/portal`.
- Demo workspaces live under `examples/demos/**`.
- `orchestrators/dotnet/**` remains in-tree as an archival snapshot, not an active source-of-truth.

## Current Workflow

- Use Bun workspace commands from the repo root.
- Follow the active repo guidance in `README.md` and `AGENTS.md`.
- Treat this file as migration history, not an execution plan.

## Notes

- Published npm package names stayed stable through the migration.
- Historical step-by-step migration details live in git history rather than this working tree.
