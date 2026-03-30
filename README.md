# Webstir

Canonical monorepo for the Webstir ecosystem.

## Status

Webstir is still experimental, and it is intentionally focused on a narrow product lane:

- server-first, HTML-first apps
- working forms, links, redirects, and auth before client-side polish
- low-JS progressive enhancement, including optional fragment updates and client-nav

Expect APIs, contracts, generated scaffolds, and workflows to change. Treat the repo as an active framework project, not a production-stable platform. It is not a broad React replacement or an architecture menu. Do not rely on the current Bun APIs and workflows as a long-term compatibility guarantee yet; the supported Bun deployment contract is documented below.

## Layout

- `packages/contracts` — shared contracts consumed by tooling and orchestrators.
- `packages/tooling` — publishable JavaScript/TypeScript tooling packages.
- `apps` — first-party apps and docs sites built on the framework.
- `examples` — demo workspaces that validate consumer flows against local packages.
- `orchestrators` — orchestration runtimes and hosts, including the Bun orchestrator, Bun-owned deployment helpers, and an archived historical `.NET` orchestrator tree.

## Getting Started

```bash
bun install
bun run check:biome
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

- `Biome` is the active repo formatter baseline: use `bun run format` to rewrite supported files and `bun run check:biome` to enforce the required formatting gate.
- `bun run lint` is part of the required repo gate alongside `bun run check:biome`.
- `bun run check:required` mirrors the CI gate; `bun run check:release` extends that gate with the recipe-app benchmark so release readiness is a concrete pass/fail state.
- Published npm package names remain unchanged.
- `orchestrators/dotnet` remains in-tree as a frozen historical snapshot only; active local workflows, releases, and package maintenance go through the Bun monorepo.
- For Bun scaffolds and bundled feature assets, edit `orchestrators/bun/resources/**`; `orchestrators/bun/assets/**` is generated package content and is verified by `bun run --filter @webstir-io/webstir check:assets`.
- Supported Bun deployment contract for published `api` and `full`: `orchestrators/bun/resources/deployment/docker`; `orchestrators/bun/assets/deployment/docker` is the generated packaged copy.
- Demo and app workspaces are kept in-repo so they can validate against local package changes.
