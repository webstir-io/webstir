# Synchronize Framework Packages

Webstir packages are kept in sync by releasing them together as one version set.

## Active Package Flow

1. Make canonical changes under `packages/contracts/**` or `packages/tooling/**`.
2. Validate with the relevant Bun package commands.
3. Prepare one synchronized set from the repo root with `bun run release:prepare -- <webstir|testing> <bump>`.
4. Merge the release changes through normal CI, then trigger the Release Package workflow once for that exact commit.
5. Update consuming Bun workspaces through normal `package.json` changes plus `bun install`.
