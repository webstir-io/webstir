# Goal
- Goal: finish the remaining progressive-enhancement work from [`progressive-enhancement-direction.md`](./progressive-enhancement-direction.md) and turn Webstir's current fragment/redirect foundation into a production-ready HTML-first application path.

# Constraints And Assumptions
- Preserve the no-JavaScript baseline for forms, links, redirects, and document navigation.
- Keep the direction doc as the product intent; this file is the execution plan for repeated `plan-cycle` runs.
- Prefer canonical changes in `packages/**`, `apps/portal/docs/**`, and `examples/demos/**`; do not treat `orchestrators/dotnet/**` as a sync target.
- Keep each item small enough to finish in one fresh-context `flow` cycle with package-local validation first.
- Favor HTML-first request handling over React-first abstractions or SPA-only escapes.

# Status Summary
- Overall status: active
- Last updated: 2026-03-11
- Notes:
  - Foundation already landed for route metadata, redirect/fragment runtime handling, enhanced form submission in `client-nav`, and the canonical form-flow demo.
  - This plan only tracks the remaining work after that initial slice.
  - Iteration 1 split the original contract-primitives umbrella after scanning `packages/contracts/module-contract`, generated schema output, and backend runtime templates; the previous item mixed metadata, handler results, and docs/examples into one flow cycle.
  - Iteration 2 completed the first contract slice in `@webstir-io/module-contract`, adding explicit request-hook declarations plus route/form session-flash metadata with regenerated schema output.
  - First ready item: 2

# Latest Cycle
- Iteration: 2
- Selected item: 1. Add Request Hook And Session/Flash Contract Metadata
- Outcome: completed the scoped `module-contract` slice by replacing manifest `middlewares` with explicit `requestHooks`, adding route/form `session` and `flash` metadata, regenerating JSON schema, and updating the package README/example. Slop and review passes found no blocking issues. Yeet/yoink did not run because this workspace still contains unrelated untracked `.plan-cycle/` state and the environment cannot safely complete push/PR work.
- Checks run:
  - `git status --short`
  - `git diff --stat`
  - `git diff --name-only --diff-filter=ACMR`
  - `git diff --cached`
  - `sed -n '1,340p' packages/contracts/module-contract/src/index.ts`
  - `sed -n '1,260p' packages/contracts/module-contract/README.md`
  - `sed -n '1,220p' packages/contracts/module-contract/examples/accounts/module.ts`
  - `rg -n "request hook|requestHook|requestHooks|middleware|middlewares" packages apps examples -g '!orchestrators/**'`
  - `rg -n "flash|session" packages/tooling packages/contracts examples apps -g '!orchestrators/**'`
  - `bun run build`
  - `bun run test`
  - `shasum -a 256 apps/portal/docs/product/plans/framework/progressive-enhancement-plan.md`
- Branch: none
- Commit: none
- PR: none
- Follow-up notes:
  - Backend scaffold and Fastify runtime templates still do not consume `requestHooks` and still hardcode `session: null`; items 3 and 4 are now the first runtime consumers of the new contract surface.
  - `moduleManifestSchema` and `routeDefinitionSchema` remain non-strict at the top level, so hard rejection of legacy unknown keys would be a separate follow-up decision rather than part of this slice.

# Plan Items
## 1. Add Request Hook And Session/Flash Contract Metadata
- Status: done
- Depends on: none
- Scope: extend `@webstir-io/module-contract` with explicit request-hook declarations and session/flash authoring metadata in route and module definitions, replacing the current implicit middleware and runtime-only conventions.
- Done when:
  - Module definitions can declare request hooks with explicit identity and ordering metadata instead of only opaque middleware strings.
  - Route or form definitions can declare the session/flash metadata needed by follow-on runtime work.
  - `@webstir-io/module-contract` builds with regenerated schema artifacts for the new metadata surface.
- Progress:
  - 2026-03-11: Split out of the original umbrella after reviewing the module-contract source, README, example module, and backend scaffold templates.
  - 2026-03-11: Added `requestHooks` metadata on module manifests and routes, added `session`/`flash` declarations for routes and forms, and regenerated `schema/module-manifest.schema.json` plus `schema/route-definition.schema.json`.
  - 2026-03-11: Updated the package README and Accounts example to exercise the new contract surface, then verified with `bun run build` and `bun run test` in `packages/contracts/module-contract`.

## 2. Expand Progressive-Enhancement Handler Results And Contract Docs
- Status: todo
- Depends on: 1
- Scope: extend route output and handler result contracts for the missing progressive-enhancement response cases, then refresh generated schema, README guidance, and package examples to match.
- Done when:
  - Handler result types cover the progressive-enhancement cases that still require runtime-only behavior or undocumented conventions.
  - Generated schema output reflects the richer response shapes.
  - Package docs/examples show the supported response variants clearly.
- Progress:
  - Not started.

## 3. Execute Request Hooks In Backend Runtimes
- Status: todo
- Depends on: 1
- Scope: wire middleware or request-hook execution through the default backend scaffold and the Fastify scaffold with deterministic ordering, short-circuit behavior, and shared request context handoff.
- Done when:
  - Both runtime scaffolds execute request hooks around route handlers using the contract from item 1.
  - Hook failures and early exits produce consistent responses and logging.
  - Runtime tests cover ordering, short-circuiting, and per-request context propagation.
- Progress:
  - Not started.

## 4. Resolve Session And Flash State
- Status: todo
- Depends on: 1, 2, 3
- Scope: replace the hardcoded `session: null` path with real session resolution, cookie plumbing, and a minimal flash-message transport that works across redirects and document renders.
- Done when:
  - Request and SSR contexts can read resolved session state instead of always receiving `null`.
  - Redirect and document flows can carry flash messages without custom app code.
  - Tests cover session creation, lookup, invalidation, and flash delivery semantics.
- Progress:
  - Not started.

## 5. Add Form Workflow Ergonomics
- Status: todo
- Depends on: 2, 3, 4
- Scope: make validation errors, redirect-after-post, CSRF checks, and auth-aware form handling first-class in the default backend scaffold and supporting examples.
- Done when:
  - Scaffold/runtime helpers exist for validation error presentation, CSRF enforcement, flash-backed redirect-after-post, and auth-aware mutations.
  - The canonical form flow demonstrates both the no-JavaScript baseline and the enhanced path with the new ergonomics.
  - Package-local tests cover success, validation failure, CSRF failure, and auth-gated submissions.
- Progress:
  - Not started.

## 6. Harden Fragment Update Behavior
- Status: todo
- Depends on: 3, 5
- Scope: harden fragment handling across `client-nav` and backend responses, especially missing targets, malformed headers, non-HTML payloads, and replace/append/prepend edge cases.
- Done when:
  - Fragment behavior is explicit for missing-target, invalid-metadata, and fallback-to-document cases.
  - `client-nav` and backend runtime tests cover the supported fragment modes and failure paths.
  - The enhanced path preserves correct document behavior when fragment application is skipped.
- Progress:
  - Not started.

## 7. Add Browser-Level Progressive Enhancement Coverage
- Status: todo
- Depends on: 5, 6
- Scope: add browser-level integration coverage for progressive-enhancement flows in watch and publish mode, including redirects, fragment updates, focus/scroll behavior, auth/session flows, and `/api` proxy handling.
- Done when:
  - End-to-end browser tests cover the core progressive-enhancement flows instead of relying only on unit/runtime assertions.
  - Watch and publish integration suites both exercise the canonical HTML form workflows.
  - Known flaky coverage gaps are removed or explicitly documented as blockers.
- Progress:
  - Not started.

## 8. Implement Request-Time HTML Rendering
- Status: todo
- Depends on: 3, 4
- Scope: build the request-time HTML rendering path for backend views so Webstir can serve server-rendered documents directly, not only SSG metadata and `view-data.json`.
- Done when:
  - The built-in backend server can resolve view definitions and render HTML at request time.
  - The Fastify scaffold supports the same request-time view flow.
  - End-to-end tests cover request-time document rendering with real SSR context.
- Progress:
  - Not started.

## 9. Define Runtime Cache And Invalidation Ergonomics
- Status: todo
- Depends on: 6, 8
- Scope: close the gap between existing build/cache metadata and the missing request/runtime cache story for documents and fragments.
- Done when:
  - Runtime cache behavior and invalidation rules are explicit for page and fragment responses.
  - Application authors have a supported way to understand what is cached, where it lives, and when it invalidates.
  - Tests and docs cover correctness expectations for stale and refreshed document/fragment content.
- Progress:
  - Not started.

## 10. Add An Auth And CRUD Proof App
- Status: todo
- Depends on: 5, 7, 8
- Scope: add a canonical end-to-end application that proves sessions, auth gates, validation errors, redirect-after-post, and CRUD backoffice flows on top of the progressive-enhancement model.
- Done when:
  - A new demo under `examples/demos/*` exercises auth and CRUD workflows with no-JavaScript and enhanced paths.
  - Watch and publish validation covers the demo's main flows.
  - The demo is suitable to reference from docs as the canonical example for server-handled forms.
- Progress:
  - Not started.

## 11. Add A Dashboard Proof App And Refresh Docs
- Status: todo
- Depends on: 6, 8, 9, 10
- Scope: add a second proof application for dashboard-style partial refreshes, then reframe package READMEs and portal docs around HTML-first delivery, forms, fragments, sessions, caching, navigation, and deployment.
- Done when:
  - A dashboard-oriented demo proves partial refresh behavior without forcing SPA architecture.
  - `@webstir-io/webstir-frontend`, `@webstir-io/webstir-backend`, and portal docs center the HTML-first application story instead of the older experimental-pipeline framing.
  - Key docs link to the proof applications and describe the shipped runtime/cache/form model accurately.
- Progress:
  - Not started.
