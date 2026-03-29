# Webstir Plan

> Source of truth: this is the single active execution plan for the repo. Other plan docs are roadmap or archival context unless this file explicitly pulls them in.

## Goal

Reduce the highest-risk product and platform flaws in Webstir without trying to redesign the whole stack in one pass.

This plan stays focused on the issues that most directly affect correctness, upgradeability, production trust, and release confidence:

- backend runtime behavior still lives too heavily in scaffolded app files instead of upgradeable package code
- sessions, flash state, and CSRF state still need clearer durable boundaries
- request-time runtime behavior still has path-resolution sharp edges
- plan docs have drifted into multiple overlapping sources of truth

## Planning Policy

- `plans/plan.md` is the only active execution plan.
- `plans/**` files other than this one are historical/reference unless called out here.
- `apps/portal/docs/product/plans/**` is archival/background material, not the live execution source of truth.
- If a roadmap page conflicts with this file, current code, or active docs, this file loses only to current code and active docs.

## Current Decisions

- Bun is the default and single supported backend runtime path for fresh scaffolds.
- App-owned backend surfaces stay local to the scaffold:
  - `src/backend/module.ts`
  - app hooks/config
  - auth adapter surface
  - app DB queries/migrations
  - app jobs/functions
- Framework-owned backend surfaces move behind package-managed runtime APIs:
  - request parsing
  - route/view dispatch
  - session cookie mechanics
  - form parsing
  - fragment/redirect handling
  - request-time view pipeline
  - readiness/health plumbing

## Status

### Landed

- Milestone A is done: `build`/`publish` now fail on provider error diagnostics.
- Required checks already include stronger smoke/install coverage than the original plan assumed.
- The low-friction durable-session path and workspace-root path hardening both moved forward enough that the next highest-leverage slice is runtime ownership.
- Slice A of Milestone C is done: fresh backend scaffolds now default to a package-managed Bun bootstrap with thin `src/backend/index.ts` composition.

### Current State

- Workstream 1 Slice B is done on `main`: `@webstir-io/webstir-testing` now has package-local coverage for discovery, runtime filtering, CLI `test`, watch reruns, and backend-filter smoke.
- Milestone C slices A-C are done on `main`: the fresh-scaffold backend defaults to the package-managed Bun runtime and no longer copies framework-owned runtime wrappers.
- The `full` scaffold uses the same thin package-managed Bun entry shape as `api`, while keeping the progressive-enhancement demo module and install/add-route coverage intact.
- External copied/temp workspaces used by orchestrator `smoke` and `test` materialize repo-local package dependencies before backend runtime execution, so the thin runtime shape stays green outside the monorepo tree.
- Plan-source consolidation is done: `plans/plan.md` is the sole active execution plan.
- Workstream 4 Slice A is done on `main`: session/form/CSRF transport state now persists through a package-owned runtime envelope instead of leaking into app-owned session payloads.
- Workstream 4 Slice B is done on `main`: session metadata now lives in package-owned runtime metadata instead of the persisted app session payload, while compatibility reads remain intact.
- Workstream 4 Slice C is done on `main`: flash transport state now lives in package-owned runtime metadata for new writes in `packages/tooling/webstir-backend`, while legacy top-level flash rows remain readable for compatibility.
- Workstream 5 Slice A is done on `main`: unsupported legacy wrapper preservation/proof work was removed from the active support story.
- Workstream 3 Slice D is done: Fastify is no longer part of the supported backend runtime surface, and Bun is the single supported runtime path.
- Workstream 1 Slice A is done on `main`: `@webstir-io/webstir` package-install smoke now wires the installed CLI through the repo-local backend package path, restoring required CI and package release coverage.

### Reopen Conditions

- Reopen Workstream 4 only if a new storage-boundary bug or adapter requirement justifies it.
- Reopen Workstream 5 only if a concrete current-path launch-directory bug is reproduced on the supported Bun runtime path.
- Do not reopen legacy wrapper compatibility work unless a real supported-user requirement appears.

## Workstreams

### Workstream 1: Keep build and CI trust high

Objective:
Preserve the non-negotiable failure semantics and regression coverage already landed.

Guardrails:

- Do not regress fatal-diagnostic behavior for `build`/`publish`.
- Do not weaken packaged-install, standalone-install, smoke, or scaffold-aware checks while refactoring runtime ownership.

### Workstream 2: Consolidate plan sources

Objective:
Make repo planning readable again by reducing active-source ambiguity to one file.

Tasks:

- Use this file as the sole active execution plan.
- Mark overlapping plan docs as roadmap or archival context.
- Keep long-form product reasoning where useful, but strip them of execution authority.

Success criteria:

- A contributor can answer "what are we actually doing next?" from one file.
- Repo docs no longer imply a competing active execution-plan surface outside this file.

### Workstream 3: Extract backend runtime from copied scaffolds and make Bun the default

Objective:
Move operationally important backend logic into upgradeable package code while aligning the default scaffold with the Bun-first product story.

Tasks:

- Add a stable package-managed Bun runtime bootstrap in `@webstir-io/webstir-backend`.
- Thin scaffolded `src/backend/index.ts` down to composition.
- Keep app-local ownership for env/config/auth/DB/jobs/module wiring.
- Keep Bun as the only supported backend runtime path.
- Stop copying framework-owned runtime wrappers once the thin Bun-first entry works.
- Preserve Bun-owned upgradeability without keeping a second public backend runtime surface alive.

Success criteria:

- Fresh backend scaffolds boot through package-managed Bun runtime code by default.
- Fixing a runtime bug in the package reaches new apps through a normal dependency upgrade.
- Existing workspaces that still use older copied/runtime layouts continue to build and run.

### Workstream 4: Introduce clearer durable state boundaries

Objective:
Stop treating in-memory state as the implicit platform baseline.

Tasks:

- Define a narrower storage contract for sessions and adjacent form/flash state.
- Keep memory as an explicit dev adapter.
- Keep at least one durable path suitable for real deployments.
- Separate framework semantics from storage choice:
  - cookie signing
  - session lifecycle
  - flash handling
  - CSRF lifecycle
  - invalid/expired session handling

Success criteria:

- Sessions and related state survive restarts when using a durable adapter.
- The runtime semantics stay stable even as storage implementations vary.

### Workstream 5: Remove remaining hidden path assumptions

Objective:
Make runtime behavior depend on explicit workspace resolution rather than launch-directory quirks.

Tasks:

- Thread resolved workspace roots through request-time rendering paths.
- Remove residual `process.cwd()` dependence from request-time document resolution.
- Apply the same hardening to non-default server runtimes that remain supported.
- Add launch-directory regression tests.

Success criteria:

- Backend runtime behavior is stable regardless of launch directory.
- SSR/document loading works the same in dev, CI, and deployed environments.

## Current Execution Track

### Workstream 1 Slice C: Stabilize Backend Test Port Allocation

Status:

- Implemented and locally validated with package-local backend tests plus the repo `check:required` gate.

Objective:

Remove the flaky reserve-then-release TCP port selection path from backend tests so the required gate stays trustworthy under parallel execution.

Primary targets:

- `packages/tooling/webstir-backend/tests/integration.test.js`
- `packages/tooling/webstir-backend/src/testing/index.ts`
- nearby backend tests only if they need coverage updates for the same startup path

Acceptance:

- backend integration startup no longer depends on probing and releasing a port before the child process binds it
- the package test harness uses the same safer startup behavior
- package-local backend tests stay green
- `bun run check:required` is green from the repo root

Out of scope:

- backend runtime feature changes
- broad test harness redesign outside backend startup
- docs or plan cleanup unrelated to the flaky gate

### Workstream 1 Slice B: Strengthen Testing Runner Package Coverage

Status:

- Done on `main` via PR #149.

Objective:

Raise release confidence for `@webstir-io/webstir-testing` by adding package-local integration coverage for the published runner contract instead of relying mainly on orchestrator-level proofs.

Primary targets:

- `packages/tooling/webstir-testing/tests/**`
- `packages/tooling/webstir-testing/scripts/smoke.mjs`
- `packages/tooling/webstir-testing/src/**` only where testability gaps force a small supporting change

Acceptance:

- package-local tests cover manifest discovery and runtime filtering on temp workspaces
- package-local tests cover `dist/cli.js test` against frontend and backend fixture workspaces
- package-local tests cover a real watch rerun after a source change
- package-local `test` and `smoke` stay green

Out of scope:

- orchestrator-wide test restructuring
- backend-harness failure injection matrices
- public API redesign for the testing package

Merged check status:

- `bun run check:biome` green
- `bun run lint` green
- `bun run --filter @webstir-io/webstir-testing test` green
- `bun run --filter @webstir-io/webstir-testing smoke` green

### Workstream 3 Slice D: Remove Fastify As A Supported Runtime Path

Status:

- Done.

Objective:

Drop the optional Fastify scaffold/runtime path so Bun is the single supported backend runtime surface.

Primary targets:

- `packages/tooling/webstir-backend/package.json`
- `packages/tooling/webstir-backend/src/add.ts`
- `packages/tooling/webstir-backend/src/scaffold/assets.ts`
- `packages/tooling/webstir-backend/src/runtime/fastify.ts`
- `packages/tooling/webstir-backend/templates/backend/server/fastify.ts`
- `packages/tooling/webstir-backend/scripts/smoke.mjs`
- `packages/tooling/webstir-backend/tests/**`
- `orchestrators/bun/src/add-backend.ts`
- `orchestrators/bun/src/add-backend-compat.ts`
- `orchestrators/bun/src/cli.ts`
- `apps/portal/docs/**`
- `packages/tooling/webstir-backend/README.md`

Acceptance:

- the backend package no longer exports or scaffolds Fastify runtime files
- `webstir add-route` no longer advertises or implements a Fastify-specific branch
- backend package docs describe Bun as the supported runtime surface
- package-local `build`, `test`, and `smoke` stay green
- the repo required gate stays green after the removal

Out of scope:

- changing Bun runtime semantics
- broader backend API redesign

## Completed Slices

### Workstream 4 Slice A: Session/Form/CSRF Storage Boundary

Status:

- Done on `main`.

Objective:

Move framework-owned form and CSRF transport state out of the app session payload while keeping current session/flash behavior stable across in-memory and SQLite-backed storage.

Primary targets:

- `packages/tooling/webstir-backend/src/runtime/session.ts`
- `packages/tooling/webstir-backend/src/runtime/forms.ts`
- `packages/tooling/webstir-backend/templates/backend/session/sqlite.ts`
- `packages/tooling/webstir-backend/tests/sessionStore.test.js`
- `packages/tooling/webstir-backend/tests/sessionScaffoldStore.test.js`

Acceptance:

- framework-owned form/CSRF transport state persists outside app-owned session fields
- legacy stored sessions that still embed form runtime state remain readable
- in-memory and SQLite-backed stores preserve current redirect/flash/form semantics

Merged state:

- package-local `build`, `test`, and `smoke` were green for the landed slice
- targeted `sessionStore` and `sessionScaffoldStore` coverage landed with the change
- PR #138 merged the slice onto `main`

Out of scope:

- new durable adapters beyond the current in-memory and SQLite stores
- broader auth/session API redesign
- residual request-time path cleanup

### Workstream 4 Slice B: Session Metadata Boundary

Status:

- Done on `main`.

Objective:

Move framework-owned session identity and lifecycle metadata out of the app-owned session payload while keeping the current request/runtime session ergonomics stable.

Primary targets:

- `packages/tooling/webstir-backend/src/runtime/session.ts`
- `packages/tooling/webstir-backend/src/runtime/session-runtime.ts` or a package-owned helper beside it
- `packages/tooling/webstir-backend/templates/backend/session/sqlite.ts`
- `packages/tooling/webstir-backend/tests/sessionStore.test.js`
- `packages/tooling/webstir-backend/tests/sessionScaffoldStore.test.js`

Acceptance:

- stored session payloads no longer embed framework-owned `id`, `createdAt`, or `expiresAt` fields
- prepared and committed runtime sessions still expose compatible session metadata access for current call sites
- legacy stored sessions that still embed session metadata in the payload remain readable
- in-memory and SQLite-backed stores preserve current session/flash/form semantics

Merged state:

- package-local `build`, `test`, and `smoke` were green for the landed slice
- targeted `sessionStore` and `sessionScaffoldStore` coverage landed with the change
- PR #139 merged the slice onto `main`

Out of scope:

- flash storage redesign
- new durable adapters beyond the current in-memory and SQLite stores
- broader auth/session API redesign
- residual request-time path cleanup

### Workstream 4 Slice C: Flash State Boundary

Status:

- Done on `main`.

Objective:

Move framework-owned flash transport state behind a package-owned runtime seam while keeping current request/runtime flash ergonomics stable.

Primary targets:

- `packages/tooling/webstir-backend/src/runtime/session.ts`
- `packages/tooling/webstir-backend/src/runtime/session-runtime.ts` or a package-owned helper beside it
- `packages/tooling/webstir-backend/templates/backend/session/sqlite.ts`
- `packages/tooling/webstir-backend/tests/sessionStore.test.js`
- `packages/tooling/webstir-backend/tests/sessionScaffoldStore.test.js`
- `packages/tooling/webstir-backend/tests/integration.test.js`

Acceptance:

- stored session records no longer rely on top-level framework-owned flash transport fields for newly persisted state
- prepared and committed runtime sessions still deliver and consume flash with current route ergonomics
- legacy stored sessions that still persist top-level flash state remain readable
- in-memory and SQLite-backed stores preserve current session/flash/form semantics

Merged state:

- package-local `build`, `test`, and `smoke` are green
- targeted `sessionStore` and `sessionScaffoldStore` coverage is green
- PR #140 merged the slice onto `main`

Out of scope:

- new durable adapters beyond the current in-memory and SQLite stores
- broader auth/session API redesign
- broader route flash API redesign
- residual request-time path cleanup

### Milestone C: Upgradeable Bun-Default Backend Runtime

Status:

- Done.

#### Slice A: Package bootstrap plus thin entrypoint

Create a stable exported helper in `@webstir-io/webstir-backend` that boots the default Bun server from app-provided env/auth/session/module pieces.

Status:

- Done.

Target files:

- `packages/tooling/webstir-backend/src/index.ts`
- `packages/tooling/webstir-backend/package.json`
- `packages/tooling/webstir-backend/src/runtime/*` or a new `src/runtime/*` bootstrap module
- `packages/tooling/webstir-backend/templates/backend/index.ts`
- `packages/tooling/webstir-backend/templates/backend/server/bun.ts` if a temporary compatibility shim is still needed

Acceptance:

- fresh scaffold defaults to Bun runtime
- scaffold `index.ts` is mostly composition, not operational runtime ownership

#### Slice B: Stop copying framework-owned runtime files

After the Bun-first bootstrap works, remove scaffold-copied runtime files that only mirror package exports or package-owned behavior.

Status:

- Done.

Primary target:

- `packages/tooling/webstir-backend/src/scaffold/assets.ts`

Current focus:

- remove the fresh-scaffold Bun shim once `src/backend/index.ts` is the only default Bun entrypoint
- stop copying runtime wrapper files that only forward to package-managed behavior
- keep app-owned scaffold surfaces intact without turning unpublished older layouts into a support contract

Acceptance:

- fresh backend scaffolds no longer own the runtime core
- only app-owned customization surfaces remain scaffolded

#### Slice C: Compatibility coverage

Prove the new scaffold shape and only compatibility paths backed by actual support requirements.

Status:

- Done.

Primary tests:

- `packages/tooling/webstir-backend/tests/integration.test.js`
- `packages/tooling/webstir-backend/tests/envLoader.test.js`
- `packages/tooling/webstir-backend/tests/sessionScaffoldStore.test.js`
- `orchestrators/bun/tests/init.integration.test.ts`
- `orchestrators/bun/scripts/check-package-install.mjs`

Acceptance:

- fresh scaffold uses package runtime and passes package/orchestrator/install proofs

#### Slice D: Follow-up runtime parity

Completed by choosing Bun-only support instead of extending parity to Fastify.

## Validation

Baseline checks for backend-runtime slices:

- `bun run --filter @webstir-io/webstir-backend build`
- `bun run --filter @webstir-io/webstir-backend test`
- `bun run --filter @webstir-io/webstir-backend smoke`

Recommended targeted checks during implementation:

- `bun test packages/tooling/webstir-backend/tests/sessionStore.test.js`
- `bun test packages/tooling/webstir-backend/tests/sessionScaffoldStore.test.js`
- `bun test packages/tooling/webstir-backend/tests/integration.test.js`

## Risks

- Runtime extraction can create awkward compatibility edges for existing scaffolded workspaces.
- Making Bun the default without a narrow bootstrap seam would just move the copied-runtime problem to a different file.
- State/storage cleanup can sprawl if it is mixed into the runtime-default change.
- Plan-doc cleanup can become busywork if it tries to rewrite all historical reasoning instead of clarifying authority.

## Not In This Slice

- Bun orchestration replacement
- frontend redesign
- full DB abstraction redesign
- job/runtime redesign
- durable-state overhaul beyond current boundaries
- broad deployment-platform expansion

## Immediate Next Step

None.

Reopen this track only if a new supported runtime requirement appears or a Bun-path regression justifies more runtime surface work.

### Workstream 5 Slice A: Remove Unsupported Legacy Wrapper Compatibility Surface

Status:

- Done on `main`.

Objective:

Remove the publish-mode legacy-wrapper support assumption from tests/docs and keep only runtime paths backed by an actual support requirement.

Primary targets:

- `packages/tooling/webstir-backend/tests/integration.test.js`
- `packages/tooling/webstir-backend/src/scaffold/assets.ts` if any wrapper-preservation behavior is still scaffolded
- `packages/tooling/webstir-backend/src/build/**` only if publish output still intentionally preserves unsupported wrappers
- `plans/plan.md`

Acceptance:

- the active plan and package tests no longer imply support for unpublished legacy local runtime wrapper layouts
- any wrapper-preservation proof with no real user backing is removed or replaced with current canonical-path coverage
- supported runtime paths remain green after the unsupported compatibility surface is cut

Merged state:

- the plan and backend package docs no longer describe unpublished wrapper layouts as supported
- the publish-mode package integration proof for local wrapper preservation is removed
- package-local `build`, `test`, and `smoke` are green
- PR #141 merged the slice onto `main`

Out of scope:

- persisted session/flash read compatibility
- speculative request-time hardening for layouts that are not part of the supported product surface
