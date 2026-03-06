# Module Contract Plan

Goal
- Establish `@webstir-io/module-contract` as the single authority for module/provider interfaces and runtime schemas (greenfield: no migration concerns).

Scope & Principles
- Authority: `module-contract/` defines the contract; provider repos implement it. Do not duplicate core interfaces elsewhere.
- Separation of concerns: build-time provider API remains (ModuleProvider); runtime module surface (routes/views/jobs/events) lives alongside it in the same package.
- Minimal runtime deps: ship TypeScript types, Zod schemas, and generated JSON Schema; avoid adding heavy runtime dependencies to consumers.

Acceptance Criteria
- TypeScript types for Contexts, RouteSpec, ViewSpec, ModuleManifest added under `module-contract/src/` and compile.
- Zod schemas for these types exported, plus JSON Schema emitted to `module-contract/schema/*` during build.
- Helper creators `createModule`, `defineRoute`, `defineView` provide strong inference and pass compile-time tests.
- Example module (Accounts) compiles and validates using only `module-contract` exports.
- No breaking changes to existing `ModuleProvider` interfaces; README reflects new surfaces and build steps.

Validation & Errors
- Library: use Zod for runtime validation; publish Zod objects and JSON Schema (via build step) for non-TS consumers.
- Error taxonomy: `ValidationError`, `AuthError` (unauthorized/forbidden), `NotFoundError`, `DomainError`.
- Error shape: `{ code: string; message: string; details?: unknown; cause?: unknown; correlationId?: string }`.
- Map to HTTP: 400 validation, 401/403 auth, 404 not found, 409 conflict (domain), 422 semantic; default 500.

Contexts & Provider Authority
- RequestContext: `{ req, res, auth, session, db, env, logger, requestId, now }`.
- SSRContext (optional): `{ url, params, cookies, headers, auth, session, env, logger }`.
- Provider interfaces (authoritative definitions live here):
  - BackendProvider: implements build + exposes route handlers bound to RequestContext.
  - TestingProvider: emits testing events and manifest types.
  - AuthProvider: session primitives `getSession`, `createSession`, `invalidateSession`, `csrfToken`.
  - DatabaseProvider: generic `db` handle with minimal query/tx abstraction; avoid binding to a specific ORM.
  - Optional: CacheProvider, QueueProvider (thin, capability flags in manifest).
- Logging: `Logger` interface with levels, structured fields, `with({})`, and correlation/request IDs.
- Config/Env: `Env` accessor interface for typed retrieval and secret hints.

Manifest & Capabilities
- ModuleManifest: `{ name, version, kind: 'frontend'|'backend', routes?, views?, jobs?, events?, services?, init?, dispose?, capabilities?: string[], contractVersion: '1.x' }`.
- Capabilities: enumerate features (e.g., `auth`, `db`, `queue`, `cache`, `views`) for orchestrator wiring.
- Versioning: single `contractVersion` string; reserve feature flags per capability for evolution.

Routes & Views
- RouteSpec: `{ method, path, input: { params?, query?, body? }, output: { status, body }, handler(ctx) }` with Zod schemas for `input/output`.
- ViewSpec: `{ path, params?, load(ctx) }` for SSR/loader-style data.
- ts-rest integration: provide an optional adapter `fromTsRest(route)` and (later) typed client generation; `ts-rest` remains an optional peer for providers, not a hard dep of the contract.

Discovery & Helpers
- Discovery: `package.json` top-level `"webstir.moduleManifest"` object with `{ kind, entry }`. Orchestrator discovers by this field and validates against JSON Schema.
- Helpers: `createModule({ manifest, routes, views, ... })`, `defineRoute({...})`, `defineView({...})` with strong generics and Zod-powered inference.

Types, Examples & Tests
- Location: `module-contract/src/` for types + Zod; JSON Schema emitted to `module-contract/schema/`.
- Example: `examples/accounts` (or colocated `examples/` folder) defining 1–2 routes and one view using helpers.
- Conventions doc additions: route naming, status codes, pagination/filter conventions, error codes.
- Tests: unit tests for helper inference + runtime validation; compile-time checks using `tsd` or `expectTypeOf`.

Non-Goals (for now)
- Cross-repo migration/rollout — not needed; no active consumers.
- Rich ORM/auth implementations — keep provider interfaces minimal and portable.

Implementation Notes
- Update `module-contract/README.md` with new surfaces and build instructions.
- Ensure build regenerates JSON Schema when Zod_types change; fail CI on drift.
- Keep `ModuleProvider` (build-time) unchanged to support orchestrator integration.
