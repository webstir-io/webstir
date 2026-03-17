# Webstir Monorepo Migration

## Goal

Consolidate the Webstir ecosystem into one repository while preserving the current published npm package names and avoiding consumer-facing breakage during the migration.

## Principles

- Keep package names unchanged.
- Keep API exports and consumer-facing project layouts stable.
- Treat repository consolidation and product-surface changes as separate efforts.
- Move code in phases; do not refactor package internals during the same step unless required for workspace wiring.
- Keep the current nested repositories intact until the monorepo flow is proven.

## Current State

The current workspace root contains multiple standalone repositories:

- `module-contract`
- `testing-contract`
- `webstir-backend`
- `webstir-frontend`
- `webstir-testing`
- `webstir-portal`
- `webstir-dotnet`
- `webstir-demos`
- `webstir-workspace`

This root now acts as a bootstrap monorepo shell for the JavaScript/TypeScript packages that already have the strongest coupling:

- `module-contract`
- `testing-contract`
- `webstir-backend`
- `webstir-frontend`
- `webstir-testing`
- `webstir-portal`

The .NET and demo repositories stay out of the initial workspace because they either contain mirrored framework packages or are better imported after the package/tooling lane is stable.

## Target Layout

The desired end state is one repository with multiple package families:

```text
packages/
  contracts/
    module-contract/
    testing-contract/
  tooling/
    webstir-backend/
    webstir-frontend/
    webstir-testing/
apps/
  portal/
examples/
  demos/
dotnet/
  webstir/
tools/
  workspace/
```

## Phases

### Phase 1: Root Shell

- Add root workspace files.
- Limit the initial workspace to the core JS/TS contract and tooling packages.
- Verify root-level orchestration commands work without changing package internals.

### Phase 2: Contract Lane

- Move `module-contract` and `testing-contract` under `packages/contracts/`.
- Verify their build and test commands from the monorepo root.
- Keep package names and published outputs unchanged.
- Status: imported as working copies under `packages/contracts/`; legacy nested repositories remain in place but are no longer part of the root workspace.
- Verification: `pnpm --filter @webstir-io/module-contract build`, `pnpm --filter @webstir-io/module-contract test`, `pnpm --filter @webstir-io/testing-contract build`, and `pnpm --filter @webstir-io/testing-contract test` pass from the root.

### Phase 3: Tooling Lane

- Move `webstir-backend`, `webstir-frontend`, and `webstir-testing` under `packages/tooling/`.
- Switch their internal cross-package dependencies to local workspace resolution during development.
- Validate downstream build/test/smoke flows from the root.
- Status: imported as working copies under `packages/tooling/`; legacy nested repositories remain in place but are no longer part of the root workspace.
- Verification: `pnpm --filter @webstir-io/webstir-backend build`, `pnpm --filter @webstir-io/webstir-backend test`, `pnpm --filter @webstir-io/webstir-frontend build`, `pnpm --filter @webstir-io/webstir-frontend test`, `pnpm --filter @webstir-io/webstir-testing build`, and `pnpm --filter @webstir-io/webstir-testing test` pass from the root.
- Notes: importing `webstir-frontend` into the workspace exposed an undeclared direct dependency on `domhandler`, which is now declared explicitly in the imported package.

### Phase 4: Apps and Examples

- Move `webstir-portal` to `apps/portal`.
- Move `webstir-demos` to `examples/demos`.
- Make apps/examples consume workspace packages for pre-publish validation.
- Status: `webstir-portal` is imported under `apps/`; `webstir-demos` is imported under `examples/demos`.
- Verification:
  - `pnpm --filter webstir-portal build` passes from the root.
  - `pnpm --dir examples/demos/spa exec webstir-frontend build --workspace /Users/iamce/dev/webstir-io/examples/demos/spa` passes.
  - `pnpm --dir examples/demos/ssg/site exec webstir-frontend build --workspace /Users/iamce/dev/webstir-io/examples/demos/ssg/site` passes.
  - `pnpm --dir examples/demos/ssg/site exec webstir-frontend publish --workspace /Users/iamce/dev/webstir-io/examples/demos/ssg/site --mode ssg` passes.
- Notes:
  - importing `webstir-portal` exposed a Docusaurus assumption that git metadata is always available for last-update timestamps; the imported app now enables that only when `.git` is present in the app or repository ancestors.
  - importing `webstir-portal` also exposed an undeclared direct dependency on `@docusaurus/theme-common`, which is now declared explicitly.
  - the imported demo projects were normalized to unique private package names and can now live in the root workspace safely.
  - the imported demo utility scripts were updated to resolve the workspace root and local provider paths from `examples/demos`, which is two levels deeper than the legacy repository root.

### Phase 5: .NET Import

- Move `webstir-dotnet` to `orchestrators/dotnet`.
- Keep the .NET solution layout intact on first import.
- Resolve overlap with mirrored framework packages only after the import is stable.
- Status: the .NET orchestrator tree is imported under `orchestrators/dotnet`.
- Verification:
  - `dotnet build Webstir.sln -v minimal` passes from `orchestrators/dotnet`.
  - `dotnet run --project orchestrators/dotnet/CLI -- --help` passes from the repository root.
- Notes:
  - `examples/demos` now target `orchestrators/dotnet/CLI` instead of the legacy `webstir-dotnet/CLI` path.
  - the imported orchestrator remains outside the root `pnpm` workspace graph; it keeps its own .NET solution and Bun workspace behavior intact.

### Phase 6: Cleanup

- Replace duplicated per-repo automation with root-level automation where it reduces maintenance cost.
- Archive old repositories only after the monorepo builds, tests, and publishes cleanly.
- Sweep remaining legacy path references (`webstir-dotnet`, legacy repo folder names) in docs, maintainer scripts, and agent instructions once the new repository layout is settled.
- Status: the inactive `apps/hub` workspace has been removed from the monorepo after CI, workspace metadata, and lockfile cleanup detached it from active tooling.

## Immediate Next Step

The next implementation slice is follow-up cleanup: decide whether `apps/portal` should remain in the required CI gate, align remaining Bun version declarations, and keep sweeping docs/maintainer references that still assume the old multi-repo layout.
