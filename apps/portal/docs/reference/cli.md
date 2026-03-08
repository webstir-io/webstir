# CLI

Detailed reference for the `webstir` CLI. This expands the high-level overview in [solution.md](../explanations/solution.md) and focuses on concrete behavior, options, and outputs.

> Historical note: this page documents the archived `.NET` orchestrator CLI. For active local workflows in this repo, use the Bun orchestrator under `orchestrators/bun`.

## Overview
- Single entrypoint: `webstir <command> [options]`.
- Default command is `watch` when no command is provided.
- Works from the project root created by `init`.
- Orchestrates builds, the dev web server, the Node API server, and generators.

## Usage

```
webstir <command> [options]
webstir help [command]
```

Common patterns:
- `webstir init my-app`
- `webstir init ssg docs`
- `webstir build --clean`
- `webstir enable search`
- `webstir watch`
- `webstir test`
- `webstir install`
- `webstir publish`
- `webstir repair --dry-run`
- `webstir add-page about`
- `webstir add-test auth/login`
- `webstir add-route users`
- `webstir add-job cleanup`
- `webstir backend-inspect`
- `webstir smoke`

## Commands

### init
Usage: `webstir init [--project|-p <name>] <mode> <directory> | <directory>`

What it does:
- Creates a new project from embedded templates (frontend, backend, shared, and types).
- Layout includes `src/frontend/app`, `src/frontend/pages/<page>`, `src/backend`, `src/shared`, and `types/`.
- Initializes a working dev setup that builds and runs with `webstir watch`.

Notes:
- Mode is one of `full` (default), `ssg`, `spa`, or `api`.

### repair
Usage: `webstir repair [--dry-run] [path]`

What it does:
- Restores missing scaffold files for the current workspace mode without overwriting existing files.
- Uses the embedded mode templates plus any enabled feature scaffolds (for example `webstir.enable.spa` or `webstir.enable.clientNav`).

Notes:
- Use `--dry-run` to print the exact list of files that would be restored.
- Use this when a command reports a missing scaffold directory (instead of silently regenerating files).

### build
Usage: `webstir build [--clean]`

What it does:
- Compiles TypeScript via `tsc --build` using the embedded base config.
- Processes CSS imports; copies app assets.
- Merges page HTML fragments with `src/frontend/app/app.html` and writes to `build/frontend/`.
- Compiles backend code to `build/backend/`.

Notes:
- `--clean` removes previous `build/` before compiling.
- `--runtime <frontend|backend|all>` (or `-r`) runs only the selected workers. By default the CLI inspects `src/frontend` / `src/backend` and builds everything that exists.

### watch (default)
Usage: `webstir watch`

What it does:
- Runs an initial `build` and `test` (delegating test execution to the Webstir test host).
- Starts the dev web server (serves `build/frontend/**`) and the Node API server (runs `build/backend/index.js`).
- Watches `src/**` for changes and performs targeted, incremental rebuilds.
- Restarts the Node server on backend changes; notifies browsers via SSE to reload on frontend changes.
- Stops early with an actionable message if framework packages drift, pointing to `webstir install`.

Node server readiness and health
- Waits for the `API server running` line on startup and then probes `/api/health` before declaring ready.
- Tuning flags (environment variables):
  - `WEBSTIR_BACKEND_WAIT_FOR_READY=skip` — skip waiting for the readiness log line
  - `WEBSTIR_BACKEND_READY_TIMEOUT_SECONDS` — readiness wait timeout (default 30)
  - `WEBSTIR_BACKEND_HEALTHCHECK=skip` — skip the health probe entirely
  - `WEBSTIR_BACKEND_HEALTH_TIMEOUT_SECONDS` — per-attempt probe timeout (default 5)
  - `WEBSTIR_BACKEND_HEALTH_ATTEMPTS` — retries before failing (default 5)
  - `WEBSTIR_BACKEND_HEALTH_DELAY_MILLISECONDS` — delay between retries (default 250)
  - `WEBSTIR_BACKEND_HEALTH_PATH` — override the probe path (default `/api/health`)
- Automatically detects whether frontend and/or backend directories exist and only enables the relevant workers. Override with `--runtime <frontend|backend|all>` or `WEBSTIR_TEST_RUNTIME` when you need to force a mode (e.g., backend-only loops in a full-stack workspace).
- Pass `--runtime <frontend|backend|all>` (or `-r`) to limit the tests triggered during watch to a single runtime. The CLI forwards the same value via `WEBSTIR_TEST_RUNTIME`, so scripting the behavior is as simple as `WEBSTIR_TEST_RUNTIME=backend webstir watch`.

### test
Usage: `webstir test`

- Builds the project, ensures the configured test provider is installed (defaults to `@webstir-io/webstir-testing`, overridable via `WEBSTIR_TESTING_PROVIDER` or `webstir.providers.json`), then invokes the Webstir test host.
- Executes compiled frontend and backend tests, emitting structured events the .NET bridge relays.
- Prints a pass/fail summary; integrates with CI using standard exit codes.
- Fails fast if recorded package versions drift and directs you to `webstir install`.
- Automatically skips frontend or backend phases when the workspace lacks those directories. Use `--runtime <frontend|backend|all>` (or `-r`) / `WEBSTIR_TEST_RUNTIME` to force a specific scope.

Notes:
- Override the provider with `WEBSTIR_TESTING_PROVIDER=<package>`; set `WEBSTIR_TESTING_PROVIDER_SPEC` if you are testing an unpublished build or local checkout.
- Add or edit `webstir.providers.json` in the workspace root to persist provider choices alongside your code.
- Provider overrides apply across the manifest run; mixed providers per module are not supported.
- Use `--runtime <frontend|backend|all>` (or `-r`) to override the automatic detection. The same behavior is available via `WEBSTIR_TEST_RUNTIME=<value>` if you need to script it.

### install
Usage: `webstir install [--dry-run|--clean] [--package-manager <npm|pnpm|yarn[@version]>]`

What it does:
- Ensures the pinned `@webstir-io/webstir-frontend`, `@webstir-io/webstir-testing`, and `@webstir-io/webstir-backend` packages recorded in `framework-packages.json` are installed from the registry and present in `node_modules`.
- Updates the workspace `package.json` entries to align with `framework-packages.json`, installs providers referenced in `webstir.providers.json`, and runs the selected package manager when drift is detected.
- Verifies installed versions against the embedded manifest and exits with guidance if mismatches remain.

Notes:
- Run after upgrading the CLI or whenever your package manager has modified pinned dependencies.
- Safe to run repeatedly; skips work when packages are already in sync.
- Use `--dry-run` to preview which packages would be installed or updated without running a package install (non-zero exit code means action is required).
- Use `--clean` to remove the cached `.webstir/` workspace directory before reinstalling (cannot be combined with `--dry-run`).
- Override the tool for a single run with `--package-manager pnpm@10.5.2` (or `-m pnpm@10.5.2`); omit `@version` to use the default Corepack-discovered binary.
- Set `WEBSTIR_PACKAGE_MANAGER=pnpm@10.5.2 webstir install` to persist the override for the current process; leave unset to fall back on `package.json` metadata or lockfiles.
- Ensure `.npmrc` is configured with credentials (when publishing, provide `NPM_TOKEN`) so registry operations succeed.

### publish
Usage: `webstir publish`

What it does:
- Produces optimized assets in `dist/` for each page.
- Rewrites HTML to reference fingerprinted assets and emits a per-page `manifest.json`.
- Minifies HTML/CSS/JS and removes comments and source maps.
- Honors `--runtime <frontend|backend|all>` (or `-r`) so you can publish just the backend artifacts when frontend assets are unchanged.

### backend-inspect
Usage: `webstir backend-inspect [project] [--project <name>]`

### enable
Usage: `webstir enable <scripts <page>|spa|client-nav|search|content-nav|backend|github-pages|gh-deploy>`

What it does:
- Opts into optional functionality by writing embedded feature scaffolds and updating `package.json` flags under `webstir.enable`.
- Adds required app imports for feature scripts/styles so the behavior is active on the next build/watch.

Notes:
- Feature scripts are appended as `.js` imports in `src/frontend/app/app.ts` because the dev server serves `build/frontend/**`.
- For details and per-feature outputs, see [Enable Features](../how-to/enable.md).

What it does:
- Runs the backend worker (server-only) to refresh `.webstir/backend-manifest.json`.
- Prints module metadata (contract version, capabilities, routes, jobs) so you can confirm manifest hydration without starting `watch`.

Notes:
- Accepts the positional `[project]` or `--project` flag when multiple projects exist in the current directory.
- Skips frontend work entirely; run `webstir build --runtime backend` first if you only want to inspect the last build output without rebuilding.

### add-page
Usage: `webstir add-page <name>`

What it does:
- Scaffolds a new page under `src/frontend/pages/<name>/` (defaults to JS-free output when `webstir.mode=ssg`).
- Ready to build and serve without extra configuration.
- Delegates to the `@webstir-io/webstir-frontend` CLI so the scaffold matches the current framework templates.

### add-test
Usage: `webstir add-test <name-or-path>`

What it does:
- Creates a `.test.ts` file under the nearest `tests/` folder relative to the path provided.
- Works for both frontend and backend test locations.
- Uses the `@webstir-io/webstir-testing` CLI to write the template and keep dependencies pinned.

### add-route
Usage: `webstir add-route <name> [--method <METHOD>] [--path <path>] [--fastify] [--project <project>]`

What it does:
- Adds a backend route entry to `webstir.moduleManifest.routes` in `package.json`.
- Route entries describe backend APIs; static pages/SSG routing is driven by `webstir.moduleManifest.views`.
- Defaults to `GET /api/<name>` when flags are omitted.
- Populates manifest metadata (`summary`, `description`, `tags`) plus request/response schema references supplied via CLI flags. Schema references follow the `kind:name@source` format described in the [`@webstir-io/module-contract` schema guidance](https://github.com/webstir-io/webstir/blob/main/packages/contracts/module-contract/README.md#schema-references) (`kind` defaults to `zod`, `@source` optional).
- With `--fastify`, also scaffolds `src/backend/server/routes/<name>.ts` and attempts to import/register it in `src/backend/server/fastify.ts` when present.

Options:
- `--method` HTTP method (e.g., GET, POST). Default: GET
- `--path` Route path (e.g., /api/users). Default: `/api/<name>`
- `--project <project>` Target a specific workspace project when multiple exist.
- `--fastify` Also scaffold a Fastify handler and register it if possible
- `--summary <text>` Adds a short human-readable summary to the manifest entry.
- `--description <text>` Adds a longer description to the manifest entry.
- `--tags tag1,tag2` Comma-separated tags (trimmed and deduped case-insensitively).
- `--params-schema <ref>` Reference for route params.
- `--query-schema <ref>` Reference for query params.
- `--body-schema <ref>` Reference for request bodies.
- `--headers-schema <ref>` Reference for request headers.
- `--response-schema <ref>` Reference for the success response body.
- `--response-status <code>` Overrides the success status code (must be 100-599).
- `--response-headers-schema <ref>` Reference for response headers.

Schema flags (`--*-schema`) expect the `kind:name@source` string noted above. Omit `kind:` for Zod schemas and skip `@source` when the schema lives beside the generator output. Invalid `kind` values or missing `name` segments cause CLI validation errors before any files are written.

### add-job
Usage: `webstir add-job <name> [--schedule <expression>] [--project <project>]`

What it does:
- Creates `src/backend/jobs/<name>/index.ts` and adds an entry to `webstir.moduleManifest.jobs` in `package.json`.
- The job stub exports a `run()` function and is directly executable during development.
- Accepts optional metadata so manifest entries stay self-documenting (`description`, `priority`). Priority accepts either integers or arbitrary strings; numeric values are stored as numbers.

Options:
- `--schedule` Optional schedule string (free-form, often cron-like, e.g., `0 0 * * *`). Stored as-is in the manifest.
- `--project <project>` Target a specific workspace project when multiple exist.
- `--description <text>` Adds a longer explanation for the job alongside the manifest entry.
- `--priority <number|string>` Stores a numeric priority when parsable or falls back to the provided string unchanged.
- After scaffolding, run `node build/backend/jobs/scheduler.js --list|--job <name>|--watch` (or the TypeScript equivalent via `tsx`) to inspect and execute jobs locally. The embedded watcher supports `@hourly`, `@daily`, `@weekly`, `@reboot`, and `rate(n units)` expressions; other cron strings are recorded for your production scheduler.

### smoke
Usage: `webstir smoke [workspace]`

What it does:
- Copies the embedded Accounts backend example into `CLI/out/smoke/accounts` (unless a workspace path is provided).
- Installs dependencies, runs the standard build workflow, and loads `.webstir/backend-manifest.json`.
- Prints the manifest location, capabilities, and route definitions; exits non-zero when no routes are present.

Notes:
- Provide a workspace path to reuse an existing project instead of copying the example.
- Requires local access to the framework packages; configure `.npmrc` for npmjs registry installs.

## Dev Server & Watch
- Serves `build/` over ASP.NET Core with an SSE endpoint for live reload.
- Proxies API requests from `/api/*` to the Node server.
- Clean URLs and sensible cache headers for dev vs. prod.
- File watching uses a buffered queue to avoid thrashing on burst changes.
- Collects client errors at `POST /client-errors` (expects JSON, up to 32KB). Responds with `204` on success; forwards to the error tracking hook.

Change impact:
- Frontend change → rebuild affected page/assets → broadcast reload via SSE.
- Backend change → rebuild backend → restart Node process.
- Shared change → rebuild both sides that depend on shared modules.

## Build & Publish Pipelines

HTML:
- Page HTML merges into `src/frontend/app/app.html` (requires a `<main>` element) and is written to `build/frontend/pages/<page>/index.html` in dev.
- In publish, HTML is minified and rewritten to reference fingerprinted assets listed in a per-page manifest.

CSS:
- Resolves `@import` and URL references; copies assets.
- In publish, supports optional CSS Modules, autoprefixing, and minification.

JavaScript/TypeScript:
- Uses `tsc --build` with an embedded `base.tsconfig.json`.
- ESM-only module graph.
- Tree-shakes and minifies in publish.

Outputs:
- Dev: `build/frontend/**`, `build/backend/**` with readable output and live-reload.
- Prod: `dist/frontend/pages/<page>/index.<timestamp>.{css|js}`, HTML with rewritten links, and a per-page `manifest.json`.

## Project Layout
- Base HTML: `src/frontend/app/app.html` contains a `<main>` used for page composition.
- Pages: `src/frontend/pages/<page>/index.html|css|ts`.
- App assets: `src/frontend/app/*` (copied as-is to `build/`).
- Shared types/modules: `src/shared/`.
- Backend entry: `src/backend/index.ts` → `build/backend/index.js`.

## Examples
- Create a full-stack app: `webstir init my-app && cd my-app && webstir watch`
- Static site (SSG): `webstir init ssg docs && cd docs && webstir watch`
- Clean build: `webstir build --clean`
- Add a page: `webstir add-page about && webstir watch`
- Publish for production: `webstir publish`
- Refresh framework packages: `webstir install --clean`
- Repair missing scaffold files: `webstir repair --dry-run && webstir repair`
- Run tests with Vitest: `WEBSTIR_TESTING_PROVIDER=@webstir-io/vitest-testing webstir test`
- Verify backend manifest ingestion: `webstir smoke`

## Help Output (Sample)
```
$ webstir --help
webstir - Modern web development build tool

Usage: webstir [command] [options] [path]

Commands:
  add-job       Add a backend job stub and manifest entry. Metadata flags are documented in this page: #add-job
  add-page      Add a new page (frontend only)
  add-route     Add a backend route entry to the module manifest (package.json). Metadata and schema flags are documented in this page: #add-route
  add-test      Scaffold a starter test
  build         Build the project once
  help          Show help information
  init          Initialize a new webstir project
  install       Synchronize framework package dependencies from the registry
  publish       Create production build
  repair        Restore missing scaffold files for the current workspace mode
  smoke         Run the accounts example through the CLI and report backend manifest routes
  test          Run tests through the configured provider (defaults to @webstir-io/webstir-testing)
  watch         Build and watch for changes (default)

Run 'webstir help <command>' for more information on a specific command.

Path parameter:
  You can specify a path as the last argument to run commands in a different directory.

Notes:
  Workers are injected (IWorkflowWorker); 'add-page' targets the frontend worker.

Examples:
  webstir build ./my-project         # Build project in ./my-project directory
  webstir watch /path/to/project     # Watch project at absolute path
  webstir init new-app               # Initialize new project in new-app directory
  WEBSTIR_TESTING_PROVIDER=@webstir-io/vitest-testing webstir test   # Run tests with the Vitest provider
  webstir install                    # Sync registry packages and providers
  webstir test --help               # See provider override guidance
  webstir smoke                    # Run the accounts smoke check and report manifest routes

$ webstir help build
Build the project once

Usage: webstir build [options]

Options:
  --clean             Clean build directory before building

Examples:
  webstir build                           # Build the project
  webstir build --clean                   # Clean build (removes build directory first)
  webstir build ./my-app                  # Build project in ./my-app directory
```

## Exit Codes
- `0`: Success
- Non-zero: Error (build failure, test failure, invalid arguments, or runtime error)

## Contributing Notes
- Commands live in `CLI/`; workflows and services live in `Engine/`.
- `Engine/Workflows/` orchestrates `init`, `build`, `watch`, `test`, `publish`, `add-page`, `add-test`.
- Use `AppWorkspace` and `Engine/Constants.cs` for paths. Avoid manual string manipulation; prefer helpers in `Engine.Extensions`.
- Keep changes minimal and behavior-preserving. Follow [.codex/style.md](https://github.com/webstir-io/webstir/blob/main/orchestrators/dotnet/.codex/style.md) and `.editorconfig` when editing C#.
- Framework packaging commands live in `Framework/Framework.csproj`; run `dotnet run --project Framework/Framework.csproj -- packages ...` when rebuilding bundles.

## Related Docs
- High-level solution overview — [solution](../explanations/solution.md)
- Templates — [templates](templates.md)
- Testing — [orchestrator testing guide](https://github.com/webstir-io/webstir/blob/main/orchestrators/dotnet/.codex/testing.md), [tests](../explanations/testing.md)
- Workspace and paths — [workspace](../explanations/workspace.md)
