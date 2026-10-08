# Templates

Embedded scaffolding used by the CLI to create projects and generate files. Keeps new apps consistent and zero-config.

## Overview
- Repo source of truth lives under `orchestrators/bun/resources/templates/**`.
- Generated package assets live under `orchestrators/bun/assets/templates/**` and are embedded into the Bun CLI package.
- `webstir init` lays down a server-first project from the `full` starter by default.
- Generators add files in the right place with sensible defaults.

## Layout
Created by `webstir init` according to the starter:

- `full`: a home page with one form, and a server with one view and the route the form posts to, with client-nav on
- `spa`: a home page, with client-nav on
- `ssg`: a docs site: home, about and docs pages, Markdown content and its styles
- `api`: a server entry

The starter only chooses the starting files. After init, the app's layers come from those files: pages when `src/frontend/` exists, a server when `src/backend/index.ts` exists.

Typical frontend scaffold:

- `src/frontend/app/app.html`: the shell every page merges into
- `src/frontend/app/app.css`: the app's styles
- `src/frontend/app/app.ts` (optional): the app's own code for every page, such as a theme or a menu
- `src/frontend/pages/<page>/index.html|css` plus `index.ts` for standard pages
- `src/frontend/{content,images,fonts,media}/**`

What the build adds to every page, so the app holds none of it:

- The app bundle (`/app/app.js`): the enabled features (`webstir.enable`), the error reporter in an app with a server, and `app.ts` when there is one. A page loads it whenever there is anything in it.
- The app's styles (`/app/app.css`), linked ahead of the page's own stylesheet: `app.css` plus the stylesheets of enabled features. Pages don't import `app.css`.
- In `webstir watch`, Webstir's live-update and reload clients (`/hmr.js`, `/refresh.js`), which the package serves and publish leaves out.

A shell that already names one of these keeps its own tag.

Typical backend scaffold:

- `src/backend/index.ts`
- `src/backend/module.ts`
- `src/backend/jobs/**`
- `src/backend/tests/**`

## Conventions
- Base HTML requires a `<main>` in `src/frontend/app/app.html` for page merge.
- Page folder names must be one non-empty path segment without separators, `.` / `..`, NUL bytes, or platform-reserved names and characters.
- Each page has `index.html` and `index.css`; standard pages also have `index.ts`, while `add-page --no-script` omits it.
- Backend entry is `src/backend/index.ts`.
- Fresh `api` and `full` starters keep `src/backend/index.ts` thin and use it to boot the package-managed Bun runtime.
- Manifest-backed route and demo logic lives in `src/backend/module.ts`.
- The default app primitives are documented in [Primitives](./primitives.md); treat that page as the naming contract for pages, forms, actions, fragment targets, request-time views, and auth-gated routes.
- For optional app features, prefer absolute app-asset imports such as `await import('/app/search.js')` so dev and publish paths stay aligned.
- Start with `full` when the app needs forms, redirects, auth, or server-rendered documents; start with `spa` or `ssg` for pages without a server, which publish as a static site.

## Bindings
A page's `index.html`, the app shell and partials bind data with attributes. A binding is a path of names joined by dots, such as `client.name`, read from the view's data. The build checks every path against the view's schema and fails with the file and line of one that does not exist. Every value is escaped, and the attributes are not in the rendered page.

| Attribute | Meaning |
| --- | --- |
| `data-text="path"` | Replaces the element's content with the value. What is written there is a placeholder. |
| `data-attr-<name>="path"` | Sets the attribute. `true` adds it bare, and `false`, `null` or nothing removes it. |
| `data-if="path"`, `data-if="!path"` | Keeps the element only when the value is truthy, or falsy with `!`. |
| `data-each="items as item"` | Repeats the element for each entry, with `item` in reach inside it. |
| `data-include="name"` | Replaces the element's content with `src/frontend/app/partials/<name>.html`. |
| `data-with-<name>="path"` | Gives a path a name, in reach of the element's other bindings and inside it. |
| `data-with-<name>="'text'"` | Gives a name to text written in single quotes. |
| `data-props="path"` | Passes the value to the island on the element, as JSON. See [Islands](../how-to/islands.md). |

A partial reads whatever names are in reach where it is included, so `data-with-<name>` is how one partial serves different data:

```html
<!-- src/frontend/app/partials/field.html -->
<label data-text="field.label">Label</label>
<input data-attr-name="field.name" data-attr-value="field.value" />
<p data-if="field.error" data-text="field.error"></p>
```

```html
<div data-include="field" data-with-field="form.email"></div>
<div data-include="field" data-with-field="form.phone"></div>
```

Text in single quotes is for what the template itself knows, such as a button's label. The build writes it into the page, so it costs nothing at request time:

```html
<a class="button" data-include="button" data-with-label="'Edit'" data-attr-href="client.editUrl"></a>
```

- **Names are lowercase.** HTML lowercases attribute names, so `data-with-clientRow` gives the name `clientrow`. Use lowercase letters, digits and underscores.
- **The nearest name wins.** A name given inside a loop hides the loop's item of the same name, and a loop inside hides a name given outside it.
- **Names on one element do not read each other.** Each is given from what is in reach outside the element, and from its own loop's item when it has a `data-each`.
- **A loop is read first.** `data-each` cannot read a name its own element gives, and the build says so. Give the name on an element outside.
- **Text is not data.** A name given text works in `data-text`, `data-attr-*` and `data-if`, where empty text is falsy. It cannot be looped over or passed to an island.
- **Errors name what was read.** A path through a given name is checked like any other, and the message shows the real path, such as `form.phone`, at the partial's line.
- **A name given and never used is not checked.** A misspelled path shows up where the name is used, or not at all if it never is.
- **Names stay in their file's template.** A page that renders in the browser cannot read a name the app shell gives.

## TypeScript
- `src/frontend/tsconfig.json` and `src/backend/tsconfig.json` are one line each, extending `@webstir-io/webstir-frontend/tsconfig.json` and `@webstir-io/webstir-backend/tsconfig.json`, which hold the compiler settings. Stylesheet imports (CSS modules) are typed by the frontend package's declarations. Add your own options beside the `extends`.
- A backend with no `tsconfig.json` is type-checked with the package's settings.
- ESM-only; compiled via the active provider packages.
- Dev output keeps source maps for local debugging; publish strips them.
- Dynamic imports load at runtime. Keep `/app/...` imports absolute for assets under `src/frontend/app/`.

## CSS & Assets
- Plain CSS by default; optional CSS Modules in publish.
- `@import` and asset URLs are resolved; files copied to outputs.
- Place static app assets under `src/frontend/app/*`.
- Place Images, Fonts, and Media under `src/frontend/{images|fonts|media}/**`.

## Inline Scripts
- A script tag marked `data-webstir-inline` names a TypeScript or JavaScript source that the build bundles and writes into the tag itself, so it runs before anything paints. Use it for the small things that must be right on the first frame, such as a theme or a computed backdrop:
  - `<script data-webstir-inline src="./scripts/first-paint.ts"></script>` in `src/frontend/app/app.html` runs on every page; the same tag in a page's `index.html` runs on that page.
  - A relative `src` resolves against the file that contains the tag; a leading `/` resolves against `src/frontend`, the way `/app/app.js` does.
- The bundle is an immediately-invoked script with its imports included, readable in development and minified on publish. `webstir watch` rebuilds the page HTML when the source or anything it imports under `src/frontend/app` or the page changes.
- The build keeps the source path in the attribute (`data-webstir-inline="src/frontend/app/scripts/first-paint.ts"`) and drops `src`; client-side navigation leaves inline head scripts in place, so they run on full loads only.
- A missing source fails the build. A published (minified) bundle over 16 KB gets a `frontend.inlineScript.large` warning, because it travels with every page that includes it; the readable build output is not measured.

## Client Error Reporting
- Every app with a server reports its pages' browser errors: the app bundle every page loads includes Webstir's reporter, which listens for `window` `error` and `unhandledrejection` and reports to `POST /client-errors` using `sendBeacon` (fallback to `fetch`). Nothing of it lives in the app.
- An app without a server has nowhere to report to, so it is off there.
- Behavior:
  - Throttled: max 1 event/second; capped at 20 per page session.
  - Deduped: repeats suppressed within 60s using a fingerprint of type|message|file:line:col|stack-hash.
  - Correlation: includes a client correlation id; the server also accepts `X-Correlation-ID`.
- Where reports go: `webstir watch` prints each report in the terminal next to the build output; the Bun backend runtime logs it at error level, so apps with a server have a sink in production.
- Turn it off with `"webstir": { "enable": { "clientErrors": false } }` in `package.json`, or on in an app without a server that reports elsewhere with `true`.

## Generators

### add-page
- Command: `webstir add-page <name> --workspace <path> [--no-script]`
- Calls the canonical `@webstir-io/webstir-frontend` helper to scaffold `index.html|css` plus `index.ts`; `--no-script` leaves out `index.ts`.
- Does not modify existing pages or `app.html`.
- Name validation: rejects control characters, trims surrounding spacing, preserves case and internal spaces, and requires one portable non-empty path segment (not `.` or `..`, a platform-reserved name, or a name containing reserved characters).

### add-test
- Command: `webstir add-test <name-or-path> --workspace <path>`
- Uses the canonical `@webstir-io/webstir-testing` helper to create `<name>.test.ts` under the nearest `tests/` directory; older published installs fall back to `webstir-testing-add`.
- Validates every path segment for portable filenames before creating directories or files.
- Works for both frontend and backend tests.

## Backend Template
- `src/backend/index.ts` starts the server with the package's defaults: `createDefaultBunBackendBootstrap({ importMetaUrl: import.meta.url })`. Pass options there to change them, such as a session store or `resolveRequestAuth`.
- `src/backend/module.ts` holds the app's routes and views (the full starter's demo module; the api starter adds one when it needs it).
- `.env.example` lists the server's settings; `.gitignore` keeps `data/`, `.webstir/` and `.env` out of git. See [Environment](./env.md).
- Health endpoints: `GET /api/health` and `/healthz`; a readiness probe at `/readyz` that returns the manifest summary; request counts and timings at `/metrics`.
- The batteries come with the package, not the template:
  - a database with migrations from `src/backend/migrations` ([Use the Database](../how-to/database.md))
  - sessions kept in it ([Keep Sessions](../how-to/sessions.md))
  - jobs on a schedule or queued ([Run Jobs](../how-to/add-job.md))
  - email ([Send Email](../how-to/email.md)) and file storage ([Store Files](../how-to/files.md))
  - email-code sign-in, with `webstir enable sign-in` ([Add Sign-In](../how-to/sign-in.md))
- Bearer-token auth for an API with its own identity provider: `resolveRequestAuth: (request) => resolveBearerAuth(request)`, from `@webstir-io/webstir-backend/auth/bearer`, reading the `AUTH_*` settings. Unsupported algorithms, malformed tokens, bad signatures, wrong issuer or audience, and invalid time claims fail closed.

## Publish Outputs
- Per page: `dist/frontend/pages/<page>/index.html` in an app with a server; `dist/frontend/<page>/index.html` (and `dist/frontend/index.html` for `home`) in an app without one
- Fingerprinted assets: `dist/frontend/pages/<page>/index.<timestamp>.{css|js}`
- Per-page `manifest.json` listing hashed asset names.
- App assets copied to `dist/frontend/app/*`.

## Customizing Templates
- Edit templates under `orchestrators/bun/resources/templates/`.
- Regenerate the shipped package assets with `bun run --filter @webstir-io/webstir build` or `cd orchestrators/bun && bun scripts/sync-assets.mjs`.
- Use `bun run --filter @webstir-io/webstir check:assets` to verify the generated tree is still in sync.
- Keep conventions intact (page structure, base HTML `<main>`, server entry path).
- After changes, rebuild the CLI to embed updated templates.

## Related Docs
- Solution overview — [solution](../explanations/solution.md)
- Primitives — [primitives](./primitives.md)
- CLI reference — [cli](cli.md)
- Engine internals — [engine](../explanations/engine.md)
- Pipelines — [pipelines](../explanations/pipelines.md)
- Workspace and paths — [workspace](../explanations/workspace.md)

The full demo (`examples/demos/full`) adds `/lifecycle`, demonstrating the optional page `setup`
export and cleanup scopes, and the progressive-enhancement form flow. Client-nav itself ships in `@webstir-io/webstir-frontend`
(`packages/tooling/webstir-frontend/src/features/`); apps import it, so there are no
copies to refresh.
