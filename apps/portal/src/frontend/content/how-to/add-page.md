# Add Page

Scaffold a new frontend page with `index.html|css` and, unless you pass `--no-script`, `index.ts` under `src/frontend/pages/<name>/`.

## Purpose
- Create a new routed page quickly with the expected files.
- Ensure the page follows conventions used by build and publish.

## When To Use
- Adding a new top-level page in the app.

## CLI
- `webstir add-page <name> --workspace <path> [--no-script]`

## Notes
- Frontend only: this command scaffolds files under `src/frontend/pages/` and does not touch backend or shared code.
- In an app with a server, document pages live here while form handlers, redirects, and auth stay in `src/backend/module.ts`.
- Internals: the CLI calls the canonical `@webstir-io/webstir-frontend` scaffold helper so generated files stay in sync with the framework templates.
- `--no-script` scaffolds a JS-free page (no `index.ts` and no module script tag); add `index.ts` later with `webstir enable scripts <page>` if the page needs JavaScript.
- Standard page source lives in `index.ts`, but the HTML module script must reference `index.js`. Build and publish resolve that browser-safe name to the compiled or fingerprinted bundle; do not point HTML directly at `index.ts`.

## Inputs
- `<name>`: one portable page-directory name, without path separators. Empty names, `.`/`..`, control characters, and platform-reserved names or characters are rejected. If the page already exists, the workflow fails.
- `--no-script`: scaffold the page without `index.ts`.

## Steps
1. Validate `<name>` and resolve `src/frontend/pages/<name>/`.
2. Call the `@webstir-io/webstir-frontend` helper to create page files from the canonical scaffold.
3. Pick the standard page shape, or the JS-free shape with `--no-script`.

## Outputs
- New page folder and files under `src/frontend/pages/<name>/`.
- Standard pages contain `index.ts` and `<script type="module" src="index.js">`.
- Picked up automatically by `build`, `watch`, and `publish`.

## Errors & Exit Codes
- Non-zero if the page exists, the name is invalid, or file IO fails.

## Related Docs
- Workflows — [workflows](../reference/workflows.md)
- Build — [build](build.md)
- Watch — [watch](watch.md)
- Publish — [publish](publish.md)
- Workspace — [workspace](../explanations/workspace.md)
