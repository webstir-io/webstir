# Webstir Plan

> Source of truth: this is the single active execution plan for the repo. Other plan docs are roadmap or archival context unless this file explicitly pulls them in.

## Goal

Reduce the highest-risk product and platform flaws in Webstir without trying to redesign the whole stack in one pass.

This plan stays focused on the issues that most directly affect correctness, upgradeability, production trust, and release confidence:

- backend runtime behavior still lives too heavily in scaffolded app files instead of upgradeable package code
- the default backend scaffold/runtime story is split between Bun-first product messaging and a `node:http` default
- sessions, flash state, and CSRF state still need clearer durable boundaries
- request-time runtime behavior still has path-resolution sharp edges
- plan docs have drifted into multiple overlapping sources of truth

## Planning Policy

- `plans/plan.md` is the only active execution plan.
- `plans/**` files other than this one are historical/reference unless called out here.
- `apps/portal/docs/product/plans/**` is archival/background material, not the live execution source of truth.
- If a roadmap page conflicts with this file, current code, or active docs, this file loses only to current code and active docs.

## Current Decisions

- Bun is the default backend runtime direction for fresh scaffolds.
- `node:http` remains supported only as an explicit compatibility/opt-in path.
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

### Active

- Milestone C slices A-C are done: the fresh-scaffold backend now defaults to the package-managed Bun runtime and no longer copies framework-owned runtime wrappers.
- The remaining `full` scaffold now uses the same thin package-managed Bun entry shape as `api`, while keeping the progressive-enhancement demo module and install/add-route coverage intact.
- External copied/temp workspaces used by orchestrator `smoke` and `test` now materialize repo-local package dependencies before backend runtime execution, so the thin runtime shape stays green outside the monorepo tree.
- Plan-source consolidation is done: `plans/plan.md` is the sole active execution plan.
- The non-default Fastify request-time path-hardening slice is done locally: request-time document rendering now threads an explicit workspace root and package-local build/test/smoke coverage is green, including alternate-cwd `WEBSTIR_WORKSPACE_ROOT` regression coverage.
- Workstream 4 is active again with a bounded session/form/CSRF storage-boundary slice in `packages/tooling/webstir-backend`.

### Queued

- Durable state follow-ups beyond the bounded session/form/CSRF storage-boundary slice.
- Any residual request-time path-resolution cleanup in legacy compatibility layouts that still bypass the shared workspace-root seam.

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
- Move `node:http` to an explicit compatibility/opt-in path instead of the default fresh-scaffold server.
- Stop copying framework-owned runtime wrappers once the thin Bun-first entry works.
- Preserve compatibility for existing workspaces without requiring a flag day.

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

### Workstream 4 Slice A: Session/Form/CSRF Storage Boundary

This is the current active implementation track.

Status:

- Done locally.

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

Local status:

- package-local `build`, `test`, and `smoke` are green
- targeted `sessionStore` and `sessionScaffoldStore` coverage is green
- diff-local slop/review pass is clean and ready for PR
- PR #138 is open for the slice on `codex/session-runtime-boundary`

Out of scope:

- new durable adapters beyond the current in-memory and SQLite stores
- broader auth/session API redesign
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
- keep app-owned scaffold surfaces intact while preserving explicit compatibility paths for older layouts

Acceptance:

- fresh backend scaffolds no longer own the runtime core
- only app-owned customization surfaces remain scaffolded

#### Slice C: Compatibility coverage

Prove both the new scaffold shape and the old compatibility path.

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
- existing copied-runtime workspaces still build/run

#### Slice D: Follow-up runtime parity

Do not mix this into the active slice.

Later work:

- move Fastify and any remaining alternate runtimes onto the same package-owned seams
- keep `node:http` only as the explicit compatibility path that is still justified by real usage

## Validation

Required checks for the active durable-state slice:

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

Return to the remaining durable-state boundary work, unless review or merge follow-up exposes another legacy request-time path-resolution seam that still depends on launch-directory behavior.
