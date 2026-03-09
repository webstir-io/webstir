# Synchronize Framework Packages

This guide covers the workflow for keeping the archived `.NET` orchestrator framework packages aligned with the canonical npm packages that Bun workspaces consume.

> Historical scope: this page is about `orchestrators/dotnet/Framework/**`. Active Bun workspaces install dependencies with `bun install`; they do not use `webstir install`.

## Overview

- Run commands via `dotnet run --project Framework/Framework.csproj -- packages …` from the repo root (or use a built `framework` binary).
- `packages/tooling/webstir-frontend`, `packages/tooling/webstir-backend`, and `packages/tooling/webstir-testing` are the canonical sources for the published packages.
- `orchestrators/dotnet/Framework/Frontend`, `orchestrators/dotnet/Framework/Backend`, and `orchestrators/dotnet/Framework/Testing` are embedded copies that stay aligned with those canonical packages for the .NET orchestrator.
- Treat those embedded copies as snapshots, not release entrypoints. Release from `packages/**`, then sync the embedded copies.
- Run `bun run sync:framework-embedded` after canonical package changes to rewrite the embedded managed snapshots, including `package.json`, overlapping source/template files, and managed helper stubs.
- `framework packages sync` rebuilds those packages, updates `Framework/Packaging/framework-packages.json`, and refreshes `Engine/Resources/package.json` with caret specifiers.
- Bun workspaces stay aligned through normal `package.json` dependency updates plus `bun install`.

## Update The Packages
1. Release the target npm package from its canonical `packages/**` directory with `npm run release -- <patch|minor|major|x.y.z>` or the Release Package GitHub workflow.
2. Run `bun run sync:framework-embedded` to refresh the embedded `orchestrators/dotnet/Framework/**` package snapshots from the canonical `packages/**` managed files.
3. (Optional) Run `framework packages diff` to preview embedded metadata drift without modifying files.
4. Run `framework packages sync`.
   - Add `--frontend`, `--testing`, or `--backend` to rebuild a single embedded package when only one changed.
   - The command rewrites the manifest and template dependencies with the new versions and caret specifiers. No tarballs are generated.
   - Set `WEBSTIR_FRONTEND_REGISTRY_SPEC`, `WEBSTIR_TEST_REGISTRY_SPEC`, or `WEBSTIR_BACKEND_REGISTRY_SPEC` before running if you need an alternate registry specifier (for example, a dist-tag).
5. Run `framework packages verify`.
   - The verifier ensures package directories, manifest entries, template dependencies, and the repository state are aligned.
   - The check also confirms that no legacy tarball assets remain in the repo.
6. Commit the updated canonical package sources under `packages/tooling/**`, the embedded orchestrator copies under `orchestrators/dotnet/Framework/**`, lockfiles, `Framework/Packaging/framework-packages.json`, and `Engine/Resources/package.json`.

## Active Bun Workspaces
- Run `bun install` in consuming workspaces.
- Keep framework and provider versions explicit in `package.json`.
- Use the archived `.NET` sync commands on this page only when you are deliberately maintaining the historical embedded framework copies.

## Registry Requirements
- Framework installations now rely on registry packages. Configure `.npmrc` with `@webstir-io:registry=https://registry.npmjs.org`.
- Provide the token and `.npmrc` to CI or sandbox environments before executing the Release Package workflow or `bun install`.
- Each publishable `@webstir-io/*` package should configure npm trusted publishing against the same monorepo workflow: `webstir-io/webstir` with `release-package.yml`.
- That shared workflow still publishes only one package per run because it resolves the target package from the `release/<package>/v<version>` tag or the manual workflow `package` input.

## Verify Changes
- Run `./utilities/scripts/format-build.sh` before handing off; it formats code, builds the solution, and executes frontend package tests.
- If you still need to maintain the legacy embedded `.NET` framework copies, run `bun run sync:framework-embedded`, then `framework packages sync`, then `framework packages verify` whenever package artifacts change.
- Optionally trigger the Release Package workflow for a non-production version to confirm npm trusted publishing is configured before the next real release.
- Exercise `bun install` inside a sample workspace to verify the new packages resolve correctly and upgrade existing installations.
