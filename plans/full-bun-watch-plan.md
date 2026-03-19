# Webstir Full Bun Watch/HMR Plan

## Goal

Make the development loop Bun-native end to end:

- Bun-native frontend serving and HMR for the supported frontend workspace modes.
- Bun-native backend watch/build/restart behavior.
- Removal of the legacy frontend watch daemon and custom HMR protocol once replacement coverage is complete.

This plan is intentionally narrower than the broader Bun migration work. It covers only the remaining watch/HMR path.

## Current State

### Landed

- Bun-first SPA watch is real in the Bun orchestrator via [orchestrators/bun/src/bun-spa-watch.ts](/Users/iamce/dev/webstir-io/webstir/orchestrators/bun/src/bun-spa-watch.ts).
- Bun-native `full` watch is real in the Bun orchestrator via [orchestrators/bun/src/full-watch.ts](/Users/iamce/dev/webstir-io/webstir/orchestrators/bun/src/full-watch.ts) and [orchestrators/bun/src/bun-generated-frontend-watch.ts](/Users/iamce/dev/webstir-io/webstir/orchestrators/bun/src/bun-generated-frontend-watch.ts).
- SPA page scripts and templates use `import.meta.hot`.
- Browser integration coverage exists for SPA JavaScript HMR, CSS hot refresh, and unsupported-mode rejection in [orchestrators/bun/tests/bun-first-spa.integration.test.ts](/Users/iamce/dev/webstir-io/webstir/orchestrators/bun/tests/bun-first-spa.integration.test.ts).
- Integration coverage exists for Bun-native `full` watch in [orchestrators/bun/tests/full-watch.integration.test.ts](/Users/iamce/dev/webstir-io/webstir/orchestrators/bun/tests/full-watch.integration.test.ts).
- The Bun orchestrator test suite currently passes.

### Still not fully Bun-native

- Backend watch still uses esbuild watch contexts in [packages/tooling/webstir-backend/src/watch.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-backend/src/watch.ts#L206).
- The legacy frontend watch daemon still exists and still owns the remaining non-Bun frontend watch flow in [packages/tooling/webstir-frontend/src/watch/watchCoordinator.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-frontend/src/watch/watchCoordinator.ts#L75).
- The legacy frontend watch flow still depends on esbuild contexts and `metafile` output in [packages/tooling/webstir-frontend/src/watch/watchCoordinator.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-frontend/src/watch/watchCoordinator.ts#L267).
- SSG remains on the legacy watch path intentionally for this phase.
- Bun-first frontend still leans on the SPA-style generated-document model in [orchestrators/bun/src/bun-generated-frontend-watch.ts](/Users/iamce/dev/webstir-io/webstir/orchestrators/bun/src/bun-generated-frontend-watch.ts#L26).

## Scope

### In scope

- Bun-native SPA, `full`, and optionally SSG watch/HMR behavior.
- Backend watch/build/restart migration away from esbuild watch contexts.
- Watch/HMR docs, runtime selection, and validation coverage.
- Removal of legacy watch/HMR code after replacement paths are stable.

### Out of scope

- Release/publish/runtime-contract migration work that is already tracked elsewhere.
- Unrelated Bunification outside the dev/watch loop.
- Broad framework redesign unrelated to watch/document ownership.

## Principles

- Prefer Bun-native serving and HMR semantics over preserving the old custom frontend HMR protocol.
- Keep replacement work behaviorally real and test-backed before deleting legacy code.
- Do not merge “full Bun” goals into one large cutover. Land mode-by-mode with clear exit criteria.
- Avoid mixed ownership boundaries where Bun-native frontend paths still depend on legacy daemon/server seams.

## Workstreams

### 1. Stabilize and finalize SPA Bun-first watch

Objectives:

- Decide whether SPA Bun-first is the default or remains an explicit runtime choice.
- Keep `legacy` only as a temporary escape hatch if needed.
- Consolidate SPA watch coverage around one authoritative integration surface.

Concrete work:

- Centralize frontend runtime resolution in the Bun orchestrator.
- Ensure `webstir watch` behavior for SPA is intentional and documented.
- Add explicit legacy fallback coverage if the escape hatch remains.
- Extract repeated Bun SPA integration helpers into shared test support.

Exit criteria:

- SPA watch behavior is no longer described as experimental or provisional.
- The team is comfortable with either default Bun-first SPA or a documented reason it remains opt-in.

### 2. Build reusable Bun frontend watch primitives

Objectives:

- Stop treating the current SPA Bun watch path as a one-off.
- Reuse the same building blocks for future `full` and possible SSG work.

Concrete work:

- Extract generated-document composition.
- Extract asset and stylesheet resolution.
- Extract JS/CSS hot-update expectations and browser-test helpers.
- Make route fallback behavior explicit instead of implicit.

Suggested file targets:

- [orchestrators/bun/src/bun-spa-watch.ts](/Users/iamce/dev/webstir-io/webstir/orchestrators/bun/src/bun-spa-watch.ts)
- [orchestrators/bun/tests/bun-first-spa.integration.test.ts](/Users/iamce/dev/webstir-io/webstir/orchestrators/bun/tests/bun-first-spa.integration.test.ts)
- new shared helpers under `orchestrators/bun/test-support/**` or `orchestrators/bun/src/**`

Exit criteria:

- The Bun frontend watch implementation is split by responsibility instead of remaining one SPA-specific session file.

### 3. Implement Bun-native `full` watch

Status:

- Landed.

### 4. Decide the SSG strategy

Objectives:

- Remove ambiguity around whether SSG is an intended Bun-native watch target.

Decision for this phase:

- Option B: keep SSG on the legacy path intentionally and document that choice clearly.

Decision factors:

- document ownership model
- static content composition cost
- whether Bun-native HMR meaningfully improves the SSG developer experience

Exit criteria:

- SSG is explicitly declared out of scope for Bun-native watch in this phase.

### 5. Replace backend esbuild watch

Objectives:

- Remove the largest remaining non-Bun watch dependency in the backend loop.

Concrete work:

- Replace esbuild watch contexts in [packages/tooling/webstir-backend/src/watch.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-backend/src/watch.ts#L206) with a Bun-native watch/build approach.
- Preserve rebuild events, diagnostics, output accounting, and runtime-restart behavior.
- Replace the benchmark-only Bun path with the real backend watch path.

Design requirements:

- equivalent or better error reporting
- equivalent restart semantics
- no regression in manifest/build artifact expectations

Exit criteria:

- Backend watch no longer uses esbuild watch contexts in the primary path.

### 6. Remove the legacy frontend watch daemon

Objectives:

- Delete the custom daemon/HMR machinery after the Bun-native replacements cover the supported workflows.

Primary deletion targets:

- [packages/tooling/webstir-frontend/src/watch/watchCoordinator.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-frontend/src/watch/watchCoordinator.ts)
- [packages/tooling/webstir-frontend/src/watch/hotUpdateTracker.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-frontend/src/watch/hotUpdateTracker.ts)
- [packages/tooling/webstir-frontend/src/watch/watchReporter.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-frontend/src/watch/watchReporter.ts)
- [packages/tooling/webstir-frontend/src/watch/watchDaemon.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-frontend/src/watch/watchDaemon.ts)
- [orchestrators/bun/src/watch-daemon-client.ts](/Users/iamce/dev/webstir-io/webstir/orchestrators/bun/src/watch-daemon-client.ts)
- any legacy-only watch docs and runtime flags

Prerequisite:

- SPA and `full` Bun-native watch paths must be stable first.

Exit criteria:

- No supported frontend watch mode depends on the daemon-backed path.

## Proposed Execution Order

### Phase 1

- Finalize SPA watch behavior.
- Extract shared Bun frontend watch primitives.
- Clean up and centralize test helpers.

### Phase 2

- Bun-native `full` watch landed.

### Phase 3

- Keep SSG intentionally on the legacy watch path for this phase.
- Align docs and runtime wording with that decision.

### Phase 4

- Replace backend esbuild watch with a Bun-native path.
- Re-run the full Bun orchestrator suite repeatedly until stable.

### Phase 5

- Remove the legacy frontend watch daemon and runtime toggle surface.
- Delete stale docs and compatibility code.

## Validation

- Run focused watch suites after every phase:
  - `orchestrators/bun/tests/watch.integration.test.ts`
  - `orchestrators/bun/tests/bun-first-spa.integration.test.ts`
  - `orchestrators/bun/tests/full-watch.integration.test.ts`
  - `orchestrators/bun/tests/api-watch.integration.test.ts`
  - `orchestrators/bun/tests/ssg-watch.integration.test.ts` if SSG remains supported
- Run the full Bun orchestrator test suite repeatedly after major watch-path changes.
- Keep browser integration coverage for real HMR behavior, not just response-body polling.
- Validate unsupported-mode/runtime errors explicitly whenever runtime selection changes.

## Risks

- `full` may force a broader document-ownership decision than SPA did.
- Backend watch replacement may expose missing Bun equivalents for esbuild watch/context behavior.
- SSG may not justify a Bun-native watch path if the composition model stays HTML-fragment-first.
- Deleting the legacy daemon too early would remove the current fallback path before `full` is stable.

## Definition Of Done

Webstir is “full Bun” for watch/HMR when all of the following are true:

- SPA uses a Bun-native watch/HMR path.
- `full` uses a Bun-native watch/frontend hosting path.
- Backend watch no longer relies on esbuild watch contexts.
- The legacy frontend daemon/custom HMR protocol is gone.
- The supported watch docs describe one coherent Bun-native dev loop rather than two competing systems.
