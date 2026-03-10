# Build Framework Packages

This page is retained for historical context only.

> Archival scope: `orchestrators/dotnet/Framework/**` is a frozen snapshot. Active Webstir package development, releases, and dependency management do not sync into that tree.

## Current Source Of Truth

- `packages/contracts/**` and `packages/tooling/**` are the canonical publishable packages.
- Release from the canonical package directories with `bun run release -- <patch|minor|major|x.y.z>` or the Release Package GitHub workflow.
- Bun workspaces consume those packages through normal `package.json` dependencies plus `bun install`.

## Archived .NET Tree

- `orchestrators/dotnet/Framework/**` is kept only as a historical reference.
- Do not run package sync, version sync, or embedded snapshot refresh steps as part of normal Webstir work.
- If you need to study historical `.NET` behavior, inspect that tree directly or use older commits and docs from the archived orchestrator workflow.
