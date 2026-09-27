# Synchronize Framework Packages

Webstir packages are kept in sync by releasing them together as one version set.

## Active Package Flow

1. Make canonical changes under `packages/contracts/**` or `packages/tooling/**`.
2. Validate with the relevant Bun package commands.
3. Add a changeset from the repo root with `bun run changeset`; each release group versions as one set.
4. Merge through normal CI. Merging the "Version packages" pull request that follows publishes the set.
5. Update consuming Bun workspaces through normal `package.json` changes plus `bun install`.
