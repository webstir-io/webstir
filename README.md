# Webstir

Canonical monorepo for the Webstir ecosystem.

## Layout

- `packages/contracts` — shared contracts consumed by tooling and orchestrators.
- `packages/tooling` — publishable JavaScript/TypeScript tooling packages.
- `apps` — first-party apps and docs sites built on the framework.
- `examples` — demo workspaces that validate consumer flows against local packages.
- `orchestrators` — orchestration runtimes and hosts, including the Bun orchestrator and the legacy .NET orchestrator.

## Getting Started

```bash
bun install
bun run --filter @webstir-io/module-contract test
bun run --filter @webstir-io/webstir-frontend test
bun run --filter webstir-portal build
```

## Bun Dev Loop

The Bun orchestrator is the primary local workflow now:

```bash
bun run watch:spa
bun run watch:ssg:base
bun run watch:api
bun run watch:full
```

You can also target any workspace directly:

```bash
bun run orchestrate:bun -- watch --workspace "$PWD/examples/demos/full"
bun run orchestrate:bun -- publish --workspace "$PWD/examples/demos/ssg/site"
```

## Notes

- Published npm package names remain unchanged.
- `orchestrators/dotnet` still exists for legacy `init` flows, but normal build/publish/watch/enable usage should go through `orchestrators/bun`.
- Demo and app workspaces are kept in-repo so they can validate against local package changes.
