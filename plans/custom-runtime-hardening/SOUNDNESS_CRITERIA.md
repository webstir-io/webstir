# Custom Runtime Soundness Criteria

Backlink: [EXECMAP.md](./EXECMAP.md)

This document defines what "technically sound" means for Webstir's custom runtime pieces in the current learning and agent-capability frame.

Default decision: keep custom implementations and harden them. Replacement is justified only when tests or review expose a concrete risk that is not worth owning.

## Contracts

- Key files: `packages/contracts/module-contract/src/index.ts`, `packages/contracts/testing-contract/src/index.ts`
- Owns: stable app facts for modules, routes, views, sessions, forms, fragments, jobs, and tests.
- Does not own: full framework policy, hidden runtime behavior, or compatibility promises not reflected in schemas.
- Supported behavior: schemas and TypeScript types describe the app-facing contract; generated JSON schemas match the source definitions.
- Unsupported behavior: app behavior that exists only in examples, templates, or docs but has no contract surface.
- Failure modes: schema/type drift, runtime accepting shapes the contract rejects, generated schemas lagging source, examples relying on undocumented fields.
- Minimum proof: contract builds generate schemas, examples typecheck, invalid fixtures are rejected, inspect output validates against generated schemas, and runtime/orchestrator tests exercise representative contract fields.

## Orchestrator Commands

- Key files: `orchestrators/bun/src/cli.ts`, `orchestrators/bun/src/operations.ts`, `orchestrators/bun/src/workspace.ts`
- Owns: the stable command surface for creating, inspecting, repairing, testing, watching, building, and publishing Webstir workspaces.
- Does not own: broad package-manager behavior or generic deployment platform logic.
- Supported behavior: commands reject unsupported flags, report machine-readable output where promised, and route to package-level providers.
- Unsupported behavior: silently accepting unknown modes, invoking release/publish scripts unless explicitly requested, or mutating unrelated workspace files.
- Failure modes: flag parsing drift, JSON output changing without tests, commands succeeding after partial failure, ambiguous workspace roots.
- Minimum proof: CLI integration tests for success and failure paths, `operations --json` coverage, and required gate coverage for default workflows.

## Frontend Build Pipeline

- Key files: `packages/tooling/webstir-frontend/src/builders/*`, `packages/tooling/webstir-frontend/src/pipeline.ts`, `packages/tooling/webstir-frontend/src/config/*`
- Owns: Webstir's HTML-first build/publish pipeline, page manifests, asset rewriting, opt-in feature injection, SSG/content handling, and build diagnostics.
- Does not own: becoming a full Vite/Next replacement or a general plugin ecosystem.
- Supported behavior: deterministic build and publish outputs for Webstir workspace modes, bounded feature flags, and clear diagnostics.
- Unsupported behavior: arbitrary frontend framework conventions, complex SPA routing semantics, or hidden fallback builds.
- Failure modes: stale manifests, incorrect asset paths, build/publish parity gaps, changed-file skipping that misses dependent assets, app template/page fragment validation gaps, unreported bundler errors, generated asset drift.
- Minimum proof: builder unit tests, provider parity tests, fixture builds for SPA/SSG/full outputs, asset sync checks, hashed asset cleanup checks, and browser publish proofs.

## Frontend Runtime And Boundaries

- Key files: `packages/tooling/webstir-frontend/src/runtime/boundary.ts`, `orchestrators/bun/resources/features/*`
- Owns: small client-side lifecycle helpers for Webstir-managed boundaries and opt-in progressive enhancement features.
- Does not own: a general SPA component model or arbitrary state-management framework.
- Supported behavior: explicit mount/unmount lifecycle, cleanup ordering, hot state restore when provided, opt-in feature modules, and safe fallback behavior.
- Unsupported behavior: preserving all possible browser state through navigation, nested app frameworks, or unsupported script execution semantics.
- Failure modes: cleanup leaks, double mounts, mount/unmount races, cleanup throwing before later cleanup runs, child cleanup order bugs, stale hot state, failed mount leaks, missing feature module detection, browser-only regressions.
- Minimum proof: runtime unit tests plus browser tests for boundary remounts, duplicate-handler prevention, feature opt-ins, and fallback paths.

## Client Navigation

- Key files: `orchestrators/bun/resources/features/client_nav/*`, projected copies under `orchestrators/bun/assets/features/client_nav/*`
- Owns: progressive document navigation for same-origin links and enhanced forms.
- Does not own: full client router semantics or durable client app state.
- Supported behavior: same-origin navigation, history updates, main-content swap, head/title sync, scroll/focus handling, fragment form responses, and fallback to document navigation on unsupported responses.
- Unsupported behavior: external links, downloads, new tabs, complex multipart/text fallback beyond the documented cases, and replacing non-Webstir app shells.
- Failure modes: aborted request races, failed fetch fallback, 4xx/5xx fallback, non-HTML fallback, script re-execution bugs, broken focus restoration, incorrect fragment insertion, stale head content, bad fallback behavior.
- Minimum proof: browser watch/publish tests for link navigation, form enhancement, popstate, fragment modes, URL/history/focus/head assertions, and explicit fallback cases.

## Backend Runtime Helpers

- Key files: `packages/tooling/webstir-backend/src/runtime/*`, `packages/tooling/webstir-backend/src/provider.ts`
- Owns: request handling glue, route execution, request hooks, session/form/view helpers, and Bun-backed runtime integration.
- Does not own: a general HTTP framework or all server middleware patterns.
- Supported behavior: route manifest execution, request hooks, sessions/forms/views integration, and deploy/runtime parity for supported workspace modes.
- Unsupported behavior: framework-agnostic middleware composition, arbitrary server adapters, or undocumented runtime globals.
- Failure modes: request hook ordering bugs, route output mismatch, runtime/build divergence, swallowed errors, path resolution drift.
- Minimum proof: backend runtime integration tests, deploy tests, manifest tests, and smoke tests across build and publish modes.

## Data And Migrations

- Key files: `packages/tooling/webstir-backend/templates/backend/db/*`
- Owns: a small generated-app database workflow for learning apps.
- Does not own: ORM semantics, advanced migration planning, schema diffing, or production-grade database operations.
- Supported behavior: SQLite/Postgres URL detection through Bun SQL, ordered migration loading, migration record tracking, optional rollback for migrations with `down()`, and generated example migrations.
- Unsupported behavior: automatic schema diffing, multi-node migration locking, destructive production safety automation, and hidden table-name interpolation from untrusted input.
- Failure modes: unsafe migration table names, partial migrations after schema mutation, record insertion failure after `up()`, rollback record drift, malformed exports, unordered or duplicate migration ids, missing transaction policy, corrupt migration table state, bad URL normalization.
- Minimum proof: migration unit/integration tests for status/list, apply, idempotency, rollback, `--steps`, failure recovery, duplicate ids, invalid modules, invalid table names, SQLite path resolution from non-workspace cwd, SQLite/Postgres placeholder handling where practical, and documented limits.

## Auth

- Key files: `packages/tooling/webstir-backend/templates/backend/auth/adapter.ts`, `packages/tooling/webstir-backend/templates/backend/env.ts`
- Owns: a small generated-app auth adapter and normalized Webstir auth context.
- Does not own: full identity provider behavior, OAuth flows, account recovery, MFA, or broad JWT algorithm support.
- Supported behavior: service-token auth, HS256 JWT, RS256 JWT, JWKS fetch/cache, issuer/audience/time-claim checks, and normalized scopes/roles.
- Unsupported behavior: unsupported JWT algorithms, encrypted tokens, token refresh, identity lifecycle, and provider-specific claims beyond documented mappings.
- Failure modes: accepting malformed tokens, algorithm confusion, bad key selection, JWKS timeout/fetch/cache failure ambiguity, issuer/audience bypass, invalid numeric-date types, exp/nbf mistakes, token logging leaks, network failure ambiguity.
- Minimum proof: fixture-based tests and reference checks for valid and invalid HS256/RS256/JWKS tokens, claim validation, service-token precedence, unsupported algorithms failing closed, malformed inputs, wrong keys, stale JWKS refresh, fetch failure, and non-secret diagnostics.

## Sessions And Forms

- Key files: `packages/tooling/webstir-backend/src/runtime/session.ts`, `packages/tooling/webstir-backend/src/runtime/forms.ts`, `packages/tooling/webstir-backend/templates/backend/session/*`
- Owns: signed session cookie ids, store-backed session payloads, flash, form retry state, CSRF tokens, and SQLite/in-memory generated defaults.
- Does not own: distributed session stores, account identity lifecycle, or all browser form edge cases.
- Supported behavior: in-memory and SQLite session stores, expiration, flash consumption/publishing, CSRF generation/validation, validation issue round-tripping, and production default store selection.
- Unsupported behavior: durable distributed sessions, schema migrations beyond documented store columns, and arbitrary form encodings outside supported request handling.
- Failure modes: stale cookies, tampered signatures, malformed persisted rows, corrupt runtime/flash payloads, session fixation, flash leaks, CSRF mismatch/replay, duplicate form ids, missing secure cookie defaults, expired cleanup gaps, validation redirect loops.
- Minimum proof: tests across memory and SQLite for expired/stale/tampered cookies, malformed SQLite rows, secure production defaults, CSRF mismatch, validation redirects, flash lifecycle, auth failure, and session id rotation expectations.

## Jobs

- Key files: `packages/tooling/webstir-backend/templates/backend/jobs/*`
- Owns: a local/simple scheduler and job runner for generated apps.
- Does not own: durable queues, retries, distributed scheduling, idempotency guarantees, or production worker orchestration.
- Supported behavior: manual runs, `--list`, `--json`, selected job runs, `rate(...)`, supported cron expressions, and `@reboot`.
- Unsupported behavior: persistent schedules, concurrency locks, durable retry queues, and multi-process coordination.
- Failure modes: overlapping runs, bad cron/rate parsing, unsupported schedule ambiguity, missed shutdown cleanup, missing job modules, missing `run`, swallowed job errors, ambiguous exit codes, JSON shape drift.
- Minimum proof: CLI-level tests for parsing, listing, JSON output, named job success/not-found, missing runner, one-shot jobs, repeated jobs, throwing jobs, overlap policy, shutdown behavior, and unsupported schedule diagnostics.

## Testing Package

- Key files: `packages/tooling/webstir-testing/src/*`
- Owns: Webstir-specific test discovery, runtime filtering, CLI summaries, and backend harness integration.
- Does not own: replacing Bun's test runner or becoming a generic test framework.
- Supported behavior: discovering Webstir test manifests, filtering runtimes, running tests, watch reruns, and useful summaries.
- Unsupported behavior: arbitrary test framework compatibility or hidden global test setup.
- Failure modes: discovery drift, missing compiled output silently skipped, invalid runtime filter treated as all, source/build path mismatch, event schema drift, watch flakiness, misleading summaries, backend harness lifecycle leaks.
- Minimum proof: discovery tests, CLI integration tests, event contract tests, runtime-filter negative tests, no-test/missing-build cases, watch tests, and backend harness failure coverage.

## Inspect, Doctor, Repair, Agent, And MCP

- Key files: `orchestrators/bun/src/inspect.ts`, `orchestrators/bun/src/doctor.ts`, `orchestrators/bun/src/repair.ts`, `orchestrators/bun/src/agent.ts`, `orchestrators/bun/src/mcp/*`
- Owns: agent-readable truth, scaffold drift detection, mechanical repair, validation orchestration, and MCP wrappers over stable CLI behavior.
- Does not own: inventing separate behavior from the CLI, broad autonomous coding policy, or unverified repairs.
- Supported behavior: stable JSON output, actionable issue codes, dry-run repair, scaffold-managed repair, backend/frontend inspection, agent validation, and thin MCP tool wrappers.
- Unsupported behavior: repairing arbitrary user code, masking failed checks, or MCP behavior that bypasses CLI contracts.
- Failure modes: JSON shape drift, repair overreach, corrupted scaffold files reported healthy, false healthy reports, missing issue codes, MCP wrapper divergence, JSON parse failures, validation that passes without exercising the intended subsystem.
- Minimum proof: contract-style tests for JSON shapes, repair dry-run/apply tests, unhealthy inspect tests, MCP tool tests, and generated-app validation trials.
