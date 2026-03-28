# @webstir-io/webstir-testing

Unified test runner, runtime helpers, and CLI for Webstir TypeScript workspaces. Provides the binaries used by the Webstir CLI and the `test` API consumed inside generated specs.

## Status

- Active test host and CLI for Webstir workspaces.
- Scope remains intentionally narrow: event shapes, flags, and discovery rules are optimized for Webstir projects rather than a general-purpose cross-framework runner.

## Quick Start

1. **Install**
   ```bash
   bun add -d @webstir-io/webstir-testing
   ```
2. **Run tests**
   ```bash
   bunx webstir-testing --workspace /absolute/path/to/workspace
   ```

Requires Bun **1.3.11** or newer and assumes TypeScript has already produced compiled output in `build/**/tests/`.

## Workspace Layout

```
workspace/
  src/
    frontend/tests/*.test.ts
    backend/**/tests/*.test.ts
  build/
    frontend/tests/*.test.js
    backend/**/tests/*.test.js
```

Compile with `tsc` (or the workspace build) before invoking the runner; the CLI executes JavaScript from `build/`.

## CLI Commands

Binary aliases: `webstir-testing`, `webstir-testing-runner`, `webstir-testing-add` (legacy aliases: `webstir-test`, `webstir-test-runner`, `webstir-test-add`).

| Command | Description | Notable options |
|---------|-------------|-----------------|
| `webstir-testing` / `webstir-testing test` | Discovers and runs the suite once. | `--workspace <absolute path>` (defaults to `cwd`). |
| `webstir-testing watch` | Watches `src/` and reruns on change. | `--workspace`, `--debounce <ms>` (default 150). |
| `webstir-testing-add <name>` | Scaffolds a sample test file. | `--workspace` to control destination. |

Tips:
- Set `WEBSTIR_TEST_RUNTIME=<frontend|backend|all>` to limit discovery to a single runtime (defaults to `all`). This mirrors the flag exposed through the `.NET` CLI (`webstir test --runtime backend`).

### Event Stream

Runner events emit to `stdout` prefixed with `WEBSTIR_TEST ` followed by JSON. Event types include `start`, `result`, `summary`, `watch-iteration`, `log`, and `error`. Downstream tooling can parse these payloads using `@webstir-io/testing-contract`.

## Runtime & APIs

```ts
import { test, assert } from '@webstir-io/webstir-testing';

test('adds numbers', () => {
  assert.equal(42, add(40, 2));
});
```

- `test(name, fn)` registers sync or async callbacks.
- `assert` exposes `isTrue`, `equal`, and `fail` (throws `AssertionError`).
- `discoverTestManifest(workspace)` builds the manifest consumed by the CLI.
- `createDefaultProviderRegistry()` returns a `ProviderRegistry` with default runtime handlers (`frontend`, `backend`).
- `run(files)` executes compiled modules and returns a `RunnerSummary`.

All exported types align with `@webstir-io/testing-contract`.

## Maintainer Workflow

```bash
bun install
bun run clean          # remove dist artifacts
bun run build          # TypeScript → dist/
bun run test
bun run smoke
# Release helper (bumps version and pushes a package-scoped release tag)
bun run release -- patch
```

- Add integration fixtures under `tests/` before enabling automated suites.
- Ensure CI runs `bun install --frozen-lockfile`, `bun run clean`, `bun run build`, `bun run test`, and `bun run smoke` prior to publishing.
- The release workflow publishes to npm using trusted publishing (`id-token: write` + provenance).

## Troubleshooting

- **“No tests found under src/**/tests/.”** — ensure compiled JavaScript exists in `build/**/tests/`.
- **ESM/CommonJS errors** — the runtime attempts CommonJS first and falls back to dynamic `import()`; misconfigured TypeScript output may still surface syntax errors.
- **Watch mode exits non-zero** — inspect emitted `WEBSTIR_TEST` events for failures.

## Community & Support

- Code of Conduct: https://github.com/webstir-io/.github/blob/main/CODE_OF_CONDUCT.md
- Contributing guidelines: https://github.com/webstir-io/.github/blob/main/CONTRIBUTING.md
- Security policy and disclosure process: https://github.com/webstir-io/.github/blob/main/SECURITY.md
- Support expectations and contact channels: https://github.com/webstir-io/.github/blob/main/SUPPORT.md

## License

MIT © Webstir
