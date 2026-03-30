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
- Supported Bun deployment contract: `orchestrators/bun/resources/deployment/docker`
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

## Golden Path

Use this as the default app path today:

1. Start with `webstir init full`.
2. Add document pages under `src/frontend/pages/**` with `webstir add-page`.
3. Keep forms, redirects, auth checks, and request-time HTML in `src/backend/module.ts`.
4. Add manifest-backed backend endpoints with `webstir add-route` when those routes need explicit metadata or inspection output.
5. Define request-time views in `src/backend/module.ts` when a document needs server-loaded data at request time.
6. Enable `client-nav` only after the baseline HTML path is already correct.
7. Use `webstir inspect` to check scaffold drift plus the frontend/backend contract surfaces before shipping or automating fixes.
8. If scaffold wiring drifts, use `webstir repair` to restore the same mode and enabled-feature shape.
9. Publish with `webstir publish`, then deploy `api` or `full` workspaces with the supported Bun Docker contract.

## Runtime Model

- Backend routes can return full HTML, redirects, or fragment metadata.
- Server-handled forms remain valid without client JavaScript.
- Request-time views can render HTML from the backend runtime and expose `x-webstir-document-cache`.
- Fragment responses remain uncached and carry `x-webstir-fragment-*` metadata for targeted updates.

The canonical primitive breakdown for those behaviors lives in [Primitives](../reference/primitives.md).

## Proof Of The Model

- `full` is the canonical scaffold-aligned reference for the default path.
- `auth-crud` proves sign-in gates, validation recovery, redirect-after-post, and CRUD mutations.
- `dashboard` proves shell and panel refreshes without shifting into SPA-first architecture.

## Agent Surface

- `webstir operations --json` lists the stable framework operations that wrappers and MCP adapters should call.
- `webstir inspect --json` is the direct combined inspection contract for workspace-aware wrappers.
- `webstir agent` is intentionally thin: it orchestrates inspect, scaffold, validate, and repair flows by composing those stable operations instead of inventing architecture from scratch.
- The benchmark runner at `bun run benchmark:agent-tasks` stays pinned to the recipe apps so the agent-facing story stays tied to real framework behavior.

## Related Docs

- [Workflows](../reference/workflows.md)
- [Primitives](../reference/primitives.md)
- [Watch](../how-to/watch.md)
- [Test](../how-to/test.md)
- [Publish](../how-to/publish.md)
