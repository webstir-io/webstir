# Webstir Core Hardening Plan

## Goal

Reduce the highest-risk product and platform flaws in Webstir without trying to redesign the whole stack in one pass.

This plan focuses on the issues that most directly affect correctness, production reliability, security patchability, and release confidence:

- build and publish commands can succeed while carrying internal provider errors
- core backend runtime behavior lives in copied scaffold files instead of upgradeable package code
- sessions, flash state, and CSRF state are process-local by default
- CI does not exercise enough scaffolded end-to-end behavior
- runtime path resolution still depends too heavily on `process.cwd()`

## Principles

- Fix failure semantics before deeper architecture.
- Prefer small, enforceable contracts over broad rewrites.
- Keep developer ergonomics for local demos, but stop treating dev-only shortcuts as production defaults.
- Move core behavior into versioned packages wherever upgrades need to carry fixes.
- Add CI coverage for the exact seams that are currently most likely to drift.

## Current Problems

### 1. Silent build degradation

Provider-level failures can be recorded as diagnostics while `webstir build` and `webstir publish` still exit successfully. That weakens trust in the toolchain and makes CI less meaningful.

### 2. Runtime drift from scaffold copying

The backend scaffold copies auth, session, form, view, job, and DB runtime files into each workspace. That makes Webstir upgrades weak as an operational control: patching a runtime bug does not automatically fix downstream apps.

### 3. Dev defaults look like platform defaults

The current session and form runtime relies on in-process memory. That is acceptable for demos, but it is not acceptable as the implicit baseline for multi-instance or restart-prone deployments.

### 4. CI under-covers integration risk

Unit and package tests exist, but the highest-risk layer is the interaction between orchestrator, templates, generated workspaces, and runtime behavior. That needs stronger mainline coverage.

### 5. Runtime path assumptions are brittle

Some request-time behavior still depends on launch directory rather than explicit workspace resolution. That creates avoidable deployment sharp edges.

## Scope

In scope:

- build and publish failure semantics
- CI and smoke coverage for scaffolded flows
- backend runtime extraction from copied templates
- session and form state storage abstractions
- path resolution hardening for backend runtime behavior

Out of scope for this plan:

- major frontend design changes
- rethinking the module contract from scratch
- replacing Bun orchestration entirely
- a full Webstir product repositioning

## Workstreams

### Workstream 1: Make build failures real

Objective:
Ensure provider errors cause non-zero exits in local CLI flows and CI.

Tasks:

- Treat provider `error` diagnostics as fatal for `build` and `publish`.
- Preserve `warn` and `info` diagnostics as non-fatal output.
- Make the CLI return a non-zero exit code when any target reports fatal diagnostics.
- Add tests that prove invalid backend manifests and similar provider failures fail the command.

Success criteria:

- `webstir build` cannot print a success summary if any target reported an error diagnostic.
- `webstir publish` behaves the same way.
- CI can rely on command exit status instead of parsing text summaries.

### Workstream 2: Raise CI confidence on real workflows

Objective:
Catch scaffold, orchestration, and runtime regressions before merge.

Tasks:

- Add package smoke coverage for backend and frontend where practical.
- Add at least one end-to-end workspace smoke path in PR CI.
- Keep coverage focused on the flows most likely to regress:
  - scaffold/init
  - build
  - publish
  - backend runtime startup
  - request-time document flow
  - form/session behavior

Success criteria:

- A broken template sync, scaffold drift, or orchestrator/runtime mismatch fails PR CI.
- Core product claims are exercised by at least one mainline workflow, not just release-time checks.

### Workstream 3: Extract backend runtime from copied scaffolds

Objective:
Move operationally important logic into upgradeable package code.

Tasks:

- Define which backend files are true customization surfaces and which are framework runtime.
- Add stable runtime exports from `@webstir-io/webstir-backend`.
- Change scaffolded app files to import package-managed runtime helpers instead of owning the full implementations.
- Preserve app-level extension points for hooks, route definitions, auth adapters, and DB wiring.
- Add a migration path for existing workspaces so this does not require a flag day.

Success criteria:

- Fixing a runtime bug in the package can reach apps through a normal dependency upgrade.
- Scaffolded app files become thinner and easier to audit.
- Drift between package intent and generated app behavior drops materially.

### Workstream 4: Introduce durable state boundaries

Objective:
Stop treating in-memory state as the implicit platform baseline.

Tasks:

- Define a storage contract for sessions and form-state persistence.
- Keep the current memory implementation as an explicit dev adapter.
- Add at least one durable adapter path suitable for real deployments.
- Separate framework semantics from storage choice:
  - cookie signing
  - session lifecycle
  - flash message handling
  - CSRF token lifecycle
  - invalid/expired session handling
- Document deployment expectations clearly.

Success criteria:

- Sessions and form state can survive restarts when using a durable adapter.
- Multi-instance deployments are no longer structurally broken by default.
- Demo ergonomics remain intact for local workflows.

### Workstream 5: Remove hidden path assumptions

Objective:
Make runtime behavior depend on explicit workspace resolution rather than process launch quirks.

Tasks:

- Thread resolved workspace roots through request-time rendering paths.
- Eliminate `process.cwd()` dependence in backend request-time document resolution.
- Apply the same fix to the Fastify scaffold/runtime path.
- Add tests for running from a non-workspace current directory.

Success criteria:

- Backend runtime behavior is stable regardless of launch directory.
- SSR and document loading work the same in local dev, CI, and deployed environments.

## Proposed Sequence

### Phase 1: Trust the toolchain

- Workstream 1
- Workstream 2

Rationale:
There is little value in deeper architecture work if build, publish, and CI still allow false positives.

### Phase 2: Make runtime fixes upgradeable

- Workstream 3

Rationale:
This is the highest-leverage architectural change because it improves patchability and reduces template drift.

### Phase 3: Make state handling production-capable

- Workstream 4

Rationale:
State durability and multi-instance safety matter most after runtime ownership is in the package layer.

### Phase 4: Tighten operational correctness

- Workstream 5

Rationale:
This is smaller in scope, but it removes deployment sharp edges that will continue to cause confusing failures until addressed.

## Milestones

### Milestone A: Honest builds

- `webstir build` and `webstir publish` fail on provider error diagnostics
- tests cover fatal-diagnostic behavior
- CI reflects the new failure model

### Milestone B: Better regression coverage

- PR CI runs scaffold-aware smoke coverage
- at least one workspace e2e path is gated on every PR

### Milestone C: Upgradeable backend runtime

- scaffolded backend files import package runtime helpers
- existing workspaces have a migration path
- core auth/session/form/view runtime behavior is versioned centrally

### Milestone D: Durable session model

- storage contract exists
- dev memory adapter remains available
- durable adapter path is documented and tested

### Milestone E: Deployment-safe path handling

- request-time view rendering no longer depends on `process.cwd()`
- launch-directory regression tests exist

## Risks

- Runtime extraction can create awkward compatibility edges for existing scaffolded workspaces.
- Stronger CI smoke coverage will increase PR runtime and may require trimming lower-value checks elsewhere.
- Session storage abstraction can sprawl if the first interface tries to solve too many deployment models at once.
- If package-managed runtime APIs are too unstable, the migration may simply shift drift to a different layer.

## Decisions To Make Early

- Which backend runtime surfaces are framework-owned versus app-owned.
- Whether durable session storage should ship with a default adapter or only an interface plus examples.
- How strict fatal diagnostics should be for local developer flows beyond `build` and `publish`.
- Which smoke scenarios are mandatory on every PR versus release-only.

## Immediate Next Step

Start with Milestone A:

- make build and publish fail on error diagnostics
- add tests for that behavior
- update CI so the command contract is enforced in mainline automation

This is the smallest slice with the highest immediate risk reduction.
