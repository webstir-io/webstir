# Select Module Providers

Webstir can swap module providers without code changes. Use the environment variables below or edit `webstir.providers.json` to override the defaults.

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

> After editing `webstir.providers.json`, run `webstir install` to ensure the provider dependency is installed.

Quickstart for unpublished builds:

```bash
WEBSTIR_FRONTEND_PROVIDER_SPEC=../webstir-frontend \
webstir watch
```

Set `WEBSTIR_FRONTEND_PROVIDER` alongside the spec when you are testing a non-default frontend provider.

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
- `@webstir-io/vitest-testing` — Vitest integration; add it with your package manager (for example, `pnpm add -D @webstir-io/vitest-testing`) then run `WEBSTIR_TESTING_PROVIDER=@webstir-io/vitest-testing webstir test`.

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

The host installs providers from `WEBSTIR_TESTING_PROVIDER_SPEC` when set; leave it empty when consuming from the registry. When `WEBSTIR_TESTING_PROVIDER` points at a non-default provider, the spec installs that provider; otherwise it overrides the default testing package.

## Notes

- Generated workspaces include a `webstir.providers.json` file with defaults—check it into version control to make provider selection explicit.
- The provider must implement `@webstir-io/module-contract` and be installed in the workspace.
- The module-host bridge proxies all output via the `.NET` host; log entries include provider id, entry points, and diagnostics.
- Future work will add config-driven selection (`webstir.config.ts`).
