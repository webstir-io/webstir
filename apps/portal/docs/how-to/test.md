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

The proof apps in this repo are the reference:

- `bun run webstir -- test --workspace "$PWD/examples/demos/auth-crud"`
- `bun run webstir -- test --workspace "$PWD/examples/demos/dashboard"`

## Related Docs

- [Watch](./watch.md)
- [Publish](./publish.md)
- [Workflows](../reference/workflows.md)
