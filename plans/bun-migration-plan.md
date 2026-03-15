# Webstir Bun Migration Plan

## Goal

Adopt Bun-native APIs where they materially simplify Webstir or improve performance, while preserving current behavior and avoiding accidental runtime contract changes.

## Runtime Policy

**Decision (2026-03-15): packages/tooling/* will become Bun-only.**

The sole consumer of these packages is the Bun orchestrator, which already requires Bun. No external dependents exist. The Node engine fields were aspirational, not load-bearing.

Operational policy from this point:

- `orchestrators/bun/**` is Bun-only code.
- `packages/tooling/**` is a Bun-only product surface, even where package metadata and docs still say otherwise.
- Repo-local scripts, tests, and CI paths that Webstir controls should converge on Bun instead of remaining half-Node and half-Bun.
- Release/publish tooling changes are boundary changes. They should land as explicit runtime-policy PRs, not as incidental `spawnSync` to `Bun.$` cleanup.
- External protocols still remain where required. `npm publish` stays `npm publish`; GitHub Actions can still install Node when a third-party action or protocol requires it.

## Migration Shape

This migration should be tracked as runtime-boundary work, not just API substitution work.

### Workstream A: repo-internal Bunification

Scope:

- release helpers under `tools/**`
- publish shell wrappers
- release-tool tests
- CI steps that still invoke local scripts with `node`

Goal:

- remove mixed local/runtime ownership where Webstir controls the entrypoint

### Workstream B: published and generated Bun runtime contract

Scope:

- `packages/tooling/**` implementation
- published package metadata and docs
- CLI entrypoints and shebangs
- generated backend templates and scaffolds

Goal:

- make the published/runtime contract match the Bun-only decision instead of leaving Bun-only behavior hidden behind Node-shaped metadata

## Current Findings

### `Bun.build()` benchmark summary

Representative backend and frontend entries built successfully with `Bun.build()` on Bun `1.3.5`, and the sampled runs were faster than esbuild. The outputs were not byte-equivalent.

| Area | Sample | esbuild | Bun.build() | Notes |
| --- | --- | ---: | ---: | --- |
| Backend dev | `examples/demos/auth-crud/src/backend/index.ts` | `304.3ms` | `2.9ms` | Same artifact count, different JS/map bytes |
| Backend publish | representative publish entry | `4.5ms` | `1.4ms` | Single JS artifact from both, different bytes |
| Frontend dev | representative page entry | `4.3ms` | `1.7ms` | Same artifact count, different JS/map bytes |
| Frontend prod | representative app entry | `3.3ms` | `1.4ms` | Same bundle shape, different file bytes and hash naming |

Hard blocker for watch/HMR migration: the current Bun build result exposes `outputs`, `success`, and `logs`, but not esbuild-style `metafile` data or `context()` / `rebuild()` behavior. Current watch and HMR flows depend on those APIs.

### Password hashing

No current `bcrypt` or `argon2` usage was found in the canonical codebase. There is no immediate `Bun.password` replacement to make.

## Principles

- Start with Bun-only surfaces that already live under `orchestrators/bun/**`.
- Prefer easy wins before high-risk architectural changes.
- Keep esbuild for watch mode until Bun exposes an equivalent contract or the watch pipeline is redesigned.
- Treat `bun:sqlite` as a runtime contract change, not a simple dependency swap.
- Keep migrations behind flags where output shape or behavioral equivalence is still being validated.

## Progress Snapshot

### Landed

- `orchestrators/bun/src/init.ts`, `orchestrators/bun/src/enable.ts`, and `orchestrators/bun/src/repair.ts` now use `Bun.file()` / `Bun.write()` for scaffold copy and patch paths.
- `orchestrators/bun/src/dev-server.ts` now uses `Bun.serve()` and `Bun.file()` for the Bun-only dev server path.
- `orchestrators/bun/src/providers.ts` now uses `Bun.$` for the one-shot local package build wrapper while preserving runtime-command selection and inherited output behavior.
- `orchestrators/bun/scripts/pack-standalone.mjs` now uses Bun-native command execution for its one-shot packaging flow, and `orchestrators/bun/package.json` runs that script with `bun`.
- `tools/release-package.mjs` and `tools/resolve-release-package.mjs` now use Bun entrypoints, publish wrappers invoke them with `bun`, release-tool tests run with `bun test`, and the release workflow resolves packages with `bun`.

### Remaining justified Bun-only work

- The Bun-only script/orchestrator track is complete.
- The next active work is the package/tooling track, continuing with the frontend `Bun.build()` path.

### Deferred or gated

- `npm publish` and npm registry checks remain external protocol boundaries even after the repo-local tooling around them moves to Bun.

## Completed Bun-Only Wins

### 1. Replace Bun orchestrator file-copy and patch IO with `Bun.file()` / `Bun.write()`

Impact: medium  
Difficulty: low  
Status: completed

Files:

- [orchestrators/bun/src/init.ts](/Users/iamce/dev/webstir-io/webstir/orchestrators/bun/src/init.ts)
- [orchestrators/bun/src/enable.ts](/Users/iamce/dev/webstir-io/webstir/orchestrators/bun/src/enable.ts)
- [orchestrators/bun/src/repair.ts](/Users/iamce/dev/webstir-io/webstir/orchestrators/bun/src/repair.ts)

Current approach:

- `cp`, `copyFile`, `readFile`, and `writeFile` from Node APIs for scaffold asset copying and text patching.

Proposed Bun API:

- `await Bun.write(destination, Bun.file(source))`
- `await Bun.file(path).text()`
- `await Bun.write(path, nextContents)`

Expected benefit:

- Simpler Bun-native IO in hot scaffold paths.
- Less boilerplate.
- Removes unnecessary Node-style stream/file wrappers in Bun-only code.

Risks / differences:

- Keep `mkdir`, `chmod`, and similar directory metadata operations on `node:fs/promises`.

### 2. Replace one-shot child-process wrappers with `Bun.$`

Impact: medium  
Difficulty: low  
Status: partially complete

Files:

- [orchestrators/bun/src/providers.ts](/Users/iamce/dev/webstir-io/webstir/orchestrators/bun/src/providers.ts)
- [orchestrators/bun/scripts/pack-standalone.mjs](/Users/iamce/dev/webstir-io/webstir/orchestrators/bun/scripts/pack-standalone.mjs)
- [tools/release-package.mjs](/Users/iamce/dev/webstir-io/webstir/tools/release-package.mjs)

Completed:

- [orchestrators/bun/src/providers.ts](/Users/iamce/dev/webstir-io/webstir/orchestrators/bun/src/providers.ts) now uses `Bun.$` for the short-lived local package build wrapper.
- [orchestrators/bun/scripts/pack-standalone.mjs](/Users/iamce/dev/webstir-io/webstir/orchestrators/bun/scripts/pack-standalone.mjs) now uses Bun-native command execution for the standalone packaging flow.

Remaining:

- [tools/release-package.mjs](/Users/iamce/dev/webstir-io/webstir/tools/release-package.mjs) still uses `spawnSync`, but that remaining work belongs to the repo-internal release-tooling migration, not the completed orchestrator track.

Proposed Bun API:

- `Bun.$`

Expected benefit:

- Less subprocess boilerplate.
- Better shell ergonomics for short-lived commands.
- Cleaner stdout/stderr handling in Bun-only scripts.

Risks / differences:

- Keep `spawn` or `Bun.spawn` for long-lived supervised processes.
- Do not use `Bun.$` for watchers, background daemons, or interactive pipelines.

### Next justified chunk

PR 3: add the flag-gated backend `Bun.build()` path in [packages/tooling/webstir-backend/src/build/pipeline.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-backend/src/build/pipeline.ts).

## Completed High-Impact Bun-Only Changes

### 3. Offer `Bun.serve()` in the Bun orchestrator dev server

Impact: high  
Difficulty: medium  
Status: completed

File:

- [orchestrators/bun/src/dev-server.ts](/Users/iamce/dev/webstir-io/webstir/orchestrators/bun/src/dev-server.ts)

Landed behavior:

- `Bun.serve()` owns the Bun dev server lifecycle.
- `Bun.file()` serves static assets.
- `fetch()`-based proxying replaces the previous Node HTTP forwarding path.

Proposed Bun API:

- `Bun.serve()`
- `Bun.file()` for static file responses
- `fetch()`-based proxying

Expected benefit:

- Largest Bun-native simplification in the Bun orchestrator.
- Simpler static file serving and response construction.
- Lower overhead than manually composing Node HTTP primitives.

Risks / differences:

- Revalidate SSE behavior and connection lifetime semantics.
- Revalidate header forwarding and proxy error behavior.
- Revalidate cache headers and MIME behavior for static assets.

## Repo-Internal Runtime Boundary

### 4. Move release helpers, publish wrappers, and release-tool tests to Bun

Impact: high  
Difficulty: medium  
Status: completed  
Recommended timing: second PR

Files:

- [tools/release-package.mjs](/Users/iamce/dev/webstir-io/webstir/tools/release-package.mjs)
- [tools/resolve-release-package.mjs](/Users/iamce/dev/webstir-io/webstir/tools/resolve-release-package.mjs)
- [tools/tests/release-tools.test.mjs](/Users/iamce/dev/webstir-io/webstir/tools/tests/release-tools.test.mjs)
- [packages/contracts/module-contract/scripts/publish.sh](/Users/iamce/dev/webstir-io/webstir/packages/contracts/module-contract/scripts/publish.sh)
- [packages/contracts/testing-contract/scripts/publish.sh](/Users/iamce/dev/webstir-io/webstir/packages/contracts/testing-contract/scripts/publish.sh)
- [packages/tooling/webstir-backend/scripts/publish.sh](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-backend/scripts/publish.sh)
- [packages/tooling/webstir-frontend/scripts/publish.sh](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-frontend/scripts/publish.sh)
- [packages/tooling/webstir-testing/scripts/publish.sh](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-testing/scripts/publish.sh)
- [orchestrators/bun/scripts/publish.sh](/Users/iamce/dev/webstir-io/webstir/orchestrators/bun/scripts/publish.sh)
- [.github/workflows/release-package.yml](/Users/iamce/dev/webstir-io/webstir/.github/workflows/release-package.yml)
- [package.json](/Users/iamce/dev/webstir-io/webstir/package.json)

Current approach:

- local release helpers use Node entrypoints
- publish wrappers shell out to `node .../tools/release-package.mjs`
- release-tool tests run under `node --test`
- the release workflow is mixed: Bun for package work, Node for local helper scripts

Proposed Bun API:

- `#!/usr/bin/env bun`
- `bun tools/release-package.mjs`
- `bun tools/resolve-release-package.mjs`
- `bun test` for release-tool tests
- optional `Bun.$` for short-lived local subprocess wrappers

Expected benefit:

- Removes the runtime split for repo-local release tooling.
- Makes local publishing and release-tool testing match the repo's Bun-first execution model.
- Turns the release-tool migration into an explicit boundary change instead of leaving it as an awkward exception.

Risks / differences:

- Every publish wrapper has to move together so the entrypoint contract does not drift by package.
- Keep `npm publish` and npm registry inspection unchanged.
- Revalidate the fake-tool test harness and stderr/stdout expectations after changing runtimes.

### 5. Add `Bun.build()` as a flag-gated backend one-shot bundler

Impact: high  
Difficulty: medium  
Recommended timing: third PR

Files:

- [packages/tooling/webstir-backend/src/build/pipeline.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-backend/src/build/pipeline.ts)

Current approach:

- esbuild for build and publish flows.
- esbuild `context()` and `metafile` also feed related reporting paths.

Proposed Bun API:

- `Bun.build()` for one-shot build and publish only, behind a flag such as `WEBSTIR_BACKEND_BUNDLER=bun`.

Expected benefit:

- Measurable build speed improvement on sampled entries.
- Reduced dependency on esbuild for non-watch paths.

Risks / differences:

- Output is not byte-equivalent to esbuild.
- Current code depends on `metafile`-driven output accounting.
- Do not migrate watch mode in the same phase.

### 6. Add `Bun.build()` as a flag-gated frontend one-shot bundler

Impact: high  
Difficulty: medium  
Recommended timing: fourth PR

Files:

- [packages/tooling/webstir-frontend/src/builders/jsBuilder.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-frontend/src/builders/jsBuilder.ts)

Current approach:

- esbuild for app bundles, page bundles, and transpile-only dev paths.

Proposed Bun API:

- `Bun.build()` for one-shot dev/prod bundle experiments behind a flag.

Expected benefit:

- Similar sampled build speed improvement as backend builds.
- Positions the frontend builder for future Bun-first workflows.

Risks / differences:

- Output bytes and hash naming differ from esbuild.
- Current production path uses `metafile` to find emitted bundle names.
- Keep esbuild for watch and HMR until the pipeline is redesigned.

## Runtime Contract Changes

### 7. Replace `better-sqlite3` with `bun:sqlite` in the session store

Impact: high  
Difficulty: medium  
Recommended timing: fifth PR, after the backend/frontend `Bun.build()` experiments land

File:

- [packages/tooling/webstir-backend/templates/backend/session/sqlite.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-backend/templates/backend/session/sqlite.ts)

Current approach:

- Lazy `better-sqlite3` load with sync prepared statements.

Proposed Bun API:

- `bun:sqlite`

Expected benefit:

- Removes a third-party native dependency from the generated session store.
- Simpler setup and better alignment with Bun-native backends.

Risks / differences:

- This makes the generated SQLite session store Bun-only.
- SQL behavior and error surface need smoke coverage before release.

### 8. Replace `better-sqlite3` with `bun:sqlite` in the DB connection template

Impact: medium  
Difficulty: medium  
Recommended timing: fifth PR, same phase as the session store

File:

- [packages/tooling/webstir-backend/templates/backend/db/connection.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-backend/templates/backend/db/connection.ts)

Current approach:

- Optional SQLite branch based on `better-sqlite3`
- Postgres branch based on `pg`

Proposed Bun API:

- `bun:sqlite` for the SQLite branch only

Expected benefit:

- Consistent Bun-native SQLite story across backend scaffolds.
- Same dependency reduction as the session store.

Risks / differences:

- Same Bun-only runtime tradeoff as the session store.
- `pg` remains unchanged.

### 9. Offer a Bun-native backend server scaffold

Impact: medium  
Difficulty: medium  
Recommended timing: sixth PR

Files:

- [packages/tooling/webstir-backend/templates/backend/index.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-backend/templates/backend/index.ts)
- [packages/tooling/webstir-backend/templates/backend/server/fastify.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-backend/templates/backend/server/fastify.ts)

Current approach:

- Built-in `node:http` server scaffold
- Optional Fastify scaffold

Proposed Bun API:

- Add an opt-in `Bun.serve()` scaffold

Expected benefit:

- Exposes a Bun-native runtime option without forcing Fastify.
- Gives Bun users a simpler default server path.

Risks / differences:

- Should be additive, not a replacement for Fastify or the Node server.
- Request/response semantics and middleware shape differ from both current server options.

## Package-Level Cleanup In The Bun-Only Tooling Phase

These follow from the 2026-03-15 decision to make `packages/tooling/webstir-backend` and `packages/tooling/webstir-frontend` Bun-only. The remaining work here is sequencing, package metadata cleanup, and validation.

### 10. Replace frontend file helpers with Bun-native IO

Impact: medium  
Difficulty: low  
Recommended timing: seventh PR, Bun-only package phase

Files:

- [packages/tooling/webstir-frontend/src/utils/fs.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-frontend/src/utils/fs.ts)
- [packages/tooling/webstir-frontend/src/config/manifest.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-frontend/src/config/manifest.ts)
- [packages/tooling/webstir-frontend/src/config/paths.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-frontend/src/config/paths.ts)
- [packages/tooling/webstir-frontend/src/html/pageScaffold.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-frontend/src/html/pageScaffold.ts)

Current approach:

- `fs-extra` and `fs.promises` wrappers for read/write/json/scaffold file operations.

Proposed Bun API:

- `Bun.file()`
- `Bun.write()`

Expected benefit:

- Removes `fs-extra` from common file paths.
- Simplifies manifest and scaffold IO.

Risks / differences:

- Current package metadata still advertises Node support.
- Keep directory creation and removal on `node:fs/promises`.

### 11. Replace backend and frontend hot-path `fs` reads/writes where they are not stream-bound

Impact: medium  
Difficulty: low to medium  
Recommended timing: seventh PR, Bun-only package phase

Files:

- [packages/tooling/webstir-backend/src/cache/diff.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-backend/src/cache/diff.ts)
- [packages/tooling/webstir-backend/src/runtime/views.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-backend/src/runtime/views.ts)
- [packages/tooling/webstir-backend/src/manifest/pipeline.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-backend/src/manifest/pipeline.ts)
- [packages/tooling/webstir-frontend/src/watch/hotUpdateTracker.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-frontend/src/watch/hotUpdateTracker.ts)
- [packages/tooling/webstir-backend/src/add.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-backend/src/add.ts)

Current approach:

- Repeated `readFile` / `writeFile` usage in runtime, cache, and scaffold-heavy paths.

Proposed Bun API:

- `Bun.file().text()`
- `Bun.write()`

Expected benefit:

- Smaller but meaningful simplification and IO wins in cache misses, manifest reads, and scaffold patching.

Risks / differences:

- Package metadata and docs still need to catch up with the Bun-only runtime contract.
- Leave stream-based compression paths alone unless they are separately redesigned.

## Runtime Contract Follow-Through

### 12. Update published package metadata, CLI entrypoints, and docs to match Bun-only tooling

Impact: high  
Difficulty: medium  
Recommended timing: begin alongside the first package/tooling PR that introduces a Bun-only runtime dependency, and complete no later than the final cleanup PR

Files:

- [packages/tooling/webstir-backend/package.json](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-backend/package.json)
- [packages/tooling/webstir-frontend/package.json](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-frontend/package.json)
- [packages/tooling/webstir-testing/package.json](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-testing/package.json)
- [packages/tooling/webstir-frontend/src/cli.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-frontend/src/cli.ts)
- [packages/tooling/webstir-testing/src/cli.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-testing/src/cli.ts)
- [packages/tooling/webstir-testing/src/add-cli.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-testing/src/add-cli.ts)
- [packages/tooling/webstir-backend/templates/backend/db/migrate.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-backend/templates/backend/db/migrate.ts)
- [packages/tooling/webstir-backend/templates/backend/jobs/scheduler.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-backend/templates/backend/jobs/scheduler.ts)
- package READMEs and release notes for the affected packages

Current approach:

- package manifests still advertise Node support
- several CLIs and generated files still use `#!/usr/bin/env node`
- docs do not consistently describe Bun as the actual runtime contract

Proposed changes:

- update package `engines` and install/runtime docs to Bun
- update CLI/template shebangs where they are intended to execute directly under Bun
- document the consumer-facing runtime change at release time

Expected benefit:

- Makes the published/runtime contract honest.
- Avoids shipping Bun-only behavior behind Node-shaped metadata.
- Reduces future confusion in docs, smoke tests, and support paths.

Risks / differences:

- This is a consumer-facing contract change even if external dependents are currently low or zero.
- Shebang changes need to line up with published artifacts and pack/smoke coverage.

## Not Recommended Yet

### 13. Do not replace current watch/HMR plumbing with Bun hot reload

Files:

- [packages/tooling/webstir-backend/src/watch.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-backend/src/watch.ts)
- [packages/tooling/webstir-frontend/src/watch/watchCoordinator.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-frontend/src/watch/watchCoordinator.ts)
- [packages/tooling/webstir-frontend/src/watch/hotUpdateTracker.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-frontend/src/watch/hotUpdateTracker.ts)
- [packages/tooling/webstir-frontend/src/watch/watchReporter.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-frontend/src/watch/watchReporter.ts)
- [orchestrators/bun/src/workspace-watcher.ts](/Users/iamce/dev/webstir-io/webstir/orchestrators/bun/src/workspace-watcher.ts)

Reason:

- Current watch flows depend on esbuild `context()`, `rebuild()`, and `metafile`.
- Bun hot reload does not replace the repo's cross-process rebuild, HMR diffing, or orchestrated reload decisions.
- The only reasonable near-term experiment is `bun --hot` for a spawned backend runtime, not for the full watch stack.

### 14. No current `Bun.password` replacement

Files checked:

- [packages/tooling/webstir-backend/templates/backend/auth/adapter.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-backend/templates/backend/auth/adapter.ts)

Reason:

- No `bcrypt` or `argon2` usage is present in the canonical codebase.
- Revisit this only when password-based auth is added.

## Ordered PR Breakdown

### PR 1

Status: completed

Scope:

- `orchestrators/bun/src/dev-server.ts`
- `orchestrators/bun/src/init.ts`
- `orchestrators/bun/src/enable.ts`
- `orchestrators/bun/src/repair.ts`
- `orchestrators/bun/src/providers.ts`
- `orchestrators/bun/scripts/pack-standalone.mjs`

Deliverables:

- `Bun.serve()` in the Bun dev server
- `Bun.write()` / `Bun.file()` for scaffold copy and text patching
- `Bun.$` for one-shot command wrappers

### PR 2

Status: completed

Scope:

- [tools/release-package.mjs](/Users/iamce/dev/webstir-io/webstir/tools/release-package.mjs)
- [tools/resolve-release-package.mjs](/Users/iamce/dev/webstir-io/webstir/tools/resolve-release-package.mjs)
- [tools/tests/release-tools.test.mjs](/Users/iamce/dev/webstir-io/webstir/tools/tests/release-tools.test.mjs)
- publish shell wrappers
- [.github/workflows/release-package.yml](/Users/iamce/dev/webstir-io/webstir/.github/workflows/release-package.yml)
- [package.json](/Users/iamce/dev/webstir-io/webstir/package.json)

Deliverables:

- Bun entrypoints for repo-local release helpers
- Bun-based release-tool test execution
- Bun-based publish wrapper contract
- unchanged `npm publish` boundary

### PR 3

Status: completed
Tracking: PR #91

Scope:

- [packages/tooling/webstir-backend/src/build/pipeline.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-backend/src/build/pipeline.ts)

Deliverables:

- Flag-gated `Bun.build()` path for backend build and publish
- Build-equivalence verification for emitted artifacts

### PR 4

Scope:

- [packages/tooling/webstir-frontend/src/builders/jsBuilder.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-frontend/src/builders/jsBuilder.ts)

Deliverables:

- Flag-gated `Bun.build()` path for one-shot frontend bundle generation
- Production filename/hash resolution parity checks

### PR 5

Scope:

- [packages/tooling/webstir-backend/templates/backend/session/sqlite.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-backend/templates/backend/session/sqlite.ts)
- [packages/tooling/webstir-backend/templates/backend/db/connection.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-backend/templates/backend/db/connection.ts)

Deliverables:

- `bun:sqlite` session store
- `bun:sqlite` SQLite DB connection path
- smoke coverage for generated templates

### PR 6

Scope:

- [packages/tooling/webstir-backend/templates/backend/index.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-backend/templates/backend/index.ts)
- related scaffold selection surfaces

Deliverables:

- optional Bun-native backend server scaffold

### PR 7

Scope:

- package-level IO cleanup across `packages/tooling/webstir-backend` and `packages/tooling/webstir-frontend`
- package metadata, CLI entrypoints, and docs that still advertise Node semantics

Deliverables:

- Bun-native file IO in hot paths
- dependency cleanup such as removing `fs-extra` where possible
- runtime-contract cleanup in manifests, shebangs, and docs

Condition:

- After at least one package/tooling PR has established the consumer-facing Bun-only direction in code and validation.

## Validation Checklist

- Benchmark `Bun.build()` vs esbuild on both backend and frontend representative entries after each bundler PR.
- Compare emitted artifact counts, output paths, source maps, and runtime behavior instead of requiring byte-for-byte identity.
- Run package-local build and smoke coverage for any scaffold changes.
- Revalidate dev server SSE, proxying, static assets, and cache headers after the `Bun.serve()` migration.
- Verify template-generated SQLite projects on Bun before replacing `better-sqlite3`.
- Verify direct CLI execution and packaged artifacts after any shebang or `engines` change.
- Keep release-package workflow validation focused on the local helper/runtime change, while preserving npm publish behavior.
