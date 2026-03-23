# @webstir-io/webstir-backend

Backend delivery for Webstir's HTML-first application model. The package type-checks backend workspaces, builds runnable Bun-targeted output, and ships the default request runtime for server-handled forms, fragment responses, sessions, request-time views, and request-time document caching.

## Quick Start

1. **Install**
   ```bash
   bun add @webstir-io/webstir-backend
   ```
2. **Run a build**
   ```ts
   import { backendProvider } from '@webstir-io/webstir-backend';

   const { manifest } = await backendProvider.build({
     workspaceRoot: '/absolute/path/to/workspace',
     env: { WEBSTIR_MODULE_MODE: 'build' },
     incremental: true
   });

   console.log(manifest.entryPoints);
   ```

Requires Bun **1.3.5** or newer.

## What This Runtime Is Good At

- Server-rendered HTML routes and request-time views
- HTML form workflows that still work without client JavaScript
- Redirect-after-post and fragment responses from the same backend handlers
- Session, flash, CSRF, auth, and request hooks in the default scaffold
- Request-time document caching for view shells plus explicit fragment no-store behavior

Canonical proof apps in this repo:

- [`examples/demos/auth-crud`](../../../examples/demos/auth-crud) for server-handled sign-in and CRUD forms
- [`examples/demos/dashboard`](../../../examples/demos/dashboard) for dashboard-style shell and panel refreshes without SPA architecture

## Shipped HTML-First Runtime

The default `src/backend/index.ts` entry, the optional Bun shim, and the optional Fastify scaffold share the same runtime guarantees:

- Route auto-mounting from compiled `module.ts`
- Health probes at `/api/health`, `/healthz`, and `/readyz`
- Structured request logging with `x-request-id`
- Form parsing for `application/x-www-form-urlencoded`
- Redirect and fragment responses via `Location` and `x-webstir-fragment-*`
- Session, flash, and request-hook execution in the scaffold runtime
- Request-time views with `x-webstir-document-cache: miss|hit|stale`
- Explicit fragment cache bypass with `Cache-Control: no-store` and `x-webstir-fragment-cache: bypass`

## Community & Support

- Code of Conduct: https://github.com/webstir-io/.github/blob/main/CODE_OF_CONDUCT.md
- Contributing guidelines: https://github.com/webstir-io/.github/blob/main/CONTRIBUTING.md
- Security policy and disclosure process: https://github.com/webstir-io/.github/blob/main/SECURITY.md
- Support expectations and contact channels: https://github.com/webstir-io/.github/blob/main/SUPPORT.md

## Workspace Layout

```
workspace/
  src/backend/
    tsconfig.json
    index.ts                 # optional monolithic server entry
    functions/*/index.ts     # optional function handlers
    jobs/*/index.ts          # optional job/worker entries
    handlers/
    tests/
  build/backend/...    # compiled JS output
```

The provider expects a standard workspace layout and performs two steps:

1) Type checking via `tsc -p src/backend/tsconfig.json --noEmit` (can be skipped in dev; see below)
2) Build via esbuild into `build/backend`:
   - build/test: transpile only (no bundle), sourcemaps on
   - publish: bundle each entry, externalize node_modules, minify, strip comments

## Provider Contract

`backendProvider` implements `ModuleProvider` from `@webstir-io/module-contract`:

- `metadata` — package id, version, kind (`backend`), CLI compatibility, and runtime notes.
- `resolveWorkspace({ workspaceRoot })` — returns canonical source/build/test roots.
- `build(options)` — type‑checks with `tsc --noEmit`, then runs esbuild. In `build`/`test` mode it transpiles without bundling; in `publish` it bundles workspace code, externalizes `node_modules`, minifies, strips comments, and defines `NODE_ENV=production`. Artifacts are gathered and a manifest describing entry points, diagnostics, and the module contract manifest is returned.
- `getScaffoldAssets()` — returns starter files to bootstrap a backend workspace:
  - `src/backend/tsconfig.json` (NodeNext, outDir `build/backend`)
- `src/backend/index.ts` (thin composition entry that boots the package-managed Bun runtime)
- `src/backend/module.ts` (optional manifest + handler example the server loads automatically)
- `src/backend/server/bun.ts` (optional Bun entry shim)
- `src/backend/server/fastify.ts` (optional Fastify server scaffold)

### Bun Scaffold (default)

Fresh scaffolds now boot through the package-managed Bun runtime by default:

- Start the built backend with Bun:
  ```bash
  bun build/backend/index.js
  ```
- Or pin the entry directly to the Bun shim:
  ```ts
  // src/backend/index.ts
  export { start } from './server/bun.js';
  ```

This keeps the default entry thin while moving the operational runtime into upgradeable package code.

### Fastify Scaffold (optional)

The default Bun runtime handles `/api/health`, readiness logging, and auto-mounts the compiled `module.ts` handlers. If you prefer Fastify’s plugin ecosystem or need advanced routing features, you can swap the entry for the Fastify scaffold:

- Install Fastify in your workspace:
  ```bash
  bun add fastify
  ```
- Import and start it from your `src/backend/index.ts`:
  ```ts
  // src/backend/index.ts
  import { start } from './server/fastify';
  start().catch((err) => { console.error(err); process.exit(1); });
  ```
- Or run it directly after a build:
  ```bash
  bun build/backend/server/fastify.js
  ```

Note: The package’s smoke test temporarily installs Fastify only to type‑check the optional scaffold. Normal users do not need Fastify unless they choose to use this server. In CI or offline environments, set `WEBSTIR_BACKEND_SMOKE_FASTIFY=skip` to bypass the Fastify install and type‑check.

When present, the Fastify scaffold will also attempt to auto‑mount any compiled module routes it finds under `build/backend/module(.js)`. Export your module definition as `module`, `moduleDefinition`, or the `default` export from `src/backend/module.ts` and build; the server will attach handlers using the route metadata.

### Server runtime baseline

The default `src/backend/index.ts` entry, the Bun shim, and the optional Fastify scaffold share the same runtime guarantees:

- Route auto-mounting: any `module.ts` routes are compiled, logged, and attached on startup with manifest summaries (name, version, route count, capabilities).
- Health probes: `/api/health` (for the orchestrator), `/healthz` (generic health), and `/readyz` (status + manifest summary). The CLI still waits for `API server running` before proxying requests.
- Structured logging: every request gets a `pino` child logger that carries `requestId`, method, path, and route metadata. Logs emit as JSON so downstream tooling can parse them easily.
- Request context: handlers receive `params`, `query`, `body`, `env`, `logger`, `request`, `reply`, `requestId`, and `now()` helpers that align with the `RequestContext` shape from `@webstir-io/module-contract`.
- Request IDs: each response sets `x-request-id` and the context/logger include the same identifier so you can correlate logs.
- Failure safety: handler exceptions are caught and surfaced as `{ error: 'internal_error' }` without tearing down the process.
- Progressive enhancement responses: handlers can return redirects (`303` by default) or targeted fragment payloads; the scaffold emits `Location` and `x-webstir-fragment-*` headers accordingly.
- Form handling: JSON bodies still work as before, and the scaffold now parses `application/x-www-form-urlencoded` requests into plain objects for HTML form workflows.

Stick with the default Bun entry while exploring the manifest helpers, keep the Bun shim if you want an explicit local entry, or drop in the Fastify scaffold when you need its plugin ecosystem. The readiness + manifest wiring stays the same.

### Runtime cache ergonomics

- Request-time views cache the built frontend HTML document shell in process memory, keyed by the resolved built file under `build/frontend/pages/**` (or `dist/frontend/**` when serving published output).
- The first request for a document is a cache `miss`; unchanged follow-up requests are `hit`; if the built HTML file changes on disk, the next request invalidates the stale entry, reloads it, and reports `stale`.
- Request-time document responses always send `Cache-Control: no-store` and expose the cache outcome via `x-webstir-document-cache`, so you can verify whether the runtime reused or refreshed the shell.
- Fragment responses are never reused by the scaffold runtime. They always send `Cache-Control: no-store` plus `x-webstir-fragment-cache: bypass`, because fragment bodies come from live route execution and should reflect current session/auth/request state.
- Process restarts clear the in-memory document cache. There is no separate persisted request-time HTML cache today; the existing `.webstir` cache files remain build/publish metadata, not response payload storage.

### Secrets & auth adapters

The backend template now ships a lightweight auth adapter so you can secure routes without wiring a full identity provider on day one:

- **Environment-driven secrets** — populate `.env.local`/`.env` with one JWT verification input: `AUTH_JWT_SECRET` for shared-secret HS256, `AUTH_JWT_PUBLIC_KEY` or `AUTH_JWT_PUBLIC_KEY_FILE` for RSA public-key verification, or `AUTH_JWKS_URL` for remote JWKS discovery. Optional `AUTH_JWT_ISSUER` / `AUTH_JWT_AUDIENCE` claims and comma/space-delimited `AUTH_SERVICE_TOKENS` still apply. An example lives in `templates/backend/.env.example`.
- **Bearer verification (HS256 + RS256)** — incoming `Authorization: Bearer <token>` headers now validate against HS256 shared secrets, inline/file-backed RSA public keys, or RSA keys discovered from JWKS. Matching issuer/audience plus `nbf` and `exp` claims are enforced when present. On success, `ctx.auth` includes `userId`, `email`, `scopes`, `roles`, and the raw claims payload.
- **Service tokens** — internal callers can present `X-Service-Token` or `X-API-Key` values that match `AUTH_SERVICE_TOKENS`. Successful matches yield a `ctx.auth` context with the `service` scope so you can distinguish automated jobs from end users.
- **Route ergonomics** — the module template now demonstrates gating access on `ctx.auth` and sets the `auth` capability in the manifest so downstream tooling knows the module expects identity context.
- **Session & request-body defaults** — set `SESSION_SECRET` for stable session cookies. In development, the scaffold still falls back to a per-process random secret when unset; in production, `SESSION_SECRET` is now required and startup fails fast when it is missing. Request bodies are capped by `REQUEST_BODY_MAX_BYTES` (default `1048576`) in the built-in, Bun, and Fastify server templates.
- **Durable session storage (optional)** — the scaffold now defaults to SQLite-backed sessions in production when `SESSION_STORE_DRIVER` is unset, while keeping in-memory storage as the development default. You can still opt into SQLite explicitly with `SESSION_STORE_DRIVER=sqlite` or just configure `SESSION_STORE_URL`; set `SESSION_STORE_DRIVER=memory` only when you intentionally want the non-durable path. `SESSION_STORE_URL` defaults to `file:./data/sessions.sqlite` when the SQLite store is active and resolves from the workspace root, so launch directory changes do not redirect session state into the wrong folder.
- Install `pino` in your workspace (`bun add pino`) before running the scaffold; the template server imports it directly.

This adapter is still intentionally scoped, but it now supports the two most common integration paths: shared-secret HS256 for local/simple deployments and RSA/JWKS verification for third-party IdPs. The scaffold populates `ctx.auth` for every route once one of those verification inputs is configured.

### Observability & metrics

- **Structured logs** — set `LOG_LEVEL` (default `info`) and optionally `LOG_SERVICE_NAME`. Every request emits a `request.completed` entry with status code and latency, plus rich metadata (`requestId`, method, route).
- **Metrics** — enable with `METRICS_ENABLED=on` (default) and tune the rolling window via `METRICS_WINDOW` (number of recent durations to keep). The server tracks totals, error counts, average latency, and p95 latency.
- **Endpoints** — `/metrics` returns the snapshot JSON; `/readyz` now includes the same metrics summary alongside manifest info so orchestrators and dashboards can consume a single payload.

Install `pino` (and optionally `pino-pretty` for local formatting) in any workspace that uses the backend template; no other setup is required.

### Jobs & scheduling

- Define jobs via `webstir add-job <name> [--schedule "<cron>"] [--description "..."] [--priority <number|label>]`. The CLI creates `src/backend/jobs/<name>/index.ts` and records metadata in `webstir.moduleManifest.jobs` in `package.json`.
- The template provides a zero-config job loader (`src/backend/jobs/runtime.ts`) and a lightweight scheduler/runner (`build/backend/jobs/scheduler.js`). Use it to explore your jobs without wiring a full queue:

```bash
bun add pino                    # already needed for the server
bun src/backend/jobs/scheduler.ts --list
bun src/backend/jobs/scheduler.ts --json
bun build/backend/jobs/scheduler.js --job nightly
bun build/backend/jobs/scheduler.js --watch        # runs @hourly/@daily/@weekly/@reboot or rate(...) jobs
```

- `/readyz` surfaces manifest job counts, and `bun build/backend/jobs/<name>/index.js` remains the quickest way to execute a single job in isolation.
- Cron expressions recorded in the manifest are left untouched so you can plug them into your real scheduler (Temporal, Quartz, Cloud Scheduler, etc.). The built-in watcher supports the `@hourly`, `@daily`, `@weekly`, `@reboot`, and `rate(n units)` patterns for basic local loops; use `--json` when you want a machine-friendly export of job metadata for an external scheduler instead of relying on the local watcher.

### Database & migrations

- `DATABASE_URL` defaults to `file:./data/dev.sqlite`. Point it at Postgres (`postgres://...`) or another SQLite file as needed. Override the tracking table via `DATABASE_MIGRATIONS_TABLE` (defaults to `_webstir_migrations`).
- `src/backend/db/connection.ts` exposes a tiny helper that connects to SQLite via Bun's built-in `bun:sqlite` runtime or to Postgres via `pg`. The default SQLite flow needs Bun; install `pg` only when you use Postgres.
- `src/backend/session/store.ts` now owns the runtime session-store choice. Development still defaults to the in-memory store for stateless/local flows, while production defaults to SQLite unless you pin `SESSION_STORE_DRIVER=memory`. You can also persist sessions explicitly in SQLite via `src/backend/session/sqlite.ts` by setting `SESSION_STORE_DRIVER=sqlite` or just configuring `SESSION_STORE_URL`. The SQLite adapter creates its table lazily and runs on Bun without any extra SQLite package install.
- Drop SQL/TypeScript migrations under `src/backend/db/migrations/*.ts`, exporting `id`, `up`, and optional `down`.
- Run migrations with:

```bash
bun src/backend/db/migrate.ts --list
bun src/backend/db/migrate.ts               # apply pending migrations
bun src/backend/db/migrate.ts --down --steps 1
```

- The runner logs each migration, records history in `DATABASE_MIGRATIONS_TABLE`, and works the same way once compiled (`bun build/backend/db/migrate.js ...`).

### Module Manifest Integration

When `build()` completes, it now returns a `ModuleBuildManifest` with a `module` property that matches the contract introduced in `@webstir-io/module-contract@0.1.5`. The provider looks for module metadata in the workspace’s `package.json` under `webstir.moduleManifest`. If present, the object is validated against the shared `moduleManifestSchema`; otherwise, sane defaults are generated from the workspace package name/version.

```jsonc
// workspace/package.json
{
  "name": "@demo/accounts",
  "version": "0.1.0",
  "webstir": {
    "moduleManifest": {
      "contractVersion": "1.0.0",
      "name": "@demo/accounts",
      "version": "0.1.0",
      "capabilities": ["auth", "views"],
      "routes": [],
      "views": []
    }
  }
}
```

If the manifest fails validation, the provider emits a diagnostic and falls back to a minimal contract (name/version/kind only). This keeps consuming tooling resilient while still surfacing issues to the developer.

After a build, the provider also tries to load `build/backend/module.js` (compiled from `src/backend/module.ts`). Export a `createModule(...)` definition as `module`, `moduleDefinition`, or `default` to have routes, views, and capabilities hydrated automatically.

#### ts-rest Router Example

```ts
// src/backend/module.ts
import { initContract } from '@ts-rest/core';
import { createModule, fromTsRestRouter, CONTRACT_VERSION, type RequestContext } from '@webstir-io/module-contract';
import { z } from 'zod';

const c = initContract();

const accountSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email()
});

const router = c.router({
  list: c.query({
    path: '/accounts',
    method: 'GET',
    responses: {
      200: z.object({ data: z.array(accountSchema) })
    }
  }),
  detail: c.query({
    path: '/accounts/:id',
    method: 'GET',
    pathParams: z.object({ id: z.string().uuid() }),
    responses: {
      200: accountSchema,
      404: z.null()
    }
  })
});

const routeSpecs = fromTsRestRouter<RequestContext>({
  router,
  baseName: 'accounts',
  createRoute: ({ keyPath }) => ({
    handler: async (ctx) => {
      if (keyPath.at(-1) === 'detail') {
        const row = await ctx.db.accounts.findById(ctx.params.id);
        return row
          ? { status: 200, body: row }
          : { status: 404, errors: [{ code: 'not_found', message: 'Account not found' }] };
      }

      const rows = await ctx.db.accounts.list();
      return { status: 200, body: { data: rows } };
    }
  })
});

export const module = createModule({
  manifest: {
    contractVersion: CONTRACT_VERSION,
    name: '@demo/accounts',
    version: '0.1.0',
    kind: 'backend',
    capabilities: ['db', 'auth'],
    routes: routeSpecs.map((route) => route.definition)
  },
  routes: routeSpecs
});
```

When `bun run build` completes, the provider detects `build/backend/module.js`, hydrates the manifest with the `routes` metadata above, and returns it to the orchestrator alongside the compiled entry points.

#### Module Definition Only Example

If you prefer to skip `createModule()` during early development, you can export a simple object from `module.ts` and the provider will still merge its manifest metadata:

```ts
// src/backend/module.ts
export const module = {
  manifest: {
    contractVersion: '1.0.0',
    name: '@demo/simple-module',
    version: '0.1.0',
    kind: 'backend',
    capabilities: ['search'],
    routes: [{ method: 'GET', path: '/simple' }]
  }
};
```

## Backend Testing Harness

Backend route tests can now launch the compiled server directly through the `@webstir-io/webstir-backend/testing` entry point. Import the helper inside your compiled backend tests (for example under `src/backend/tests/**`) and wrap each suite with `backendTest()`:

```ts
import { assert } from '@webstir-io/webstir-testing';
import { backendTest } from '@webstir-io/webstir-backend/testing';

backendTest('health endpoint responds', async (ctx) => {
  const response = await ctx.request('/api/health');
  const body = await response.json();
  assert.equal(body.ok, true, 'Expected health endpoint to return { ok: true }');
});
```

The harness:

- Spins up `build/backend/index.js` (or a custom entry via `WEBSTIR_BACKEND_TEST_ENTRY`) with the same env wiring used during builds.
- Waits for the readiness log (`API server running` by default) before running your assertions.
- Exposes the hydrated `ModuleManifest` via `ctx.manifest` and provides a `request()` helper that targets the running server.
- Shuts the server down once the backend runtime finishes so `webstir test` / `webstir watch` can continue without orphaned processes.

Environment variables such as `WEBSTIR_BACKEND_TEST_PORT`, `WEBSTIR_BACKEND_TEST_READY`, and `WEBSTIR_BACKEND_TEST_MANIFEST` let you customize the port, readiness text, and manifest path when the defaults do not fit.

This keeps your manifest co-located with runtime code while the provider handles validation and hydration.

### Environment Management

- `src/backend/env.ts` loads `.env.local` (if present) followed by `.env`, merges values into `process.env`, and exposes a typed `loadEnv()` helper.
- A `.env.example` file is scaffolded at the workspace root—copy it to `.env`/`.env.local`, fill in secrets (e.g., `API_BASE_URL`, `DATABASE_URL`, `JWT_SECRET`), and adjust `loadEnv()` to require the variables your backend needs.
- The default HTTP server, Bun scaffold, and Fastify scaffold call `loadEnv()` before binding, so the same config is available inside route handlers. Use `ctx.env.require('JWT_SECRET')` to fetch validated values.

### Multiple Entry Points
The provider discovers these entries automatically (all optional):

- `src/backend/index.{ts,tsx,js,mjs}`
- `src/backend/functions/*/index.{ts,tsx,js,mjs}`
- `src/backend/jobs/*/index.{ts,tsx,js,mjs}`

Outputs mirror the source layout under `build/backend/**/index.js`. The manifest lists relative `index.js` paths for all entries.

Artifacts are returned as absolute paths so installers can copy or upload them. A missing `index.js` triggers a warning diagnostic.

## Internal Helper Layout

- `src/workspace.ts` — resolves source/build/test roots and normalizes `WEBSTIR_MODULE_MODE`.
- `src/build/pipeline.ts` — runs type-check, esbuild (incremental + publish), and compiles optional `module.ts`.
- `src/build/artifacts.ts` — collects build outputs (bundles/assets) and derives the manifest entry list.
- `src/manifest/pipeline.ts` — hydrates the module manifest from `package.json` + `build/backend/module.js`, validating with the shared contract.
- `src/cache/diff.ts` — records `.webstir` cache files for outputs/manifest digests and emits diff diagnostics.
- `src/diagnostics/summary.ts` — common diagnostic helpers (log-level filtering, entry bucket summaries).
- `src/scaffold/assets.ts` — backend scaffold definitions consumed by the provider and tests.

## NPM Scripts

| Script | Description |
|--------|-------------|
| `bun run build` | Compiles provider TypeScript from `src/` into `dist/`. |
| `bun run test` | Builds and runs Node's test runner over `tests/**/*.test.js`. |
| `bun run smoke` | Quick end-to-end check: scaffolds a temp workspace and runs build/publish via the provider. |
| `bun run clean` | Removes `dist/`. |

The published package ships prebuilt JavaScript and type definitions in `dist/`.

## Maintainer Workflow

```bash
bun install
bun run clean          # remove dist artifacts
bun run build          # emits dist/
bun run test           # runs unit/integration tests
bun run smoke
# Release helper (bumps version and pushes a package-scoped release tag)
bun run release -- patch
```

- Add tests under `tests/**/*.test.ts` and wire them into `bun run test` once the backend runtime is ready.
- Ensure CI runs `bun install --frozen-lockfile`, `bun run clean`, `bun run build`, `bun run test`, and `bun run smoke` before publish.
- Publishing targets npm via `publishConfig.registry`.
- Use `bun run release -- <patch|minor|major|x.y.z>` to bump the version, build, test, run the smoke check, and push a package-scoped tag that triggers the monorepo release workflow.

## Troubleshooting

- “TypeScript config not found at src/backend/tsconfig.json; skipping type-check.” — esbuild can still build, but path aliases and stricter checks may be skipped. Add a workspace `src/backend/tsconfig.json`.
- “No backend entry point found” — ensure `src/backend/index.ts` (or `index.js`) exists. The provider looks for `index.*` and emits `build/backend/index.js`.
- esbuild warnings/errors are surfaced as diagnostics with file locations when available.

CI notes
- Package CI runs clean + build + tests + smoke on PRs and main.

Dev tips
- Fast iteration: set `WEBSTIR_BACKEND_TYPECHECK=skip` to bypass type-checking during `build`/`test` mode. Type-checks always run for `publish`.
- Publish sourcemaps: set `WEBSTIR_BACKEND_SOURCEMAPS=on` (before `webstir publish` or provider builds) to bundle `.js.map` files alongside the minified output. The maps are excluded by default to keep bundle sizes lean.
- **`TypeScript config not found` warning** — ensure `src/backend/tsconfig.json` exists.
- **`Backend TypeScript compilation failed`** — inspect diagnostics (stderr/stdout captured in the manifest) and rerun `tsc -p`.
- **No backend entry point found** — confirm `build/backend/index.js` exists after compilation or adjust the build output.

## License

MIT © Webstir
### Watch Mode (developer convenience)

Start incremental builds with type-checking in the background:

```bash
bun run dev           # type-check + transpile on change
bun run dev:fast      # faster DX: skip tsc in watch
```

Notes
- Set `WEBSTIR_BACKEND_DIAG_MAX=<n>` to cap how many esbuild diagnostics print per rebuild (default: 20 in standalone watch, 50 in provider builds invoked by the orchestrator).
- Publish still enforces `tsc --noEmit` even if you skip type-checking in watch.
- After each rebuild you’ll see concise summaries and a manifest glance, for example:
  - `watch:esbuild 0 error(s), N warning(s) in X ms`
- `watch:manifest routes=N views=M [capabilities]`
- Cache parity: once esbuild finishes, watch mode writes the same `.webstir/backend-outputs.json` / `backend-manifest-digest.json` files and logs diff summaries (changed bundles, added/removed routes/views) just like non-watch builds. This keeps downstream tooling in sync during long-running dev sessions.
- Set `WEBSTIR_BACKEND_CACHE_LOG=off` (or `false/0/skip`) to update the `.webstir` cache quietly without emitting diff diagnostics—handy for very chatty watch sessions.

Or programmatically:

```ts
import { startBackendWatch } from '@webstir-io/webstir-backend';

const handle = await startBackendWatch({
  workspaceRoot: '/abs/path/to/workspace',
  env: { WEBSTIR_MODULE_MODE: 'build' }
});

// later
await handle.stop();
```

### Functions & Jobs (scaffolding)

The provider ships example entries you can copy into a fresh workspace:

- `src/backend/functions/hello/index.ts` — a simple function entry
- `src/backend/jobs/nightly/index.ts` — a simple job entry

If you use `getScaffoldAssets()` programmatically, these templates are included alongside `tsconfig.json` and `index.ts`.

### Dev runner readiness

- The backend template listens on `process.env.PORT` (default `4000`) and logs `API server running` when ready.
- The orchestrator's dev server waits for that readiness line and proxies `/api/*` to your Node server.
- Health probes: `/api/health` (orchestrator compatibility) mirrors `/healthz`, while `/readyz` exposes the readiness state plus the current manifest summary for external monitors.
- If you switch to a framework (e.g., Fastify), keep the same behavior: listen on `process.env.PORT`, expose the same endpoints, and print `API server running` once the server is listening.
