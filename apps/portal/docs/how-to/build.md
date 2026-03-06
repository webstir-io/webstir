# Build

Compile and stage the app for development. Processes frontend HTML/CSS/TS and compiles the backend into `build/`.

## Purpose
- Produce up-to-date dev outputs without optimization.
- Validate the workspace and surface actionable errors.

## When To Use
- Before running tests locally.
- In CI to check that code compiles.

## CLI
- `webstir build [--clean] [--runtime <frontend|backend|all>]`

## Steps
1. Validate workspace structure and required inputs.
2. Compile TypeScript for frontend/backend using `tsc --build` with the embedded base config.
3. Bundle JavaScript with **esbuild** for fast, development-friendly output with source maps.
4. Process CSS imports and copy assets.
5. Merge page HTML into `src/frontend/app/app.html` and write to `build/frontend/pages/<page>/index.html`.
6. Copy Images, Fonts, and Media to `build/frontend/{images|fonts|media}/**`.
7. Copy app assets to `build/frontend/app/`.

## Outputs
- `build/frontend/**` with readable assets and page HTML (includes `build/frontend/{images|fonts|media}/**`).
- `build/backend/index.js` compiled backend entry.
- `.webstir/backend-manifest.json` — inspect it without starting `watch` via `webstir backend-inspect`.

## Flags
- `--clean`: remove previous `build/**` before building.
- `--runtime` / `-r`: limit work to `frontend`, `backend`, or `all` (default). The CLI auto-detects which folders exist, but forcing a scope speeds up backend-only loops or frontend-only sandboxes.

Examples:
- `webstir build --runtime backend` — skip frontend pipelines when touching APIs or jobs.
- `webstir build --runtime frontend --clean` — refresh only the UI surface after deleting `build/`.

## Errors & Exit Codes
- Non-zero on TypeScript errors, missing base HTML, or pipeline failures.
- Logs identify the failing stage and file when possible.

## Related Docs
- Workflows — [workflows](../reference/workflows.md)
- Engine — [engine](../explanations/engine.md)
- Pipelines — [pipelines](../explanations/pipelines.md)
- Workspace — [workspace](../explanations/workspace.md)
- Servers — [servers](../explanations/servers.md)
- Tests — [tests](../explanations/testing.md)
