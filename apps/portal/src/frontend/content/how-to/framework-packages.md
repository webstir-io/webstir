# Build Framework Packages

How the publishable Webstir packages are built and released.

## Current Source Of Truth

- `packages/contracts/**` and `packages/tooling/**` are the canonical publishable packages.
- Releases use [Changesets](https://changesets.dev). A pull request that changes a published package adds a changeset from the repo root with `bun run changeset`, naming the packages and a patch, minor or major bump.
- The four `webstir` packages (module-contract, backend, frontend, CLI) always share one version, as do the two testing packages.
- On `main`, the Release Package workflow keeps a "Version packages" pull request up to date with the version bumps and changelogs. Merging it publishes every package npm does not have yet, with trusted publishing and provenance, tags each one, and checks that npm serves the new versions.
- Bun workspaces consume those packages through normal `package.json` dependencies plus `bun install`.
