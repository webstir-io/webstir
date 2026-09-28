# Init

Create a new project from embedded templates. Produces a ready-to-run layout with frontend, backend, shared code, and types.

## Purpose
- Scaffold a clean server-first workspace with sensible defaults.
- Zero-config start: `watch` runs immediately after init.

## When To Use
- Starting a new HTML-first app or demo.
- Recreating a minimal workspace for tests or examples.

## CLI
- `webstir init <starter> <directory>`
- `webstir init <directory>`

## Inputs & Flags
- `<starter>`: `full`, `ssg`, `spa`, or `api`. The starter only chooses the starting template; after init, the app's files decide what it is (see [Workspace](../explanations/workspace.md)).
- `<directory>`: target directory to create or populate.
- If you omit `<starter>`, `init` defaults to `full`.

## Steps
1. Validate or create the target directory.
2. Copy the Bun-owned scaffold assets for the selected starter.
3. Write `package.json` with the matching Webstir dependencies.
4. Write `base.tsconfig.json` and the expected `src/**` layout.
5. Run `bun install` inside the new workspace before `watch`, `build`, `test`, or `publish`.

## Outputs
- `full`: `src/frontend/**`, `src/backend/**`, `src/shared/**`, and `types/**`, with client-nav on (pages + server)
- `spa`: `src/frontend/**`, `src/shared/**`, and `types/**`, with client-nav on (pages)
- `ssg`: `src/frontend/**` and `types/**` (pages)
- `api`: `src/backend/**`, `src/shared/**`, and `types/**` (server)
- `package.json` with the matching Webstir dependencies
- `base.tsconfig.json`

## Errors & Exit Codes
- Non-zero on invalid directory, name normalization failure, or IO errors.
- Logs describe which file or step failed.

## Related Docs
- Workflows — [workflows](../reference/workflows.md)
- CLI — [cli](../reference/cli.md)
- Engine — [engine](../explanations/engine.md)
- Workspace — [workspace](../explanations/workspace.md)
- Pipelines — [pipelines](../explanations/pipelines.md)
- Tests — [tests](../explanations/testing.md)
