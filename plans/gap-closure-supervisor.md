# Webstir Gap Closure Supervisor

## Goal

Close the current high-impact Webstir gaps identified in the active Bun-first product surface:

- deployment story and active deploy docs
- hot-update and fragment ownership limits
- top-level CLI/extensibility narrowness
- lightweight backend runtime defaults
- tooling maturity gaps

Done means each area has either:

- an implemented improvement with local validation, or
- a concrete blocker documented with the exact remaining decision or dependency.

## Done

- Mission established.
- Milestone order set.
- Deployment/docs gap closed with a Bun-owned sandbox helper:
  - added deployment source files under `orchestrators/bun/resources/deployment/sandbox`
  - synced generated package assets under `orchestrators/bun/assets/deployment/sandbox`
  - updated active docs to point at the Bun-first helper instead of archived sandbox paths
- Hot-update gap narrowed for the existing docs-sidebar pilot:
  - incremental content rebuild now reacts to `src/frontend/content/_sidebar.json`
  - SSG watch now emits a targeted docs-sidebar HMR remount for that manifest input
  - docs page hot-remount invalidates the cached nav manifest before remount
  - browser and package tests cover the `_sidebar.json` path
- CLI/extensibility gap narrowed with a top-level publish override:
  - `webstir publish` now accepts `--frontend-mode <bundle|ssg>`
  - the Bun CLI threads the override through the existing frontend provider surface
  - publish docs and CLI reference now document the top-level override path
- Backend runtime defaults improved with a lower-friction durable session path:
  - the scaffold now treats `SESSION_STORE_URL` as an implicit SQLite session-store opt-in
  - session-store tests cover both the explicit driver path and the URL-only path
  - backend runtime docs now call out the new durable-session shortcut
- Tooling maturity improved with a real testing-package smoke:
  - `@webstir-io/webstir-testing` now runs a temp-workspace CLI smoke instead of a no-op placeholder
  - the repo required check plan now includes that smoke
  - testing docs and package status language were updated to match the current validation story
- Backend auth now supports a real asymmetric path:
  - bearer-token verification now supports HS256 plus RS256 through inline/file-backed public keys and JWKS discovery
  - scaffold runtime auth resolution is async across the built-in, Bun, and Fastify servers
  - env loading resolves `AUTH_JWT_PUBLIC_KEY_FILE` from the workspace root and tests cover RSA/JWKS behavior
- Backend production-session defaults are now stricter:
  - `SESSION_SECRET` is required when `NODE_ENV=production`
  - production defaults to SQLite-backed sessions when `SESSION_STORE_DRIVER` is unset
  - `SESSION_STORE_DRIVER=memory` remains the explicit non-durable escape hatch
- Job scheduling now hands off to external schedulers more cleanly:
  - the scaffold scheduler exposes `--json` to export machine-friendly job metadata
  - watcher warnings now point directly at `--json` for external scheduling flows
  - docs use the Bun-first scheduler commands consistently
- Tooling policy now has an active formatter baseline:
  - the repo ships a scoped `biome.json` for the active Bun/TypeScript surfaces
  - root scripts expose `bun run format`, `bun run check:biome`, and `bun run lint`
  - the required check plan now starts with `bun run check:biome` and `bun run lint`
- Biome lint cleanup has a first reduction pass:
  - the repo-wide `bun run lint` command now passes cleanly across the scoped Bun/TypeScript surface
  - low-risk lint fixes landed across the Bun CLI/orchestrator, testing package, contract generics, selected backend helpers/templates, selected frontend files, and orchestrator test files
  - the formatter rollout is now paired with a clean required lint sweep

## Next

- Optional follow-up: broader provider-selection surfaces beyond `--frontend-mode`
- Optional follow-up: persisted or distributed backend primitives beyond single-node SQLite sessions and process-local HTML cache

## Checks

- `git status --short` clean at start
- `bun orchestrators/bun/scripts/sync-assets.mjs`
- `WEBSTIR_WORKSPACE=/Users/iamce/dev/webstir-io/webstir docker compose -f orchestrators/bun/assets/deployment/sandbox/docker-compose.yml config`
- `bun run --filter webstir-portal build`
- `rg -n "CLI/out/seed|orchestrators/dotnet/Sandbox|Sandbox/" README.md apps/portal/docs orchestrators/bun/assets/deployment/sandbox orchestrators/bun/resources/deployment/sandbox`
- `bun run --filter @webstir-io/webstir-frontend build`
- `bun test packages/tooling/webstir-frontend/tests/content-pages.test.js`
- `bun test orchestrators/bun/tests/ssg-watch.integration.test.ts`
- `bun test orchestrators/bun/tests/build.test.ts`
- `bun test orchestrators/bun/tests/cli.integration.test.ts`
- `bun test packages/tooling/webstir-backend/tests/sessionScaffoldStore.test.js`
- `bun test packages/tooling/webstir-backend/tests/envLoader.test.js`
- `bun test packages/tooling/webstir-backend/tests/integration.test.js -t jwt`
- `bun test packages/tooling/webstir-backend/tests/integration.test.js -t rsa`
- `bun test packages/tooling/webstir-backend/tests/manifest.test.js`
- `bun test tools/tests/check-plan.test.mjs`
- `bun run test:tools`
- `bun run check:biome`
- `bun run lint`
- `bun run lint -- --max-diagnostics=60`
- `bun run lint -- --max-diagnostics=20`
- `bun run lint -- --max-diagnostics=80`
- `bun run --filter @webstir-io/webstir-testing build`
- `bun run --filter @webstir-io/webstir-testing test`
- `bun run --filter @webstir-io/webstir-testing smoke`
- `bun run --filter @webstir-io/module-contract test`
- `bun run --filter @webstir-io/webstir-backend build`
- `bun run --filter @webstir-io/webstir-testing test`
- `bun run --filter @webstir-io/webstir-backend test`
- `bun run --filter @webstir-io/webstir-frontend test`
- `bun test orchestrators/bun/tests/backend-add.integration.test.ts orchestrators/bun/tests/dev-server.test.ts orchestrators/bun/tests/enable.integration.test.ts orchestrators/bun/tests/init.integration.test.ts orchestrators/bun/tests/smoke.integration.test.ts orchestrators/bun/tests/watch-events.test.ts`
- `bun test packages/tooling/webstir-backend/tests/cacheReporter.test.js packages/tooling/webstir-backend/tests/manifest.test.js`
- `bun test packages/tooling/webstir-frontend/tests/runtime.test.js packages/tooling/webstir-frontend/tests/content-pages.test.js packages/tooling/webstir-frontend/tests/hooks.test.js`
- `bun test orchestrators/bun/tests/backend-add.integration.test.ts orchestrators/bun/tests/dev-server.test.ts orchestrators/bun/tests/enable.integration.test.ts orchestrators/bun/tests/full-watch.integration.test.ts orchestrators/bun/tests/init.integration.test.ts orchestrators/bun/tests/runtime-boundary.integration.test.ts orchestrators/bun/tests/smoke.integration.test.ts orchestrators/bun/tests/watch-events.test.ts`

## Risks

- This pass narrows each gap with one bounded improvement; it does not redesign every related subsystem.
- Request-time HTML cache still remains process-local, and the built-in scheduler is still intentionally a local runner rather than a distributed job system.
- Future Biome rule additions could still create churn, but the current scoped lint baseline is clean and now sits in the required gate.

## Delivery State

local only
