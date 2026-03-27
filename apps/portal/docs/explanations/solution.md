# Solution

Webstir is an HTML-first full-stack solution. The active system is the Bun orchestrator plus the canonical TypeScript packages under `packages/**`.

Webstir is still experimental. The current Bun-first workflow is the active path in this repo, but its APIs and operational guidance can still change.

> Active path: the Bun orchestrator in `orchestrators/bun`. Historical `.NET` material remains in-tree for reference only.

## What It Optimizes For

- Server-rendered documents as the default experience
- Forms, links, redirects, and document navigation as primary primitives
- Fragment updates as an enhancement layer, not a requirement
- Low-JavaScript delivery for multi-page apps, backoffice tools, and dashboards

## Main Pieces

- CLI orchestration: `orchestrators/bun`
- Frontend delivery: `packages/tooling/webstir-frontend`
- Backend runtime and scaffolding: `packages/tooling/webstir-backend`
- Contracts and manifest primitives: `packages/contracts/*`
- Current Docker deployment path: `orchestrators/bun/resources/deployment/docker`
- Proof apps: `examples/demos/auth-crud` and `examples/demos/dashboard`

## How It Works

1. `init`
   Scaffolds a workspace with frontend, backend, shared, and type roots.
2. `watch`
   Builds the active surfaces, starts the Bun dev server, starts the backend runtime, and proxies `/api/*`.
3. `test`
   Compiles and runs frontend/backend tests through the canonical testing providers.
4. `publish`
   Writes optimized frontend assets to `dist/frontend/**` and backend output to `build/backend/**`.

## Runtime Model

- Backend routes can return full HTML, redirects, or fragment metadata.
- Server-handled forms remain valid without client JavaScript.
- Request-time views can render HTML from the backend runtime and expose `x-webstir-document-cache`.
- Fragment responses remain uncached and carry `x-webstir-fragment-*` metadata for targeted updates.

## Proof Of The Model

- `auth-crud` proves sign-in gates, validation recovery, redirect-after-post, and CRUD mutations.
- `dashboard` proves shell and panel refreshes without shifting into SPA-first architecture.

## Related Docs

- [Workflows](../reference/workflows.md)
- [Watch](../how-to/watch.md)
- [Test](../how-to/test.md)
- [Publish](../how-to/publish.md)
