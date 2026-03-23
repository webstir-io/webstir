# Package Template Snippet

Use this snippet as a starting point when adding a new publishable package under `packages/contracts/` or `packages/tooling/`.

1. Copy the contents of this directory into `packages/<family>/<package-name>/`.
2. Replace `@webstir-io/package-template` with the real package name and update the description.
3. Align the scripts with the Bun-first repo conventions used by the surrounding package.
4. Update any placeholder metadata before committing.

Keep the scaffold minimal—additional build tooling should live inside the package itself so the CLI can invoke it without special handling.
