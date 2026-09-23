# Build Framework Packages

How the publishable Webstir packages are built and released.

## Current Source Of Truth

- `packages/contracts/**` and `packages/tooling/**` are the canonical publishable packages.
- Prepare a production release from the repo root with `bun run release:prepare -- webstir <patch|minor|major|x.y.z>`; use `testing` instead of `webstir` for the testing package pair.
- After the release PR merges and its exact `main` commit passes CI, push the printed `release-set/<group>/v<version>` tag or dispatch the Release Package workflow with that group and version.
- One workflow builds the dependency graph once, publishes the synchronized set in dependency order, and verifies registry metadata, provenance, `gitHead`, and a clean installation.
- Bun workspaces consume those packages through normal `package.json` dependencies plus `bun install`.
