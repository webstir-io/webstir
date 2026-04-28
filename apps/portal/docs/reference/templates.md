# Templates

Embedded scaffolding used by the CLI to create projects and generate files. Keeps new apps consistent and zero-config.

## Overview
- Repo source of truth lives under `orchestrators/bun/resources/templates/**`.
- Generated package assets live under `orchestrators/bun/assets/templates/**` and are embedded into the Bun CLI package.
- `webstir init` lays down a server-first `full` project by default.
- Generators add files in the right place with sensible defaults.

## Layout
Created by `webstir init` according to workspace mode:

- `full`: frontend, backend, shared, and types
- `spa`: frontend, shared, and types
- `ssg`: frontend and types
- `api`: backend, shared, and types

Typical frontend scaffold:

- `src/frontend/app/app.html`
- `src/frontend/app/**`
- `src/frontend/pages/<page>/index.html|css|ts`
- `src/frontend/{content,images,fonts,media}/**`

Typical backend scaffold:

- `src/backend/index.ts`
- `src/backend/module.ts`
- `src/backend/jobs/**`
- `src/backend/tests/**`

## Conventions
- Base HTML requires a `<main>` in `src/frontend/app/app.html` for page merge.
- Page folder names must be URL-safe: letters, numbers, `_` and `-`.
- Each page has `index.html`, `index.css`, `index.ts`.
- Backend entry is `src/backend/index.ts`.
- Fresh `api` and `full` scaffolds keep `src/backend/index.ts` thin and use it to boot the package-managed Bun runtime.
- Manifest-backed route and demo logic lives in `src/backend/module.ts`.
- The default app primitives are documented in [Primitives](./primitives.md); treat that page as the naming contract for pages, forms, actions, fragment targets, request-time views, and auth-gated routes.
- For optional app features, prefer absolute app-asset imports such as `await import('/app/router.js')` so dev and publish paths stay aligned.
- Start with `full` when the app needs forms, redirects, auth, or server-rendered documents; opt into `spa` or `ssg` only when you need those delivery modes specifically.

## TypeScript
- Uses an embedded `base.tsconfig.json` referenced by template tsconfigs.
- ESM-only; compiled via the active provider packages.
- Shared code in `src/shared` is compiled for both frontend and backend.
- Dev output keeps source maps for local debugging; publish strips them.
- Dynamic imports load at runtime. Keep `/app/...` imports absolute for assets under `src/frontend/app/`.

## CSS & Assets
- Plain CSS by default; optional CSS Modules in publish.
- `@import` and asset URLs are resolved; files copied to outputs.
- Place static app assets under `src/frontend/app/*`.
- Place Images, Fonts, and Media under `src/frontend/{images|fonts|media}/**`.

## Client Error Reporting
- The base `app.html` includes `/app/error.js` which installs a lightweight client error handler.
- It listens for `window` `error` and `unhandledrejection` and reports to `POST /client-errors` using `sendBeacon` (fallback to `fetch`).
- Behavior:
  - Throttled: max 1 event/second; capped at 20 per page session.
  - Deduped: repeats suppressed within 60s using a fingerprint of type|message|file:line:col|stack-hash.
  - Correlation: includes a client correlation id; server also accepts `X-Correlation-ID`.
- Override: set `window.__WEBSTIR_ON_ERROR__ = (event) => { /* custom */ }` before errors occur to customize reporting.
- Opt-out: remove the `<script src="/app/error.js" async></script>` tag from your `src/frontend/app/app.html`.

## Generators

### add-page
- Command: `webstir add-page <name> --workspace <path>`
- Delegates to `webstir-frontend add-page` (TypeScript CLI) to scaffold `index.html|css|ts`.
- Does not modify existing pages or `app.html`.
- Name normalization: trims, lowercases, replaces spaces with `-`.

### add-test
- Command: `webstir add-test <name-or-path> --workspace <path>`
- Delegates to `webstir-testing-add` (TypeScript CLI) to create `<name>.test.ts` under the nearest `tests/` directory.
- Works for both frontend and backend tests.

## Backend Template
- Thin Bun bootstrap at `src/backend/index.ts`.
- Manifest-backed route and demo logic at `src/backend/module.ts`.
- Exposes health endpoints (`GET /api/health` + `/healthz`) and a readiness probe (`/readyz`) that returns the manifest summary.
- Reads `PORT` env var; defaults handled by the CLI dev server proxy in dev.
- Optional auth adapter: set `AUTH_JWT_SECRET`, `AUTH_JWT_PUBLIC_KEY`, `AUTH_JWT_PUBLIC_KEY_FILE`, or `AUTH_JWKS_URL` (plus `AUTH_JWT_ISSUER` / `AUTH_JWT_AUDIENCE` and `AUTH_SERVICE_TOKENS` when needed) to enable bearer-token verification and populate `ctx.auth` in module routes. Unsupported algorithms, malformed compact JWT segments, bad signatures, wrong issuer/audience, invalid numeric-date claims, and invalid `nbf`/`exp` windows fail closed.
- Session and form safety: stale or tampered session cookies clear on commit, CSRF tokens are single-use after successful verification, and malformed SQLite session rows fail with an explicit session-row diagnostic.
- Observability: install `pino`, set `LOG_LEVEL` / `LOG_SERVICE_NAME`, and enable metrics via `METRICS_ENABLED`. Every request logs structured JSON and `/metrics` exposes rolling latency/error stats.
- Database & migrations: set `DATABASE_URL` (defaults to SQLite in `./data/dev.sqlite`) and manage schema changes via `src/backend/db/migrate.ts` + `src/backend/db/migrations/*.ts`. The scaffolded helper uses `Bun.SQL` for both SQLite (`file:./data/dev.sqlite`, `sqlite:./data/dev.sqlite`, `:memory:`) and Postgres (`postgres://...`), so the same Bun-native client works across both paths without an extra `pg` install. The migration runner supports `--list`, `--status`, `--down`, and `--steps`, validates `DATABASE_MIGRATIONS_TABLE`, rejects duplicate migration ids, and runs each migration plus history update in a transaction.
- Jobs & scheduling: `src/backend/jobs/**` plus `build/backend/jobs/scheduler.js` support one-off runs, manifest export, and local watch-mode execution. On Bun `1.3.11+`, the built-in scheduler uses `Bun.cron.parse(...)` for real cron expressions and nicknames while still preserving `rate(...)` and `@reboot` schedules for local development loops. Local watch mode skips overlapping runs for the same job and disposes scheduled timers on `SIGINT`/`SIGTERM`.

## Publish Outputs
- Per page: `dist/frontend/pages/<page>/index.html`
- Fingerprinted assets: `dist/frontend/pages/<page>/index.<timestamp>.{css|js}`
- Per-page `manifest.json` listing hashed asset names.
- App assets copied to `dist/frontend/app/*`.

## Customizing Templates
- Edit templates under `orchestrators/bun/resources/templates/`.
- Treat `orchestrators/bun/resources/features/client_nav/**` as the canonical source for the built-in `client-nav` files projected into the `full` template.
- Regenerate the shipped package assets with `bun run --filter @webstir-io/webstir build` or `cd orchestrators/bun && bun scripts/sync-assets.mjs`.
- Use `bun run --filter @webstir-io/webstir check:assets` to verify the generated tree is still in sync.
- Use `bun run --filter @webstir-io/webstir check:feature-projections` to verify the exact `client-nav` template projections still match their shared feature sources.
- Keep conventions intact (page structure, base HTML `<main>`, server entry path).
- After changes, rebuild the CLI to embed updated templates.

## Related Docs
- Solution overview — [solution](../explanations/solution.md)
- Primitives — [primitives](./primitives.md)
- CLI reference — [cli](cli.md)
- Engine internals — [engine](../explanations/engine.md)
- Pipelines — [pipelines](../explanations/pipelines.md)
- Workspace and paths — [workspace](../explanations/workspace.md)
