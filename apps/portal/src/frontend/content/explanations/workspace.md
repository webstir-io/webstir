# Workspace

Defines the directory contract the Bun orchestrator and provider packages expect.

There is no active `AppWorkspace` class in the Bun runtime. Instead, the orchestrator reads the workspace root, its layers, and package metadata directly, and the frontend package emits a generated `.webstir/frontend-manifest.json` snapshot with resolved paths.

## Core Roots

- `src/frontend`
- `src/backend`
- `src/shared`
- `types`
- `build/frontend`
- `build/backend`
- `dist/frontend`
- `.webstir`

## Layers

An app's files say what it is made of:

- **pages**: `src/frontend/` exists.
- **server**: a backend entry exists, `src/backend/index.{ts,tsx,js,mjs}`. A server app deploys a Bun server for routes, request-time views, sessions, and jobs.

An app with pages and no server is a static app. It publishes as files any static host serves, and its views render at publish; a `src/backend/module.ts` without a server entry supplies their loaders at build time. An app with neither pages nor a server fails with "there is nothing to build".

Build, watch, publish, and test all follow the layers. `package.json` does not record them.

## Starters

`webstir init` and `webstir refresh` take a starter that chooses the starting template:

- `full` (default): frontend, backend, shared, and types, with client-nav on
- `spa`: frontend, shared, and types, with client-nav on
- `ssg`: frontend and types
- `api`: backend, shared, and types

Once the files exist, nothing records which starter made them; the layers come from the files.

## Frontend Conventions

- Base HTML lives at `src/frontend/app/app.html` and must contain a `<main>`.
- Pages live under `src/frontend/pages/<page>/`.
- Frontend build output goes to `build/frontend/**`.
- Frontend publish output goes to `dist/frontend/**`.

## Backend Conventions

- Backend entry is `src/backend/index.ts`.
- Fresh `api` and `full` scaffolds keep `src/backend/index.ts` as a thin Bun bootstrap entry.
- Manifest-backed routes and scaffold demo logic live in `src/backend/module.ts`.
- Backend build and publish output lives under `build/backend/**`.

## Watch Rules

- Watch `src/**` and `types/**`.
- Ignore `.git`, `.webstir`, `build`, `dist`, and `node_modules`.
- Root changes to `package.json`, `base.tsconfig.json`, or `types.global.d.ts` trigger a frontend reload.

## Generated Workspace State

- `.webstir/frontend-manifest.json` captures resolved frontend paths and feature flags.
- Backend manifest output is printed by `webstir backend-inspect`; it is not the primary workspace contract.

## Why This Matters

The workspace layout is a public contract. Build, watch, publish, and test all depend on these folders being where the CLI expects them.

## Related Docs

- Solution overview — [solution](solution.md)
- Engine internals — [engine](engine.md)
- Frontend manifest — [frontend manifest](../reference/frontend-manifest.md)
- Templates — [templates](../reference/templates.md)
