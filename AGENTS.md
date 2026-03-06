# AGENTS.md

Monorepo baseline for Webstir.

## Layout
- `packages/contracts/*`: canonical publishable contract packages.
- `packages/tooling/*`: canonical publishable TypeScript framework/tooling packages.
- `apps/*`: first-party apps such as the docs portal and hub.
- `examples/demos/*`: example workspaces used to verify framework behavior.
- `orchestrators/dotnet`: the .NET orchestrator, CLI, engine, and embedded framework copies.

## Source Of Truth
- Prefer editing `packages/**` when changing the publishable TypeScript packages.
- Treat `orchestrators/dotnet/Framework/**` as orchestrator-local copies unless the task explicitly requires updating the embedded framework snapshot there too.
- When docs refer to repo paths, prefer the monorepo layout above rather than the legacy single-repo names.

## Validation
- JS/TS work: use `pnpm` from the repo root when possible.
- .NET orchestrator work: run `dotnet` commands from the repo root or `orchestrators/dotnet`.
- For package-specific constraints, read the nearest nested `AGENTS.md`.
