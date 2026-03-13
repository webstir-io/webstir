# Getting Started

Install the prerequisites, inspect the active CLI, and run one of the proof apps that demonstrates the current HTML-first runtime.

> Historical note: older repo snapshots used the `.NET` orchestrator. The active path is the Bun orchestrator in `orchestrators/bun`.

## Prerequisites

- Bun 1.3.x
- Node.js 20.18+
- TypeScript on `PATH` if you are working directly on framework packages

## First Run

1. Install dependencies and inspect the CLI

```bash
bun install
bun run webstir -- --help
```

2. Start a proof app

```bash
bun run watch:auth-crud
# or
bun run watch:dashboard
```

3. Open the printed URL and compare:

- `auth-crud` for server-handled sign-in, validation, redirect-after-post, and CRUD flows
- `dashboard` for shell-level and panel-level fragment refreshes on top of normal HTML forms

## Create A Fresh Workspace

```bash
bun run webstir -- init my-app
cd my-app
bun install
bun run webstir -- watch --workspace "$PWD"
```

Edit files under `src/**` and let the watch loop rebuild the frontend and backend surfaces that exist in the workspace.

## Next

- [Your First App](./first-app.md)
- [Watch](../how-to/watch.md)
- [Test](../how-to/test.md)
- [Publish](../how-to/publish.md)
