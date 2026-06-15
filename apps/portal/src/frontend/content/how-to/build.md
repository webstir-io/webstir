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
1. Read the workspace mode from `package.json`.
2. Choose the active build plan for that mode:
   - `spa` and `ssg` build the frontend only
   - `api` builds the backend only
   - `full` builds both
3. Run the canonical provider packages from `packages/tooling/**`.
4. Write development artifacts under `build/**`.

## Outputs
- `build/frontend/**` with page HTML, CSS, JS, and copied assets when the workspace has a frontend surface
- `build/backend/**` with compiled backend output when the workspace has a backend surface
- `.webstir/frontend-manifest.json` emitted by the frontend package when the frontend surface is active

To print the current backend manifest summary, use:

```bash
webstir backend-inspect --workspace /absolute/path/to/workspace
```

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
