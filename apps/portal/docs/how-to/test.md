# Test

Run workspace tests through the active Bun orchestrator.

## Command

```bash
webstir test --workspace /absolute/path/to/workspace
```

Optional scope filter:

```bash
webstir test --workspace /absolute/path/to/workspace --runtime backend
```

## What It Does

1. Builds the requested runtime surfaces.
2. Discovers tests under `src/**/tests`.
3. Compiles them into `build/**`.
4. Executes the suites through the configured testing provider.

## What To Cover

For HTML-first apps, prioritize:

- document routes
- redirect-after-post flows
- fragment response metadata and payload shape
- session/auth state persistence across reloads
- publish-mode behavior for the same flows

The canonical repo reference for `webstir test` is the full demo:

- `bun run webstir -- test --workspace "$PWD/examples/demos/full"`
- `bun run webstir -- test --workspace "$PWD/examples/demos/full" --runtime backend`

`auth-crud` and `dashboard` remain the browser proof apps for richer consumer-path validation: publish-mode browser coverage in the required gate, plus the manual `Watch Browser Tests` workflow for watch-mode verification. Their app-local tests are reference coverage, not the canonical required `webstir test` path.

## Related Docs

- [Watch](./watch.md)
- [Publish](./publish.md)
- [Workflows](../reference/workflows.md)
