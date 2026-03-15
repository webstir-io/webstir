# Webstir Bun Migration Plan

## Goal

Adopt Bun-native APIs where they materially simplify Webstir or improve performance, while preserving current behavior and avoiding accidental runtime contract changes.

## Decision Gate

Before migrating code under `packages/tooling/*`, decide whether those published packages must remain Node-compatible.

- If `packages/tooling/webstir-backend` and `packages/tooling/webstir-frontend` stay Node-compatible, Bun-native work should be limited to `orchestrators/bun/**` and Bun-only repo scripts.
- If those packages can become Bun-only, the migration surface expands substantially: `Bun.file()`, `Bun.write()`, `Bun.build()`, and `bun:sqlite` all become viable in the canonical package code.

This decision controls most of the plan below.

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

## Easy Wins First

### 1. Replace Bun orchestrator file-copy and patch IO with `Bun.file()` / `Bun.write()`

Impact: medium  
Difficulty: low  
Recommended timing: first PR

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
Recommended timing: first PR

Files:

- [orchestrators/bun/src/providers.ts](/Users/iamce/dev/webstir-io/webstir/orchestrators/bun/src/providers.ts)
- [tools/release-package.mjs](/Users/iamce/dev/webstir-io/webstir/tools/release-package.mjs)
- [orchestrators/bun/scripts/pack-standalone.mjs](/Users/iamce/dev/webstir-io/webstir/orchestrators/bun/scripts/pack-standalone.mjs)

Current approach:

- `spawn` / `spawnSync` wrappers for short-lived commands.

Proposed Bun API:

- `Bun.$`

Expected benefit:

- Less subprocess boilerplate.
- Better shell ergonomics for short-lived commands.
- Cleaner stdout/stderr handling in Bun-only scripts.

Risks / differences:

- Keep `spawn` or `Bun.spawn` for long-lived supervised processes.
- Do not use `Bun.$` for watchers, background daemons, or interactive pipelines.

## High-Impact Bun-Only Changes

### 3. Offer `Bun.serve()` in the Bun orchestrator dev server

Impact: high  
Difficulty: medium  
Recommended timing: first PR

File:

- [orchestrators/bun/src/dev-server.ts](/Users/iamce/dev/webstir-io/webstir/orchestrators/bun/src/dev-server.ts)

Current approach:

- `node:http`
- `createReadStream()` for static assets
- manual SSE handling
- manual proxy forwarding

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

### 4. Add `Bun.build()` as a flag-gated backend one-shot bundler

Impact: high  
Difficulty: medium  
Recommended timing: second PR

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

### 5. Add `Bun.build()` as a flag-gated frontend one-shot bundler

Impact: high  
Difficulty: medium  
Recommended timing: third PR

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

### 6. Replace `better-sqlite3` with `bun:sqlite` in the session store

Impact: high  
Difficulty: medium  
Recommended timing: fourth PR

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

### 7. Replace `better-sqlite3` with `bun:sqlite` in the DB connection template

Impact: medium  
Difficulty: medium  
Recommended timing: fourth PR, same phase as the session store

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

### 8. Offer a Bun-native backend server scaffold

Impact: medium  
Difficulty: medium  
Recommended timing: fifth PR

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

## Package-Level Cleanup If Tooling Becomes Bun-Only

These are worthwhile only if `packages/tooling/webstir-backend` and `packages/tooling/webstir-frontend` are allowed to drop Node-only compatibility constraints.

### 9. Replace frontend file helpers with Bun-native IO

Impact: medium  
Difficulty: low  
Recommended timing: sixth PR, Bun-only package phase

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

### 10. Replace backend and frontend hot-path `fs` reads/writes where they are not stream-bound

Impact: medium  
Difficulty: low to medium  
Recommended timing: sixth PR, Bun-only package phase

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

- Same Bun-only package contract concern.
- Leave stream-based compression paths alone unless they are separately redesigned.

## Not Recommended Yet

### 11. Do not replace current watch/HMR plumbing with Bun hot reload

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

### 12. No current `Bun.password` replacement

Files checked:

- [packages/tooling/webstir-backend/templates/backend/auth/adapter.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-backend/templates/backend/auth/adapter.ts)

Reason:

- No `bcrypt` or `argon2` usage is present in the canonical codebase.
- Revisit this only when password-based auth is added.

## Ordered PR Breakdown

### PR 1

Scope:

- `orchestrators/bun/src/dev-server.ts`
- `orchestrators/bun/src/init.ts`
- `orchestrators/bun/src/enable.ts`
- `orchestrators/bun/src/repair.ts`
- `orchestrators/bun/src/providers.ts`
- `tools/release-package.mjs`
- `orchestrators/bun/scripts/pack-standalone.mjs`

Deliverables:

- `Bun.serve()` in the Bun dev server
- `Bun.write()` / `Bun.file()` for scaffold copy and text patching
- `Bun.$` for one-shot command wrappers

### PR 2

Scope:

- [packages/tooling/webstir-backend/src/build/pipeline.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-backend/src/build/pipeline.ts)

Deliverables:

- Flag-gated `Bun.build()` path for backend build and publish
- Build-equivalence verification for emitted artifacts

### PR 3

Scope:

- [packages/tooling/webstir-frontend/src/builders/jsBuilder.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-frontend/src/builders/jsBuilder.ts)

Deliverables:

- Flag-gated `Bun.build()` path for one-shot frontend bundle generation
- Production filename/hash resolution parity checks

### PR 4

Scope:

- [packages/tooling/webstir-backend/templates/backend/session/sqlite.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-backend/templates/backend/session/sqlite.ts)
- [packages/tooling/webstir-backend/templates/backend/db/connection.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-backend/templates/backend/db/connection.ts)

Deliverables:

- `bun:sqlite` session store
- `bun:sqlite` SQLite DB connection path
- smoke coverage for generated templates

### PR 5

Scope:

- [packages/tooling/webstir-backend/templates/backend/index.ts](/Users/iamce/dev/webstir-io/webstir/packages/tooling/webstir-backend/templates/backend/index.ts)
- related scaffold selection surfaces

Deliverables:

- optional Bun-native backend server scaffold

### PR 6

Scope:

- package-level IO cleanup across `packages/tooling/webstir-backend` and `packages/tooling/webstir-frontend`

Deliverables:

- Bun-native file IO in hot paths
- dependency cleanup such as removing `fs-extra` where possible

Condition:

- Only after explicitly deciding those packages may become Bun-only.

## Validation Checklist

- Benchmark `Bun.build()` vs esbuild on both backend and frontend representative entries after each bundler PR.
- Compare emitted artifact counts, output paths, source maps, and runtime behavior instead of requiring byte-for-byte identity.
- Run package-local build and smoke coverage for any scaffold changes.
- Revalidate dev server SSE, proxying, static assets, and cache headers after the `Bun.serve()` migration.
- Verify template-generated SQLite projects on Bun before replacing `better-sqlite3`.
