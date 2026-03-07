# Synchronize Framework Packages

This guide covers the end-to-end workflow for keeping the embedded orchestrator framework packages aligned with the canonical npm packages that Webstir workspaces consume.

## Overview

- Run commands via `dotnet run --project Framework/Framework.csproj -- packages …` from the repo root (or use a built `framework` binary).
- `packages/tooling/webstir-frontend`, `packages/tooling/webstir-backend`, and `packages/tooling/webstir-testing` are the canonical sources for the published packages.
- `orchestrators/dotnet/Framework/Frontend`, `orchestrators/dotnet/Framework/Backend`, and `orchestrators/dotnet/Framework/Testing` are embedded copies that stay aligned with those canonical packages for the .NET orchestrator.
- Treat those embedded copies as snapshots, not release entrypoints. Release from `packages/**`, then sync the embedded copies.
- Run `pnpm run sync:framework-embedded` after canonical package changes to rewrite the embedded managed snapshots, including `package.json`, overlapping source/template files, and managed helper stubs.
- `framework packages sync` rebuilds those packages, updates `Framework/Packaging/framework-packages.json`, and refreshes `Engine/Resources/package.json` with caret specifiers.
- `webstir install` keeps consuming workspaces aligned with the recorded registry versions by updating `package.json` specifiers and running the configured package manager (pnpm by default) when drift is detected.

## Update The Packages
1. Release the target npm package from its canonical `packages/**` directory with `npm run release -- <patch|minor|major|x.y.z>` or the Release Package GitHub workflow.
2. Run `pnpm run sync:framework-embedded` to refresh the embedded `orchestrators/dotnet/Framework/**` package snapshots from the canonical `packages/**` managed files.
3. (Optional) Run `framework packages diff` to preview embedded metadata drift without modifying files.
4. Run `framework packages sync`.
   - Add `--frontend`, `--testing`, or `--backend` to rebuild a single embedded package when only one changed.
   - The command rewrites the manifest and template dependencies with the new versions and caret specifiers. No tarballs are generated.
   - Set `WEBSTIR_FRONTEND_REGISTRY_SPEC`, `WEBSTIR_TEST_REGISTRY_SPEC`, or `WEBSTIR_BACKEND_REGISTRY_SPEC` before running if you need an alternate registry specifier (for example, a dist-tag).
5. Run `framework packages verify`.
   - The verifier ensures package directories, manifest entries, template dependencies, and the repository state are aligned.
   - The check also confirms that no legacy tarball assets remain in the repo.
6. Commit the updated canonical package sources under `packages/tooling/**`, the embedded orchestrator copies under `orchestrators/dotnet/Framework/**`, lockfiles, `Framework/Packaging/framework-packages.json`, and `Engine/Resources/package.json`.

## Install In A Workspace
- Run `webstir install` (or any workflow that indirectly calls it) in the consuming project.
- The installer rewrites the framework package entries in `package.json`, clears stale caches when necessary, and runs the selected package manager so `node_modules` matches the recorded registry versions.
- Use `webstir install --dry-run` to see what would change before reinstalling dependencies.
- Use `webstir install --clean` to delete the cached `.webstir/` directory before reinstalling.

## Registry Requirements
- Framework installations now rely on registry packages. Configure `.npmrc` with `@webstir-io:registry=https://registry.npmjs.org`. Corepack users should run `corepack enable` so pnpm is available.
- Provide the token and `.npmrc` to CI or sandbox environments before executing the Release Package workflow or `webstir install`.
- Each publishable `@webstir-io/*` package should configure npm trusted publishing against the same monorepo workflow: `webstir-io/webstir` with `release-package.yml`.
- That shared workflow still publishes only one package per run because it resolves the target package from the `release/<package>/v<version>` tag or the manual workflow `package` input.

## Verify Changes
- Run `./utilities/scripts/format-build.sh` before handing off; it formats code, builds the solution, and executes frontend package tests.
- If you still need to maintain the legacy embedded `.NET` framework copies, run `pnpm run sync:framework-embedded`, then `framework packages sync`, then `framework packages verify` whenever package artifacts change.
- Optionally trigger the Release Package workflow for a non-production version to confirm npm trusted publishing is configured before the next real release.
- Exercise `webstir install` (optionally with `--clean`) inside a sample workspace to verify the new packages resolve correctly and upgrade existing installations.
