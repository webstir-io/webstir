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
- Last updated: 2026-03-13
- Notes:
  - Foundation already landed for route metadata, redirect/fragment runtime handling, enhanced form submission in `client-nav`, and the canonical form-flow demo.
  - This plan only tracks the remaining work after that initial slice.
  - Iteration 1 split the original contract-primitives umbrella after scanning `packages/contracts/module-contract`, generated schema output, and backend runtime templates; the previous item mixed metadata, handler results, and docs/examples into one flow cycle.
  - Iteration 2 completed the first contract slice in `@webstir-io/module-contract`, adding explicit request-hook declarations plus route/form session-flash metadata with regenerated schema output.
  - Iteration 3 completed the second contract slice in `@webstir-io/module-contract`, adding multi-response route output declarations plus explicit fragment body schemas and progressive-enhancement handler result aliases.
  - Iteration 4 completed backend runtime request-hook execution across the default scaffold and Fastify scaffold, adding shared hook-phase ordering helpers plus focused scaffold tests for ordering, short-circuit, and context handoff.
  - Iteration 5 completed backend session and flash runtime plumbing across the default scaffold and Fastify scaffold, adding shared cookie-backed session helpers, redirect-safe flash delivery, and focused scaffold tests for login, read, consume, and logout flows.
  - Iteration 6 revalidated the session/flash slice locally, fixed Fastify's bundled module-discovery path, and reran package-local checks with both default and Fastify runtime integration cases passing.
  - Iteration 7 completed backend form-workflow ergonomics by adding a shared forms runtime helper, scaffold example coverage for CSRF-protected redirect-after-post flows, and package-local tests for auth, validation, CSRF, and success cases across both servers.
  - Item 6 was split into smaller fragment-hardening slices so fresh `plan-cycle` runs can stay within one runtime surface plus one validation surface.
  - Iteration 14 completed item 6 by normalizing backend fragment metadata in both server scaffolds, converting invalid fragment responses into explicit `invalid_fragment_response` errors, and adding runtime coverage for missing target, invalid mode, invalid selector, and missing body cases.
  - Iteration 15 completed item 7 by making `client-nav` treat invalid fragment headers, missing targets, and non-HTML mutation responses as explicit document-navigation fallbacks, with Bun-level coverage on the feature-source copies.
  - Iteration 16 completed item 8 by making fragment insertion explicit for replace-target vs child replacement, unwrapping matching-root append/prepend payloads into target children, and limiting autofocus/script work to newly inserted roots in the canonical demo plus Bun feature-source copies.
  - Iteration 17 completed item 9 by syncing the hardened `client_nav` feature sources into the shipped Bun assets and widening the canonical backend demo coverage so the redirect baseline and fragment payload shape are both asserted.
  - Iteration 18 completed item 10 by adding browser-level watch and publish coverage for the canonical progressive-enhancement demo, fixing proxy redirect rewriting for `/api`-mounted no-JavaScript flows, and extending the demo page so session/auth fragments and focus targets are observable in real browsers.
  - Iteration 19 completed item 11 by adding request-time backend view rendering through the default server and Fastify scaffold, using live SSR context plus built frontend documents instead of only emitting SSG `view-data.json`.
  - Iteration 20 completed item 12 by adding process-local request-time document caching with explicit invalidation on built HTML changes, uncached fragment response headers, and package/docs coverage for miss/hit/stale behavior.
  - Iteration 21 completed item 13 by adding a dedicated auth-and-CRUD proof demo with server-handled sign-in, validation recovery, redirect-after-post, and fragment-enhanced create/update/delete flows plus watch/publish coverage.
  - First ready item: 14

# Latest Cycle
- Iteration: 21
- Selected item: 13. Add An Auth And CRUD Proof App
- Outcome: added a dedicated full-stack auth and CRUD proof demo with server-handled sign-in, validation, redirect-after-post, and fragment-enhanced create/update/delete flows, then covered it through workspace tests plus watch/publish browser validation.
- Checks run:
- `bun run webstir -- test --workspace "$PWD/examples/demos/auth-crud"`
- `bun run webstir -- publish --workspace "$PWD/examples/demos/auth-crud"`
- `bun test orchestrators/bun/tests/auth-crud.browser.integration.test.ts`
- `bun test orchestrators/bun/tests/cli.integration.test.ts -t "auth-crud demo workspace"`
- Branch: `codex/item-13-auth-crud-proof-app`
- Commit: none
- PR: none
- Follow-up notes:
  - `examples/demos/auth-crud` is now the canonical proof app for HTML-first auth and CRUD flows, with auth gates, validation recovery, fragment updates, and no-JavaScript redirects sharing the same forms.
  - Watch and publish browser coverage now exercise the demo through real sign-in, create, update, delete, and no-JavaScript fallback paths.
  - The first ready slice is now item 14 for the dashboard proof application and broader doc refresh.

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
- Status: done
- Depends on: 1
- Scope: extend route output and handler result contracts for the missing progressive-enhancement response cases, then refresh generated schema, README guidance, and package examples to match.
- Done when:
  - Handler result types cover the progressive-enhancement cases that still require runtime-only behavior or undocumented conventions.
  - Generated schema output reflects the richer response shapes.
  - Package docs/examples show the supported response variants clearly.
- Progress:
  - 2026-03-11: Added `output.responses` plus explicit fragment body schema references in `@webstir-io/module-contract`, and exported `RouteNavigationResult`/`RouteMutationResult` aliases for the common navigation and mutation handler patterns.
  - 2026-03-11: Updated the package README and Accounts example to show one route returning a fragment for enhanced requests and a redirect for the no-JavaScript baseline.
  - 2026-03-11: Regenerated `schema/route-output.schema.json`, `schema/route-definition.schema.json`, and `schema/module-manifest.schema.json`, then verified with `bun run build` and `bun run test` in `packages/contracts/module-contract`.

## 3. Execute Request Hooks In Backend Runtimes
- Status: done
- Depends on: 1
- Scope: wire middleware or request-hook execution through the default backend scaffold and the Fastify scaffold with deterministic ordering, short-circuit behavior, and shared request context handoff.
- Done when:
  - Both runtime scaffolds execute request hooks around route handlers using the contract from item 1.
  - Hook failures and early exits produce consistent responses and logging.
  - Runtime tests cover ordering, short-circuiting, and per-request context propagation.
- Progress:
  - 2026-03-11: Added a shared scaffold helper for resolving route-level request-hook references against manifest metadata, sorting hooks by phase/order, and executing early-response plus after-handler result flows.
  - 2026-03-11: Wired `beforeAuth`, `beforeHandler`, and `afterHandler` execution through both backend server templates, including auth-resolution handoff, consistent early-exit/error responses, and scaffold asset updates for the new runtime helper.
  - 2026-03-11: Updated the backend scaffold example module and added focused `webstir-backend` tests for hook ordering, short-circuiting, failure responses, context propagation, and default/Fastify scaffold builds; `bun run test` skipped live TCP-listener cases in this sandbox.

## 4. Resolve Session And Flash State
- Status: done
- Depends on: 1, 2, 3
- Scope: replace the hardcoded `session: null` path with real session resolution, cookie plumbing, and a minimal flash-message transport that works across redirects and document renders.
- Done when:
  - Request and SSR contexts can read resolved session state instead of always receiving `null`.
  - Redirect and document flows can carry flash messages without custom app code.
  - Tests cover session creation, lookup, invalidation, and flash delivery semantics.
- Progress:
  - 2026-03-11: Added `runtime/session.ts` to the backend scaffold with signed cookie parsing, in-memory session storage, session invalidation, and route/form-driven flash publish-consume semantics.
  - 2026-03-11: Wired resolved `ctx.session` and `ctx.flash` through both `templates/backend/index.ts` and `templates/backend/server/fastify.ts`, including response-time `Set-Cookie` handling and new session env defaults in the scaffold.
  - 2026-03-11: Added focused `webstir-backend` helper tests plus default/Fastify scaffold runtime coverage for creation, lookup, invalidation, and flash transport.
  - 2026-03-11: Revalidated the slice by fixing Fastify's bundled module-discovery path and rerunning `bun run build` and `bun run test` in `packages/tooling/webstir-backend`, with all 22 package tests passing locally.

## 5. Add Form Workflow Ergonomics
- Status: done
- Depends on: 2, 3, 4
- Scope: make validation errors, redirect-after-post, CSRF checks, and auth-aware form handling first-class in the default backend scaffold and supporting examples.
- Done when:
  - Scaffold/runtime helpers exist for validation error presentation, CSRF enforcement, flash-backed redirect-after-post, and auth-aware mutations.
  - The canonical form flow demonstrates both the no-JavaScript baseline and the enhanced path with the new ergonomics.
  - Package-local tests cover success, validation failure, CSRF failure, and auth-gated submissions.
- Progress:
  - 2026-03-11: Added `runtime/forms.ts` to the backend scaffold with CSRF token issuance, redirect-after-post validation state storage, field/form issue grouping, and auth-aware mutation guards that reuse the existing session runtime.
  - 2026-03-11: Updated the scaffold example module to demonstrate an HTML-first account-settings form with inline validation, CSRF hidden inputs, success flash delivery, and auth-gated form submission.
  - 2026-03-11: Updated the backend build pipeline so scaffold `module.ts` files can import local runtime helpers, then added package-local tests for direct form-helper behavior plus default/Fastify runtime flows covering auth failure, validation failure, CSRF failure, and success with `bun run build` and `bun run test`.

## 6. Harden Backend Fragment Response Validation
- Status: done
- Depends on: 3, 5
- Scope: tighten fragment response validation and fallback behavior in `packages/tooling/webstir-backend/templates/backend/index.ts`, `packages/tooling/webstir-backend/templates/backend/server/fastify.ts`, and `packages/tooling/webstir-backend/tests/integration.test.js` without changing client-nav behavior yet.
- Done when:
  - Backend runtimes handle malformed or incomplete fragment metadata explicitly instead of silently emitting ambiguous headers and bodies.
  - Default-server and Fastify integration tests cover the supported backend fragment failure paths.
  - Non-fragment document behavior remains unchanged for valid redirect and full-document responses.
- Progress:
  - 2026-03-11: Added shared fragment-result normalization in the default scaffold and Fastify scaffold so empty targets, invalid modes/selectors, and missing bodies become explicit `invalid_fragment_response` errors instead of ambiguous fragment headers or empty payloads.
  - 2026-03-11: Extended `packages/tooling/webstir-backend/tests/integration.test.js` with default-server and Fastify runtime cases covering the valid redirect/fragment path plus missing target, invalid mode, invalid selector, and missing body failures.
  - 2026-03-11: Verified the slice with `bun run build` and `bun run test` in `packages/tooling/webstir-backend`, with all 26 package tests passing locally across both scaffold servers.

## 7. Harden Client-Nav Missing-Target And Non-HTML Fallbacks
- Status: done
- Depends on: 5, 6
- Scope: make `client-nav` explicit about missing targets, invalid fragment metadata, and non-HTML responses in `examples/demos/full/src/frontend/app/scripts/features/client-nav.ts`, `examples/demos/full/src/frontend/app/scripts/features/form-enhancement.ts`, and `orchestrators/bun/resources/features/client_nav/*`.
- Done when:
  - Enhanced form submissions fall back to correct document navigation when fragment application is skipped.
  - Missing-target and non-HTML cases have direct Bun-level coverage in `orchestrators/bun/tests`.
  - The mirrored demo client-nav code and Bun asset sources stay behaviorally aligned.
- Progress:
  - 2026-03-11: Added explicit fragment-metadata resolution in the canonical demo and Bun feature-source `form-enhancement` helpers so blank targets, blank selectors, and unsupported fragment modes are treated as invalid instead of being silently coerced.
  - 2026-03-11: Updated the canonical demo and Bun feature-source `client-nav` helpers to resolve mutation responses through explicit fragment/document/navigation branches, including document-navigation fallback when fragment targets are missing or the response is non-HTML.
  - 2026-03-11: Added Bun-level coverage for invalid fragment metadata, missing-target fallback, and non-HTML fallback decisions, then verified the canonical demo and Bun feature-source copies stayed identical.

## 8. Cover Replace/Append/Prepend Fragment Edge Cases
- Status: done
- Depends on: 7
- Scope: harden replace-versus-child-replacement behavior plus append/prepend edge cases in `examples/demos/full/src/frontend/app/scripts/features/client-nav.ts`, `examples/demos/full/src/frontend/app/scripts/features/form-enhancement.ts`, and `orchestrators/bun/tests/client-nav-form.test.ts`.
- Done when:
  - Fragment application rules are explicit for matching roots, child replacement, and multi-root payloads.
  - Replace, append, and prepend behavior have direct tests for the supported edge cases.
  - Fragment updates still execute scripts and autofocus handling on the correct inserted roots.
- Progress:
  - 2026-03-12: Added `resolveFragmentInsertionBehavior` to the canonical demo and Bun feature-source `form-enhancement` helpers so replace-target, child replacement, and matching-root append/prepend unwrapping are resolved explicitly, including a guard for meaningful top-level sibling content.
  - 2026-03-12: Updated the canonical demo and Bun feature-source `client-nav` helpers to apply fragment payloads with the new insertion behavior and scope autofocus/script re-execution to newly inserted roots instead of the whole target container.
  - 2026-03-12: Extended `orchestrators/bun/tests/client-nav-form.test.ts` with direct Bun coverage for replace-target vs child replacement, append/prepend matching-root unwrapping, and sibling-content fallback to full payload insertion.

## 9. Sync Fragment Hardening Into Bun Assets And Canonical Demo Coverage
- Status: done
- Depends on: 7, 8
- Scope: propagate the fragment-hardening behavior into mirrored Bun assets and canonical demo coverage via `orchestrators/bun/scripts/sync-assets.mjs`, `orchestrators/bun/assets/features/client_nav/*`, and `examples/demos/full/src/backend/tests/progressive-enhancement.test.ts`.
- Done when:
  - Generated/shipped client-nav assets reflect the same fragment behavior as the canonical source files.
  - The full demo coverage proves the no-JavaScript baseline still works after the hardening changes.
  - The fragment-hardening slice is complete enough that browser-level coverage can build on it without re-opening runtime behavior questions.
- Progress:
  - 2026-03-12: Regenerated `orchestrators/bun/assets/features/client_nav/*` from the hardened feature-source copies so the shipped Bun assets now match the canonical fragment metadata, fallback, and insertion behavior.
  - 2026-03-12: Expanded `examples/demos/full/src/backend/tests/progressive-enhancement.test.ts` to assert the no-JavaScript redirect baseline, redirected document render, and fragment-only enhanced response shape.
  - 2026-03-12: Verified the slice with canonical-to-resource diffs, resource-to-asset diffs, `bun test tests/client-nav-form.test.ts`, `bun x tsc -p examples/demos/full/src/backend/tsconfig.json --noEmit`, and `bun run webstir -- test --workspace "$PWD/examples/demos/full" --runtime backend`.

## 10. Add Browser-Level Progressive Enhancement Coverage
- Status: done
- Depends on: 5, 6, 7, 8, 9
- Scope: add browser-level integration coverage for progressive-enhancement flows in watch and publish mode, including redirects, fragment updates, focus/scroll behavior, auth/session flows, and `/api` proxy handling.
- Done when:
  - End-to-end browser tests cover the core progressive-enhancement flows instead of relying only on unit/runtime assertions.
  - Watch and publish integration suites both exercise the canonical HTML form workflows.
  - Known flaky coverage gaps are removed or explicitly documented as blockers.
- Progress:
  - 2026-03-12: Expanded `examples/demos/full/src/backend/index.ts` with a cookie-backed session/auth panel plus fragment-focus hooks so browser tests can observe session persistence, fragment replacement, and autofocus behavior without adding a separate proof app.
  - 2026-03-12: Added `orchestrators/bun/tests/progressive-enhancement.browser.integration.test.ts` to drive the canonical demo through real-browser watch and publish flows, covering `/api` proxy navigation, enhanced fragment updates, document scroll resets, focus handoff, cookie-backed auth/session persistence, and no-JavaScript redirect-after-post behavior.
  - 2026-03-12: Updated `orchestrators/bun/src/dev-server.ts` so proxied backend redirects rewrite back onto the `/api` mount, then verified the full Bun orchestrator package and the canonical backend demo tests end to end.

## 11. Implement Request-Time HTML Rendering
- Status: done
- Depends on: 3, 4
- Scope: build the request-time HTML rendering path for backend views so Webstir can serve server-rendered documents directly, not only SSG metadata and `view-data.json`.
- Done when:
  - The built-in backend server can resolve view definitions and render HTML at request time.
  - The Fastify scaffold supports the same request-time view flow.
  - End-to-end tests cover request-time document rendering with real SSR context.
- Progress:
  - 2026-03-12: Added `templates/backend/runtime/views.ts` plus scaffold asset wiring so backend views can resolve the matching built frontend document, execute their loader with live SSR context, and inject serialized request-time view state into the HTML response.
  - 2026-03-12: Wired the built-in backend server and the Fastify scaffold to fall through from unmatched GET/HEAD requests into the shared view runtime, preserving route precedence while serving request-time documents from compiled view definitions.
  - 2026-03-12: Added package-local runtime coverage for default and Fastify scaffolds, proving request-time view rendering with live session/auth/request headers, then revalidated with `bun run test` and `bun run smoke` in `packages/tooling/webstir-backend`.

## 12. Define Runtime Cache And Invalidation Ergonomics
- Status: done
- Depends on: 9, 11
- Scope: close the gap between existing build/cache metadata and the missing request/runtime cache story for documents and fragments.
- Done when:
  - Runtime cache behavior and invalidation rules are explicit for page and fragment responses.
  - Application authors have a supported way to understand what is cached, where it lives, and when it invalidates.
  - Tests and docs cover correctness expectations for stale and refreshed document/fragment content.
- Progress:
  - 2026-03-12: Added process-local document-shell caching in `templates/backend/runtime/views.ts`, keyed by the resolved built frontend HTML path and invalidated when the file size or mtime changes on disk.
  - 2026-03-12: Updated the built-in backend server and Fastify scaffold to emit `x-webstir-document-cache` for request-time documents plus `x-webstir-fragment-cache: bypass` and `Cache-Control: no-store` for fragment responses.
  - 2026-03-12: Expanded `packages/tooling/webstir-backend/tests/integration.test.js` with miss/hit/stale request-time document assertions and fragment cache-header coverage, then documented the runtime cache model in `packages/tooling/webstir-backend/README.md`.

## 13. Add An Auth And CRUD Proof App
- Status: done
- Depends on: 5, 10, 11
- Scope: add a canonical end-to-end application that proves sessions, auth gates, validation errors, redirect-after-post, and CRUD backoffice flows on top of the progressive-enhancement model.
- Done when:
  - A new demo under `examples/demos/*` exercises auth and CRUD workflows with no-JavaScript and enhanced paths.
  - Watch and publish validation covers the demo's main flows.
  - The demo is suitable to reference from docs as the canonical example for server-handled forms.
- Progress:
  - 2026-03-13: Added `examples/demos/auth-crud`, a dedicated full-stack proof app that serves a backend-rendered auth and CRUD workspace while using the same forms for fragment-enhanced and no-JavaScript redirect flows.
  - 2026-03-13: Added backend runtime coverage for auth gates, validation recovery, sign-in, redirect-after-post create, and enhanced update/delete flows in `examples/demos/auth-crud/src/backend/tests/progressive-enhancement.test.ts`.
  - 2026-03-13: Added watch and publish browser validation in `orchestrators/bun/tests/auth-crud.browser.integration.test.ts`, plus CLI publish coverage and demo helper script/docs updates so the proof app is easy to run and reference.

## 14. Add A Dashboard Proof App And Refresh Docs
- Status: todo
- Depends on: 9, 11, 12, 13
- Scope: add a second proof application for dashboard-style partial refreshes, then reframe package READMEs and portal docs around HTML-first delivery, forms, fragments, sessions, caching, navigation, and deployment.
- Done when:
  - A dashboard-oriented demo proves partial refresh behavior without forcing SPA architecture.
  - `@webstir-io/webstir-frontend`, `@webstir-io/webstir-backend`, and portal docs center the HTML-first application story instead of the older experimental-pipeline framing.
  - Key docs link to the proof applications and describe the shipped runtime/cache/form model accurately.
- Progress:
  - Not started.
