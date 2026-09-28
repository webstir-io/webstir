# Build Framework Packages

How the publishable Webstir packages are built and released.

## Current Source Of Truth

- `packages/contracts/**` and `packages/tooling/**` are the canonical publishable packages.
- Releases use [Changesets](https://changesets.dev). A pull request that changes a published package adds a changeset from the repo root with `bun run changeset`, naming the packages and a patch, minor or major bump.
- The four `webstir` packages (module-contract, backend, frontend, CLI) always share one version, as do the two testing packages.
- On `main`, the Release Package workflow keeps a "Version packages" pull request up to date with the version bumps and changelogs, and sets it to merge itself once its CI passes. Merging it publishes every package npm does not have yet, once the Required Gate has passed on that commit, with trusted publishing and provenance; it tags each one and checks that npm serves the new versions.
- If a publish fails, re-run that run's failed jobs before merging anything that adds a changeset; once a new changeset lands, the workflow opens the next Version packages pull request instead.
- The workflow opens that pull request with the `RELEASE_PR_TOKEN` repository secret, a fine-grained token (or GitHub App token) for this repository with Contents and Pull requests read and write. With the workflow's own token, CI would not run on the pull request and it could not merge.
- Bun workspaces consume those packages through normal `package.json` dependencies plus `bun install`.
