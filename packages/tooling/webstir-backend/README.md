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

Requires Bun **1.3.11** or newer.

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

The package-managed default `src/backend/index.ts` entry is the supported runtime surface:

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

The starter files come from `webstir init` and `webstir enable backend`, not the provider: the server entry `src/backend/index.ts`, its `tsconfig.json`, and in the full starter a `module.ts` the server loads automatically.

### Bun Scaffold (default)

Fresh scaffolds now boot through the package-managed Bun runtime by default:

- `src/backend/index.ts` composes through `createDefaultBunBackendBootstrap(...)` from `@webstir-io/webstir-backend`, so bootstrap-level fixes can ship through package upgrades instead of template-only copies.

- Start the built backend with Bun:
  ```bash
  bun build/backend/index.js
  ```

Published apps with a server also ship the supported Bun deploy runner:

- Start the published workspace through the single-port deploy host:
  ```bash
  bun ./node_modules/.bin/webstir-backend-deploy --workspace "$PWD"
  ```
- An app without pages proxies all requests to the published backend runtime.
- An app with pages serves `dist/frontend/**` and proxies `/api/*` to the published backend runtime.

Fresh scaffolds do not copy `src/backend/server/bun.ts` or `src/backend/runtime/*` re-export files. The operational runtime lives in upgradeable package exports instead.

### Server runtime baseline

The default `src/backend/index.ts` entry provides these runtime guarantees:

- Route auto-mounting: any `module.ts` routes are compiled, logged, and attached on startup with manifest summaries (name, version, route count, capabilities).
- Health probes: `/api/health` (for the orchestrator), `/healthz` (generic health), and `/readyz` (status + manifest summary). The CLI still waits for `API server running` before proxying requests.
- Logging: every request logs `request.completed` with its `requestId`, method, path, status and latency; pass `createBaseLogger` for your own logger.
- Request context: handlers receive `params`, `query`, `body`, `session`, `flash`, `user`, `db`, `jobs`, `email`, `files`, `auth`, `env`, `logger`, `request`, `requestId`, and `now()`.
- Request IDs: each response sets `x-request-id` and the context/logger include the same identifier so you can correlate logs.
- Failure safety: handler exceptions are caught and surfaced as `{ error: 'internal_error' }` without tearing down the process.
- Progressive enhancement responses: handlers can return redirects (`303` by default) or targeted fragment payloads; the scaffold emits `Location` and `x-webstir-fragment-*` headers accordingly.
- Form handling: JSON bodies still work as before, and the scaffold now parses `application/x-www-form-urlencoded` requests into plain objects for HTML form workflows.

Stick with the default Bun entry while exploring the manifest helpers, or import package runtime exports directly when you need an explicit local entry. The readiness + manifest wiring stays the same.

### Runtime cache ergonomics

- Request-time views cache the built frontend HTML document shell in process memory, keyed by the resolved built file under `build/frontend/pages/**` (or `dist/frontend/**` when serving published output).
- The first request for a document is a cache `miss`; unchanged follow-up requests are `hit`; if the built HTML file changes on disk, the next request invalidates the stale entry, reloads it, and reports `stale`.
- Request-time document responses always send `Cache-Control: no-store` and expose the cache outcome via `x-webstir-document-cache`, so you can verify whether the runtime reused or refreshed the shell.
- Fragment responses are never reused by the scaffold runtime. They always send `Cache-Control: no-store` plus `x-webstir-fragment-cache: bypass`, because fragment bodies come from live route execution and should reflect current session/auth/request state.
- Process restarts clear the in-memory document cache. There is no separate persisted request-time HTML cache today; the existing `.webstir` cache files remain build/publish metadata, not response payload storage.

### Batteries

A server app gets these from the package, with no setup; see the [docs](https://webstir.dev/docs/how-to/) for each.

- **Database** — `ctx.db` (or `import { db } from '@webstir-io/webstir-backend/db'`): `query`, `get`, `execute` and `transaction`, with `?` placeholders, on SQLite (`DATABASE_URL` unset or `file:...`, default `data/app.sqlite`) or Postgres (`postgres://...`). It opens on first use; SQLite gets WAL, foreign keys and a busy timeout.
- **Migrations** — `src/backend/migrations/*.sql`, or `.ts` exporting `up(db)`, apply once each, in order and in a transaction, when the server starts (`webstir add-migration`, `webstir migrate [--status]`). A failing migration stops the server with its file and error. They are recorded in `webstir_migrations`.
- **Sessions** — kept in the database, so they survive restarts. A custom `sessionStore` may answer with promises; `createInMemorySessionStore()` is for tests. `SESSION_SECRET` is required in production.
- **Jobs** — `src/backend/jobs/<name>/index.ts` exporting `run(payload, context)`. Scheduled jobs (`webstir.moduleManifest.jobs[].schedule`: cron, `@daily`, `@reboot`, `rate(5 minutes)`) and queued jobs (`ctx.jobs.enqueue(name, payload, { delaySeconds, maxAttempts })`, retried with backoff, kept as failed after the last try) run in the server process. `WEBSTIR_JOBS=off` turns them off in a process. `webstir jobs [run <name>]`.
- **Email** — `ctx.email.send({ to, subject, text, html })` over SMTP (`EMAIL_URL`, `EMAIL_FROM`), printed and kept in `.webstir/email.log` in development, or through `setEmailTransport(fn)`.
- **Files** — `ctx.files.put/get/url/delete` on local disk (`STORAGE_URL=file:./data/files`, the default, with signed links the server serves) or S3 (`s3://bucket/prefix`, presigned links), or through `setFileStore(store)`.
- **Sign-in** — `src/backend/sign-in.ts` (written by `webstir enable sign-in`) turns on email-code sign-in: `ctx.user`, `auth: 'required'` on routes and views, sign-out everywhere. See `@webstir-io/webstir-backend/sign-in`.
- **Bearer auth** — for an API with its own identity provider, pass `resolveRequestAuth: (request) => resolveBearerAuth(request)` from `@webstir-io/webstir-backend/auth/bearer`: HS256 (`AUTH_JWT_SECRET`), RS256 (`AUTH_JWT_PUBLIC_KEY[_FILE]` or `AUTH_JWKS_URL`), `AUTH_JWT_ISSUER`/`AUTH_JWT_AUDIENCE`, and service tokens (`AUTH_SERVICE_TOKENS`). It fails closed; the result is `ctx.auth`.
- **Metrics** — `/metrics` reports request counts, errors and latency over the last `METRICS_WINDOW` requests (200); `METRICS_ENABLED=off` turns it off.
- **Session and form safety** — stale or tampered session cookies clear on commit; CSRF tokens are single-use; `session: { mode: 'required' }` rejects a request without a session with `401 session_required` before the handler runs.

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
        const row = await ctx.db.get('SELECT id, email FROM accounts WHERE id = ?', [ctx.params.id]);
        return row
          ? { status: 200, body: row }
          : { status: 404, errors: [{ code: 'not_found', message: 'Account not found' }] };
      }

      const rows = await ctx.db.query('SELECT id, email FROM accounts');
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

- The server loads `.env.local`, then `.env`, from the app's root; a variable already set wins. `loadAppEnv()` builds the server's settings from them, and is the default `loadEnv`.
- `webstir init` writes `.env.example` with every setting; see the [environment reference](https://webstir.dev/docs/reference/env/).
- `prepareApp(workspaceRoot)` points the batteries at an app from a script or CLI command outside its server.

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
# From the repository root, describe the change for the next release
bun run changeset
```

- Add tests under `tests/**/*.test.ts` and wire them into `bun run test` once the backend runtime is ready.
- Publishing targets npm via `publishConfig.registry`.
- Merging the "Version packages" pull request publishes the contract, backend, frontend, and CLI together.

## Troubleshooting

- “TypeScript config not found at src/backend/tsconfig.json; skipping type-check.” — esbuild can still build, but path aliases and stricter checks may be skipped. Add a workspace `src/backend/tsconfig.json`.
- “No backend entry point found” — ensure `src/backend/index.ts` (or `index.js`) exists. The provider looks for `index.*` and emits `build/backend/index.js`.
- esbuild warnings/errors are surfaced as diagnostics with file locations when available.

CI notes
- Package behavior is validated before publishing; the release workflow consumes that exact CI proof instead of rerunning it.

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

### Functions & Jobs

`webstir add-job <name>` writes a job entry, `src/backend/jobs/<name>/index.ts`. A function is the same shape under `src/backend/functions/<name>/index.ts`.

### Dev runner readiness

- The server listens on `process.env.PORT` (default `4321`) and logs `API server running` when ready.
- The orchestrator's dev server waits for that readiness line and proxies `/api/*` to your Node server.
- Health probes: `/api/health` (orchestrator compatibility) mirrors `/healthz`, while `/readyz` exposes the readiness state plus the current manifest summary for external monitors.
- If you replace the default runtime locally, keep the same behavior: listen on `process.env.PORT`, expose the same endpoints, and print `API server running` once the server is listening.

## Page views

A view can route a dynamic path to a built frontend page instead of a backend-rendered document. Declare it in `package.json` under `webstir.moduleManifest.views` with a `page` and a `:param` path pattern:

```json
{
  "webstir": {
    "moduleManifest": {
      "views": [
        { "name": "proposal", "path": "/clients/:client/proposals/:proposal", "page": "proposal", "renderMode": "spa" }
      ]
    }
  }
}
```

- `webstir watch` registers each pattern as a Bun route for `src/frontend/pages/<page>/index.html`; `webstir-backend-deploy` serves `dist/frontend/pages/<page>/index.html` when no static file matches. A real file always wins over a pattern, and a static segment beats a `:param` in the same position.
- Parameters are whole segments (`/:version`, not `/v:version`). The page reads them from `location.pathname`.
- A pattern cannot end in a file name such as `/download.json`; a `:param` matches any single segment, including one containing a dot, exactly as in watch. When nothing matches and the request accepts HTML, `pages/404/index.html` is served with a 404 status if the workspace has one.
