# Webstir

Canonical monorepo for the Webstir ecosystem.

## Layout

- `packages/contracts` — shared contracts consumed by tooling and orchestrators.
- `packages/tooling` — publishable JavaScript/TypeScript tooling packages.
- `apps` — first-party apps and docs sites built on the framework.
- `examples` — demo workspaces that validate consumer flows against local packages.
- `orchestrators` — non-JS orchestration runtimes and hosts, including the .NET orchestrator.

## Getting Started

```bash
pnpm install
pnpm --filter @webstir-io/module-contract test
pnpm --filter @webstir-io/webstir-frontend test
pnpm --filter webstir-portal build
dotnet build orchestrators/dotnet/Webstir.sln -v minimal
```

## Notes

- Published npm package names remain unchanged.
- The .NET orchestrator lives under `orchestrators/dotnet`.
- Demo and app workspaces are kept in-repo so they can validate against local package changes.
