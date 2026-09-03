# Build Framework Packages

This page is retained for historical context only.

> Archival scope: `orchestrators/dotnet/Framework/**` is a frozen snapshot. Active Webstir package development, releases, and dependency management do not sync into that tree.

## Current Source Of Truth

- `packages/contracts/**` and `packages/tooling/**` are the canonical publishable packages.
- Prepare a production release from the repo root with `bun run release:prepare -- webstir <patch|minor|major|x.y.z>`; use `testing` instead of `webstir` for the testing package pair.
- After the release PR merges and its exact `main` commit passes CI, push the printed `release-set/<group>/v<version>` tag or dispatch the Release Package workflow with that group and version.
- One workflow builds the dependency graph once, publishes the synchronized set in dependency order, and verifies registry metadata, provenance, `gitHead`, and a clean installation.
- Bun workspaces consume those packages through normal `package.json` dependencies plus `bun install`.

## Archived .NET Tree

- `orchestrators/dotnet/Framework/**` is kept only as a historical reference.
- Do not run package sync, version sync, or embedded snapshot refresh steps as part of normal Webstir work.
- If you need to study historical `.NET` behavior, inspect that tree directly or use older commits and docs from the archived orchestrator workflow.
