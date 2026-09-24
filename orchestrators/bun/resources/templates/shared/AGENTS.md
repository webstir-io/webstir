# Building this Webstir app

Read this app's `package.json` before changing it. `webstir.mode` identifies the
workspace mode; only use the frontend/backend paths that exist in this app.

## Commands and installed guides

Use the installed CLI selected for this project. In these examples, `WEBSTIR` is
the absolute path to that installation's `node_modules/.bin/webstir`. Keep the
same installed version throughout the task. If no path was supplied, check the
app and its parent installation before installing another CLI.

```sh
"$WEBSTIR" --help
"$WEBSTIR" inspect --json --workspace "$PWD"
"$WEBSTIR" watch --workspace "$PWD"
"$WEBSTIR" test --workspace "$PWD"
"$WEBSTIR" publish --workspace "$PWD"
```

Help prints the installed paths to the feature recipes and coding-agent setup.
Read the relevant recipe before implementing a feature. Run `bun install` in a
new workspace before building, watching, or testing. `publish` produces local
release assets; deploying them is a separate action.

## App ownership

- Edit application sources under `src/`, app tests, and app configuration.
- Frontend pages live in `src/frontend/pages/<name>/`; shared shell/assets live
  under `src/frontend/app/`. Backend route definitions and handlers start in
  `src/backend/module.ts`; keep `src/backend/index.ts` as the runtime bootstrap.
- Do not edit installed package internals, `build/`, `dist/`, or `.webstir/`
  output to implement app features. Use the app's existing dependencies and
  conventions; create focused app modules as the feature grows.

## Completing a feature

1. Inspect the workspace and read the nearby app code/tests.
2. Implement the complete path: persistence, server handler, validation/error
   responses, HTML/forms, and app-specific tests as needed.
3. Keep forms, links, and redirects working without JavaScript. Add optional
   enhancement after that baseline works. Keep existing auth/access checks.
4. Run the relevant app tests and verify the rendered user flow in a browser.
   For persistent data, verify it survives a server restart. Passing the starter
   tests or creating route metadata alone does not establish feature completion.

`add-route` and `agent scaffold-route` add route metadata; implement the handler
in the app module too. `add-page` creates page files. `inspect` reports framework
state; `agent validate` combines doctor and tests. None proves new business
behavior without appropriate app tests and browser checks.

## Repair and instruction updates

Use `repair --dry-run --json` to inspect proposed scaffold restoration before
applying it. Repair restores missing scaffold files; application defects need
application code changes. Starter tests belong to the app after generation;
repair does not recreate deleted starter tests. Keep unrelated user changes intact.

This file belongs to the app after generation. Repair restores it only when it
is missing and leaves existing contents unchanged. Its absence does not make the
app unhealthy or block validation. Compare it with the installed
starter instructions reported by `--help` and merge useful updates manually.
`refresh` replaces the workspace with a scaffold; do not use it to update this
file or fix an application defect.
