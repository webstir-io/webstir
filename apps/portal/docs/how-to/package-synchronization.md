# Synchronize Framework Packages

This workflow has been retired for the active Webstir monorepo.

> Archival scope: the `.NET` framework copies under `orchestrators/dotnet/Framework/**` are frozen historical artifacts and are no longer synchronized from `packages/**`.

## Active Package Flow

1. Make canonical changes under `packages/contracts/**` or `packages/tooling/**`.
2. Validate with the relevant Bun package commands.
3. Release from the canonical package directory or the Release Package GitHub workflow.
4. Update consuming Bun workspaces through normal `package.json` changes plus `bun install`.

## Historical .NET Snapshot

- The archived `.NET` tree remains in-repo for reference only.
- There is no active `sync-framework-embedded` step in the Bun monorepo anymore.
- Historical `.NET` metadata such as `framework-packages.json` and `Engine/Resources/package.json` is no longer part of the active release path.
