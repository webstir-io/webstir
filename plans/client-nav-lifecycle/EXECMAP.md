# Client navigation lifecycle

## Goal
Give interactive documents framework-owned setup and cleanup without replacing HTML navigation.

## Guardrails
Preserve event integrations and browser escape hatches. No downstream edits, parallel router, cache busting, or application-specific behavior. Canonical Bun resources and TypeScript packages only; generate copies.

## Execution Map
- [x] Inspect consumers, runtime, scripts, templates, and tests; establish contract and minimal reproduction.
- [x] Implement lifecycle and script ordering with regression coverage.
- [x] Refresh templates, examples, generated projections, and migration documentation.
- [x] Run focused and required checks, review final diff, report supported behavior and limitations.

## Done When
Initial load, revisits, history, shared modules, cancellation and resource disposal have browser proof in development and publish output; legacy event and browser navigation tests pass.

## Findings and decision

The website uses the existing event to rebind page behavior and manage cleanup; that integration is valid. The client portal uses module-level DOM queries, state, listeners, and async requests. Browser module caching does not rerun those on revisits. No downstream files were changed.

Use an optional page `setup(PageContext)` export with the existing cleanup scope, a root, current URL, and abort signal. The navigator owns the lifetime; applications own rendering, requests, auth, and fragment behavior. Avoid a registry, global bridge, or altered import URL. The HTML builder marks page entries; client-nav watch uses the existing document pipeline because Bun HTML bundling combines script entries. Full template page code no longer imports the shared app entry.

## Verification

- `bun run check:required`: passed (package builds/tests, backend/testing smokes, 160 orchestrator core tests, 20 orchestrator browser tests, package-install smoke, portal build).
- Page lifecycle unit regressions: 3 passed, including late async cleanup and synchronous-returned cleanup ordering.
- Final watch/publish progressive enhancement browser scenarios: 2 passed, 77 assertions. Includes initial setup, repeated visits, query and parameterized URLs sharing a module, history and native hash history, pending request cancellation, detached listener/observer/timer cleanup, guarded slow completion, head/body script ordering, and native authentication redirects.
- Existing auth/CRUD, dashboard, and full-watch scenarios: 8 passed in the combined targeted run.
- Final formatting, diff whitespace, generated assets, feature projections, and full demo synchronization checks: passed.

Implementation completed without downstream migration. The subsequent `$deliver` request authorizes review fixes, PR merge, and the synchronized 0.1.54 release. Browser verification used the repository's pinned Chromium; other browser engines were not run.

## Delivery contract

Review the complete working diff against main, then use the Required Gate (`bun run check:required`). Merge triggers docs deployment to webstir.io. After exact-merge main CI succeeds, push `release-set/webstir/v0.1.54` to trigger `release-package.yml`, publishing the CLI, frontend, backend, and module contract together. Verify registry versions, dependency ranges, provenance, matching gitHead, fresh installation, and deployed docs. Stop on failed CI, a mismatched immutable version, or unsuccessful live proof; do not overwrite published versions. Task-owned test servers shut down in test finally blocks; no preexisting server is owned by delivery.

The delivery review reproduced a blocked subsequent navigation when an incoming main-content script never finished loading. Shared abortable script waiting fixes that path, with watch and publish browser coverage. The existing native-navigation fallbacks remain necessary for unavailable scripts, non-HTML responses, missing main roots, and authentication redirects.

Delivery review: Ready for Sendit. `bun run check:required` passed again after the cancellation fix and 0.1.54 preparation; release-plan validation passed. Registry preflight confirmed all four target versions absent.
