# Changesets

Each pull request that changes a published package adds a changeset: `bun run changeset`, then pick
the packages and the bump. The two release groups (the four `webstir` packages, and the testing
pair) always version together. On `main`, the release workflow keeps a "Version packages" pull
request up to date; merging it publishes to npm.
