# Getting Started

Install prerequisites and run the CLI locally.

> Historical note: older repo snapshots used the `.NET` orchestrator. The active workflow is the Bun orchestrator in `orchestrators/bun`.

## Prerequisites
- Bun 1.3.x
- Node.js 20.18+ for package/tool compatibility
- TypeScript compiler on PATH if you are working directly on framework packages

## Steps
1) Install dependencies and inspect the Bun CLI

```
# From repo root
bun install
bun run orchestrate:bun -- --help
```

2) Create a new project and start dev mode

```
bun run orchestrate:bun -- init my-app
bun run orchestrate:bun -- watch --workspace "$PWD/my-app"
```

3) Open the printed dev server URL. Edit files under `src/**` to see live reload.

## Next
- Add a page — ../how-to/add-page.md
- Run tests — ../how-to/test.md
- Publish — ../how-to/publish.md
