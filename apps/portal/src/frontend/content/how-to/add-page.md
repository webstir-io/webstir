# Add Page

Scaffold a new frontend page with `index.html|css` and, for standard pages, `index.ts` under `src/frontend/pages/<name>/`.

## Purpose
- Create a new routed page quickly with the expected files.
- Ensure the page follows conventions used by build and publish.

## When To Use
- Adding a new top-level page in the app.

## CLI
- `webstir add-page <name> --workspace <path>`

## Notes
- Frontend only: this command scaffolds files under `src/frontend/pages/` and does not touch backend or shared code.
- In the default `full` workflow, document pages live here while form handlers, redirects, and auth stay in `src/backend/module.ts`.
- Internals: the CLI calls the canonical `@webstir-io/webstir-frontend` scaffold helper so generated files stay in sync with the framework templates.
- SSG default: when `webstir.mode` is `ssg`, scaffolds a JS-free page by default (no `index.ts` and no module script tag); add `index.ts` later if you want JS sprinkles.

## Inputs
- `<name>`: one portable page-directory name, without path separators. Empty names, `.`/`..`, control characters, and platform-reserved names or characters are rejected. If the page already exists, the workflow fails.

## Steps
1. Validate `<name>` and resolve `src/frontend/pages/<name>/`.
2. Call the `@webstir-io/webstir-frontend` helper to create page files from the canonical scaffold.
3. Pick the standard or SSG page shape based on the workspace mode.

## Outputs
- New page folder and files under `src/frontend/pages/<name>/`.
- Picked up automatically by `build`, `watch`, and `publish`.

## Errors & Exit Codes
- Non-zero if the page exists, the name is invalid, or file IO fails.

## Related Docs
- Workflows — [workflows](../reference/workflows.md)
- Build — [build](build.md)
- Watch — [watch](watch.md)
- Publish — [publish](publish.md)
- Workspace — [workspace](../explanations/workspace.md)
