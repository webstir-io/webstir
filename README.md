# Webstir

Canonical monorepo for the Webstir ecosystem.

## Layout

- `packages/contracts` — shared contracts consumed by tooling and orchestrators.
- `packages/tooling` — publishable JavaScript/TypeScript tooling packages.
- `apps` — first-party apps and docs sites built on the framework.
- `examples` — demo workspaces that validate consumer flows against local packages.
- `orchestrators` — orchestration runtimes and hosts, including the Bun orchestrator and an archived historical `.NET` orchestrator tree.

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
bun run webstir -- init ssg ./my-site
bun run watch:spa
bun run watch:ssg:base
bun run watch:api
bun run watch:full
```

You can also target a workspace directly:

```bash
bun run webstir -- watch --workspace "$PWD/examples/demos/full"
bun run webstir -- publish --workspace "$PWD/examples/demos/ssg/site"
```

## Notes

- Published npm package names remain unchanged.
- `orchestrators/dotnet` remains in-tree for historical reference only; active local workflows should go through `orchestrators/bun`.
- Demo and app workspaces are kept in-repo so they can validate against local package changes.
