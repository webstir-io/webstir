# Build

Compile and stage the app for development. Processes frontend HTML/CSS/TS and compiles the backend into `build/`.

## Purpose
- Produce up-to-date dev outputs without optimization.
- Validate the workspace and surface actionable errors.

## When To Use
- Before running tests locally.
- In CI to check that code compiles.

## CLI
- `webstir build --workspace <path>`

## Steps
1. Read the app's layers from its files: pages when `src/frontend/` exists, a server when `src/backend/index.ts` exists.
2. Choose the build plan from the layers:
   - pages build the frontend
   - a server builds the backend
   - an app with both builds both
3. Run the canonical provider packages from `packages/tooling/**`.
4. Write development artifacts under `build/**`.

## Outputs
- `build/frontend/**` with page HTML, CSS, JS, and copied assets when the app has pages
- `build/backend/**` with compiled backend output when the app has a server
- `.webstir/frontend-manifest.json` emitted by the frontend package when the app has pages

To print the current backend manifest summary, use:

```bash
webstir backend-inspect --workspace /absolute/path/to/workspace
```

## Errors & Exit Codes
- Non-zero on TypeScript errors, missing base HTML, or pipeline failures.
- Non-zero when the app has neither pages nor a server.
- Non-zero when a page has bindings but no view names it and it has no `data.ts`; the error names the file and line.
- Logs identify the failing stage and file when possible.

## Related Docs
- Workflows — [workflows](../reference/workflows.md)
- Engine — [engine](../explanations/engine.md)
- Pipelines — [pipelines](../explanations/pipelines.md)
- Workspace — [workspace](../explanations/workspace.md)
- Servers — [servers](../explanations/servers.md)
- Tests — [tests](../explanations/testing.md)
