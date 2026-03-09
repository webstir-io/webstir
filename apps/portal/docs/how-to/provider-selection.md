# Select Module Providers

Webstir can swap module providers without code changes. Use the environment variables below or edit `webstir.providers.json` to override the defaults.

In the Bun-first workflow, provider selection and dependency installation are separate concerns:
- select the provider with `webstir.providers.json` or `WEBSTIR_*_PROVIDER`
- add or update provider dependencies with `bun add` / `bun install`
- run the workflow with `webstir ...`

## Frontend

```bash
WEBSTIR_FRONTEND_PROVIDER=@webstir-io/vite-frontend webstir build
```

- `@webstir-io/webstir-frontend` (default)
- `@webstir-io/vite-frontend` (Vite build pipeline)

Or add a `webstir.providers.json` file to the workspace root:

```json
{
  "frontend": "@webstir-io/vite-frontend"
}
```

> After editing `webstir.providers.json`, make sure the selected provider is present in `package.json`, then run `bun install` if the dependency graph changed.

Quickstart for unpublished builds:

```bash
WEBSTIR_FRONTEND_PROVIDER_SPEC=../webstir-frontend \
webstir watch
```

Set `WEBSTIR_FRONTEND_PROVIDER` alongside the spec when you are testing a non-default frontend provider id.

## Backend

```bash
WEBSTIR_BACKEND_PROVIDER=@webstir-io/webstir-backend webstir publish
```

Backend swaps will pick up any provider published under the module contract.

Quickstart for unpublished builds:

```bash
WEBSTIR_BACKEND_PROVIDER_SPEC=../webstir-backend \
webstir build --runtime backend
```

## Testing

```bash
WEBSTIR_TESTING_PROVIDER=@webstir-io/webstir-testing webstir test
```

- `@webstir-io/webstir-testing` — default VM-based provider published by Webstir.
- `@webstir-io/vitest-testing` — Vitest integration; add it as a workspace dependency (for example, `bun add -d @webstir-io/vitest-testing`) then run `WEBSTIR_TESTING_PROVIDER=@webstir-io/vitest-testing webstir test`.

Or add a `webstir.providers.json` entry:

```json
{
  "testing": "@webstir-io/webstir-testing"
}
```

Quickstart for unpublished builds:

```bash
WEBSTIR_TESTING_PROVIDER_SPEC=../webstir-testing \
webstir test

WEBSTIR_TESTING_PROVIDER=@webstir-io/vitest-testing \
WEBSTIR_TESTING_PROVIDER_SPEC=<path-to-local-vitest-provider> \
webstir test
```

Use `WEBSTIR_*_PROVIDER_SPEC` when you want the workflow to resolve a local provider checkout instead of the published package. Leave the spec empty when consuming the provider from the registry.

## Notes

- Generated workspaces include a `webstir.providers.json` file with defaults—check it into version control to make provider selection explicit.
- The provider must implement `@webstir-io/module-contract` and be installed in the workspace.
- The Bun orchestrator surfaces provider diagnostics in normal CLI output.
- Future work will add config-driven selection (`webstir.config.ts`).
