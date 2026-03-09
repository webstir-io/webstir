# Build Framework Packages

This guide explains how maintainers keep the archived `.NET` orchestrator framework copies aligned with the canonical npm packages that ship with Webstir.

> Historical scope: this page is for maintaining `orchestrators/dotnet/Framework/**`. Active Bun workspaces do not use `webstir install`; manage dependencies with `bun install`.

## Overview
- `packages/tooling/webstir-frontend`, `packages/tooling/webstir-backend`, and `packages/tooling/webstir-testing` are the canonical sources for the published `@webstir-io/*` packages.
- `orchestrators/dotnet/Framework/Frontend`, `orchestrators/dotnet/Framework/Backend`, and `orchestrators/dotnet/Framework/Testing` are embedded copies kept in sync for the .NET orchestrator.
- Release and dependency updates happen from the canonical `packages/**` directories, not from the embedded copies.
- After canonical package changes, run `bun run sync:framework-embedded` to refresh the embedded snapshots, including managed `package.json` fields, overlapping source/template files, and managed helper stubs under `orchestrators/dotnet/Framework/**`.
- The standalone `framework` console rebuilds those packages, records registry metadata in `Framework/Packaging/framework-packages.json`, and updates `Engine/Resources/package.json` so workspace templates stay in sync.
- Bun workspaces consume those canonical packages through normal `package.json` dependencies plus `bun install`.

## Update The Packages
1. **Release canonical packages first** – Publish the target npm package from its canonical `packages/**` directory with `npm run release -- <patch|minor|major|x.y.z>` or the Release Package GitHub workflow.
2. **Sync embedded snapshots** – Run `bun run sync:framework-embedded` to copy canonical managed files into `orchestrators/dotnet/Framework/**`.
3. **Optional diff** – Run `dotnet run --project Framework/Framework.csproj -- packages diff` to compare the embedded orchestrator metadata with the recorded registry metadata. A non-zero exit code indicates version, registry specifier, or workspace specifier drift.
4. **Refresh orchestrator metadata** – Run `dotnet run --project Framework/Framework.csproj -- packages sync` from the repo root (or invoke the published `framework` binary).
   - Add `--frontend`, `--testing`, or `--backend` to rebuild a single package.
   - The command rebuilds the embedded `Framework/**` copies, then rewrites `framework-packages.json` and `Engine/Resources/package.json` with the new versions and caret specifiers.
   - Set `WEBSTIR_FRONTEND_REGISTRY_SPEC`, `WEBSTIR_TEST_REGISTRY_SPEC`, or `WEBSTIR_BACKEND_REGISTRY_SPEC` before running if you need to override the default `<name>@<version>` registry specifier (for example, to target a dist-tag during validation).
5. **Verify metadata** – Run `dotnet run --project Framework/Framework.csproj -- packages verify` to confirm that the embedded package sources, manifest entries, template dependencies, and repository state are aligned. The verifier also ensures no legacy tarball assets remain.
6. **Commit artifacts** – Include the updated canonical package sources under `packages/tooling/**`, the embedded orchestrator copies under `orchestrators/dotnet/Framework/**`, lockfiles, `Framework/Packaging/framework-packages.json`, and `Engine/Resources/package.json` in your PR.

## Release Path
- Do not use `framework packages release` or `framework packages publish` in this monorepo. Those commands are retained only for legacy compatibility outside the canonical monorepo layout.
- Release npm packages from the canonical `packages/**` directories with `npm run release -- <patch|minor|major|x.y.z>`, or trigger the **Release Package** GitHub workflow for the specific package.
- On npm, each publishable `@webstir-io/*` package should trust the same GitHub Actions publisher: `webstir-io/webstir` with workflow file `release-package.yml`.
- The shared workflow stays package-scoped because it resolves a single canonical package from either the `release/<package>/v<version>` tag format or the manual `package` workflow input before it builds or publishes.
- After a canonical release, run `bun run sync:framework-embedded` and then `framework packages sync` / `framework packages verify` if the archived orchestrator metadata needs to follow that release immediately.

## Developer Helpers
- Run `dotnet run --project Framework/Framework.csproj -- packages diff` to see how the embedded sources compare to the recorded manifest before touching tracked files.
- Before committing frontend/testing/backend changes that must also update the archived `.NET` copies, run `bun run sync:framework-embedded`, then `dotnet run --project Framework/Framework.csproj -- packages sync`, then `dotnet run --project Framework/Framework.csproj -- packages verify`.
- Use `dotnet run --project Framework/Framework.csproj -- packages bump --dry-run --bump patch` only when you are previewing or adjusting embedded orchestrator package versions, not canonical npm package releases.

## Active Bun Workspaces
- Bun workspaces install dependencies with `bun install`.
- Provider packages and framework packages are ordinary workspace dependencies recorded in `package.json`.
- There is no active Bun `webstir install` command.

## Registry Notes
- Framework installs now rely on npmjs registry packages. Configure `.npmrc` with `@webstir-io:registry=https://registry.npmjs.org`.
- For Sandbox or CI scenarios, provision the token and `.npmrc` before executing the Release Package workflow or `bun install`.

## Verify Changes
- Run `./utilities/scripts/format-build.sh` to ensure formatting passes, the solution builds, and frontend tests succeed.
- If you still need to maintain the legacy embedded `.NET` framework copies, run `bun run sync:framework-embedded`, then `framework packages sync`, then `framework packages verify`.
- In a throwaway Bun workspace, run `bun install` to confirm the packages resolve from the registry and the dependency graph remains healthy.
- Optionally trigger the Release Package workflow manually for a non-production version to verify npm trusted publishing configuration before the next real release.
