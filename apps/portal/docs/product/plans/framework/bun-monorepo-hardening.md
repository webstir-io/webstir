# Bun Monorepo Hardening Plan

> Status: proposed. Scope is limited to the active TypeScript/Bun monorepo surfaces: `packages/**`, `apps/**`, `examples/**`, and `orchestrators/bun/**`.

## Problem Statement
- The Bun workflow is the active path, but the repository contract has drifted around it.
- Active docs still describe archived `.NET` architecture and unsupported CLI behavior.
- The Bun orchestrator still pulls feature assets from `orchestrators/dotnet`, so the archived tree is not actually archival.
- PR CI validates package internals well, but it does not cover enough consumer-facing surfaces before release.
- The active monorepo has no lint/style gate, so consistency and low-signal regressions depend too heavily on manual review.

## Goals
- Make active docs truthful about the Bun-first architecture and CLI surface.
- Remove active Bun build dependencies on the archived `.NET` tree.
- Catch scaffold, app, and install-path regressions during PR CI instead of at release time.
- Add a repo-native style/static-analysis gate for the active TypeScript/Bun codebase.
- Align package metadata and README status messaging with the actual product surface.

## Non-Goals
- Large feature work unrelated to trust, validation, or source-of-truth cleanup.
- Rewriting the archived `.NET` tree or restoring it as a supported runtime.
- Converting every historical plan or archival doc in one pass.
- Imposing lint/style tooling on `orchestrators/dotnet/**`.

## Current Gaps

### 1. Docs Truth Gap
- Portal docs still describe the old ASP.NET/.NET runtime in active explanation and how-to pages.
- CLI workflow docs promise flags and behavior that the live Bun CLI does not expose.
- Contributors and external users cannot reliably tell which docs are active guidance versus historical context.

### 2. Archive Boundary Gap
- Bun-owned resources now back `orchestrators/bun/scripts/sync-assets.mjs`, but the archive boundary still needs explicit CI enforcement and doc hygiene so the decoupling stays visible and durable.
- Without that guardrail, future changes could quietly reintroduce archived-tree assumptions or leave active docs describing the old ownership model.

### 3. Consumer-Coverage Gap
- PR CI runs package tests and orchestrator tests, but first-party app verification is too light.
- Package smoke scripts exist, but they run during release workflows rather than as part of normal PR validation.
- There is no dedicated install-from-packed-artifact or external-workspace verification for the current Bun CLI publish surface.

### 4. Static-Analysis Gap
- The active monorepo exposes `build`, `test`, and `smoke`, but no standard `lint` or `format:check` workflow.
- CI therefore cannot enforce import hygiene, dead-code cleanup, formatting consistency, or common TypeScript style rules.

### 5. Product-Positioning Gap
- Some package manifests and READMEs still describe active packages as future, reserved, or experimental in ways that no longer match the repo story.
- The public surface needs one clear answer for what is supported, what is provisional, and what is archival.

## Workstreams

### 1. Docs Truth Pass
- Audit active docs under `apps/portal/docs/**` for stale `.NET`, ASP.NET, Kestrel, xUnit, and unsupported CLI references.
- Add explicit archival framing where historical references must remain.
- Update workflow/reference docs to match the live Bun CLI help output exactly.
- Prefer generating or snapshotting CLI docs from the Bun help surface where practical so the docs cannot drift silently again.

Validation:
- `bun run --filter webstir-portal build`
- Grep checks show no unqualified `.NET` runtime guidance outside intentionally historical docs.

### 2. Decouple Bun Assets From `orchestrators/dotnet`
- Move the remaining active feature assets (`router`, `search`, `content_nav`, and any related shared files) into Bun-owned sources.
- Define a single source of truth for scaffold templates and reusable feature assets.
- Add a guardrail test or script that fails if `orchestrators/bun/**` reads from `orchestrators/dotnet/**`.

Validation:
- `bun run --filter @webstir-io/webstir build`
- Asset sync/build steps succeed without Bun code reading from the archived tree.

### 3. Promote Consumer-Path Checks Into PR CI
- Done: added one packaged Bun CLI install smoke that packs the orchestrator, installs it into a fresh temp workspace, scaffolds a site, and runs `webstir build` as part of normal CI.
- Done: added one regular packaged-install smoke that installs the non-standalone Bun CLI into a fresh temp root, scaffolds a sibling external workspace, and verifies published dependency resolution before `webstir build`.
- Done: extended the regular packaged-install smoke to run `webstir add-test` in that external workspace, assert the generated test file on disk, and confirm the workspace still builds afterward.
- Run consumer-path checks against maintained first-party surfaces, not abandoned rewrite workspaces.
- Run package smoke checks in PR CI when tooling/templates/assets change, with path filtering if needed to keep runtime bounded.
- Add at least one packed-artifact or external-workspace install check for the Bun CLI publish surface.
- Follow-up: broaden regular packaged-install command coverage beyond `add-test`, starting with the remaining `webstir test` published-runtime gap and then backend add commands if they stay within the published dependency surface.
- Keep the release workflow, but make it the final publish gate rather than the first place smoke/install regressions can appear.

Validation:
- CI catches maintained app/test/template/install regressions before merge.
- Release workflow becomes confirmation, not discovery.

### 4. Add Style And Static-Analysis Gates
- Choose a single active-tooling story for the Bun/TypeScript tree: preferably Biome unless repo-specific ESLint rules justify a split stack.
- Add root commands such as `bun run lint` and `bun run format:check`.
- Roll out in phases so archived `.NET` code stays excluded and active trees can converge without one massive diff.

Validation:
- New root check commands run locally and in CI.
- Active TS/Bun directories have an enforceable formatting and lint baseline.

### 5. Align Public Package Messaging
- Update `package.json` descriptions, README status sections, and install guidance to match the real maturity of each package.
- Remove contradictory “future/reserved” phrasing from packages that are already on the active path.
- Keep experimental language only where the behavior is genuinely unstable and say what that means concretely.

Validation:
- Package metadata, README copy, and repo docs tell the same support story.

## Suggested Sequence
1. Docs truth pass and package messaging cleanup.
2. Bun/dotnet asset decoupling.
3. PR-time consumer/smoke/install coverage.
4. Lint/style rollout for active TS/Bun trees.

## Risks And Mitigations
- Docs cleanup may uncover more stale material than expected.
  Start with active docs and clearly mark the rest as historical instead of trying to perfect every archival page immediately.
- CI runtime may grow too much.
  Use path-based triggers, parallel jobs, and a small set of canonical smoke/install fixtures.
- Asset decoupling can create churn across templates and demos.
  Pick one canonical source, migrate in one direction, and add a guard to keep it stable.
- Lint rollout can create noisy mechanical diffs.
  Stage the rollout by directory and land formatting separately from semantic changes.

## Success Criteria
- Active docs no longer describe the archived `.NET` runtime as current.
- `orchestrators/bun/**` no longer depends on `orchestrators/dotnet/**` for active assets.
- PR CI runs meaningful consumer-path checks, including app tests and relevant smoke/install verification.
- The repo has a standard lint/style gate for active TS/Bun code.
- Public package metadata and READMEs align with the actual product surface.

## Open Questions
- Which lint stack should own the active monorepo: Biome, ESLint + Prettier, or a staged hybrid?
- Which workspace should be the canonical packed-artifact/install smoke fixture for the Bun CLI?
- After decoupling, should `orchestrators/dotnet` remain in-tree indefinitely or move to a long-lived archive branch later?
