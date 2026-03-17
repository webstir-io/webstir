# Utilities

Repo-level utility commands for the active Bun/TypeScript monorepo.

The current monorepo does not use the older `utilities/` .NET helper scripts as part of the supported workflow. Start from Bun commands at the repo root instead.

## Common Commands

### Build the whole active workspace set

```bash
bun run build
```

### Run tests across workspaces

```bash
bun run test
```

### Run smoke checks where configured

```bash
bun run smoke
```

### Build only the portal docs

```bash
bun run --filter webstir-portal build
```

### Inspect the Bun CLI surface

```bash
bun run webstir -- --help
```

## Package-Local Validation

- Frontend package: `bun run --filter @webstir-io/webstir-frontend build|test`
- Backend package: `bun run --filter @webstir-io/webstir-backend build|test|smoke`
- Bun orchestrator: `bun run --filter @webstir-io/webstir test`

## Notes

- Run commands from the repo root unless a package README says otherwise.
- The archived `.NET` tree has its own historical tooling, but it is not part of the active Bun workflow.

## Related Docs

- Solution overview — [solution](../explanations/solution.md)
- CLI reference — [cli](../reference/cli.md)
- Testing — [testing](../explanations/testing.md)
