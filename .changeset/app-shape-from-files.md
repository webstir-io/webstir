---
"@webstir-io/webstir": minor
"@webstir-io/webstir-frontend": minor
"@webstir-io/webstir-backend": minor
"@webstir-io/module-contract": minor
---

An app is what its files say it is: pages when it has `src/frontend/`, a server when it has `src/backend/index.ts`. `webstir.mode` is gone, and so is choosing a shape once at `init`.

- **Build, watch, test, publish, inspect, doctor and repair** follow the app's files. A published deploy reads what `publish` wrote.
- **Apps without a server** (what `spa` and `ssg` were) publish as static sites for any static host. Their pages render at publish (a view) or in the browser (a `data.ts`).
- **Page routes on static hosts:** a view that routes an address pattern to a page (`/items/:id`) works on a static host. Publish writes the page at fixed addresses, a `_redirects` rewrite for Netlify and Cloudflare Pages, and a `404.html` that loads the routed page for GitHub Pages, S3 and the rest.
- **One bindings check for every app:** a page with bindings needs something to render it. In watch, a rejected edit keeps the last valid page.
- **Growing an app:** `webstir enable backend` adds a server to any app, and the new `webstir enable frontend` adds pages to a server-only app.
- **`init` and `refresh` take a starter** (`full`, `spa`, `ssg`, `api`), which only picks the starting template.
- **`repair`** removes `webstir.mode` and `webstir.enable.backend` from existing apps.
- **Removed:**
  - `publish --frontend-mode`
  - the frontend package's `checkSpaTemplates` and `assertNoSpaBindings`
  - `publishMode`

  The frontend package CLI still accepts, and ignores, `publish -m`, so deploy scripts written by earlier versions keep working.
- **`add-page`** makes a page with a script in every app; `--no-script` makes one without.
- **Output and JSON** report `layers: { pages, server }` instead of `mode`.
- **Fixed:** a dependency install that runs quietly (as `webstir agent` runs it) no longer stalls when the install prints more than a pipe holds.
