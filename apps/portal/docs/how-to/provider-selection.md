# Select Module Providers

The current Bun orchestrator does not expose custom provider selection through `webstir.providers.json` or `WEBSTIR_*_PROVIDER` environment variables.

Today, `webstir` loads the canonical packages directly:

- frontend: `@webstir-io/webstir-frontend`
- backend: `@webstir-io/webstir-backend`
- testing: `@webstir-io/webstir-testing`

## What Works Today

- Develop the canonical providers in this monorepo with `bun run --filter <package> build|test|smoke`.
- Use the package CLIs directly when you need package-level behavior:
  - `npx webstir-frontend ...`
  - `npx webstir-testing ...`
- Pack or link the Bun orchestrator from [`orchestrators/bun`](https://github.com/webstir-io/webstir/tree/main/orchestrators/bun) for external-workspace checks.

## What Is Not Active

- `webstir.providers.json`
- `WEBSTIR_FRONTEND_PROVIDER`
- `WEBSTIR_BACKEND_PROVIDER`
- `WEBSTIR_TESTING_PROVIDER`
- local `*_PROVIDER_SPEC` overrides

Older docs and experiments referenced those surfaces, but they are not part of the live Bun CLI contract.

## Related Docs

- CLI reference — [cli](../reference/cli.md)
- Utilities — [utilities](./utilities.md)
- Product plans — [product plans](../product/plans/README.md)
