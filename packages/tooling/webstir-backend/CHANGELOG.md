# @webstir-io/webstir-backend

## 0.7.0

### Minor Changes

- ce4b3a2: Batteries: a server app gets a database, migrations, durable sessions, jobs, email, file storage and email-code sign-in, with no setup.
  
  - `ctx.db` is the app's database (SQLite by default, Postgres by `DATABASE_URL`), opened on first use; migrations in `src/backend/migrations/` apply when the server starts (`webstir add-migration`, `webstir migrate`).
  - Sessions are kept in the database and survive restarts.
  - Jobs run in the server: on a schedule, or queued with `ctx.jobs.enqueue()` and retried (`webstir jobs`).
  - `ctx.email` sends over SMTP (`EMAIL_URL`), or prints to `.webstir/email.log` in development; `ctx.files` stores files on disk or in S3.
  - `webstir enable sign-in` adds email-code sign-in: `ctx.user` and `auth: 'required'` on routes and views.
  - The server loads `.env` files and checks what production needs before it listens; starters write `.env.example` and a `.gitignore`.
  
  Breaking changes:
  
  - `ctx.db` was an empty per-request object; it is now the database. Use `ctx.locals` for per-request values.
  - `prepareSessionState()` and its `commit()` return promises. A custom session store's methods may now return promises; synchronous ones still work.
  - The backend scaffold no longer ships `env.ts`, `auth/adapter.ts`, `session/*`, `db/*`, `observability/*` or the job scheduler: the package provides them. Bearer-token auth is `resolveBearerAuth` from `@webstir-io/webstir-backend/auth/bearer`.

### Patch Changes

- Updated dependencies [ce4b3a2]
  - @webstir-io/module-contract@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [6bb7c0c]
  - @webstir-io/module-contract@0.6.0

## 0.5.0

### Minor Changes

- 6e3ebf5: An app is what its files say it is: pages when it has `src/frontend/`, a server when it has `src/backend/index.ts`. `webstir.mode` is gone, and so is choosing a shape once at `init`.
  
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

### Patch Changes

- Updated dependencies [6e3ebf5]
  - @webstir-io/module-contract@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [ff5d7f4]
  - @webstir-io/module-contract@0.4.0

## 0.3.1

### Patch Changes

- 4fe87a6: A resent or double-clicked form post whose first copy signed in (or otherwise changed the session) now gets the new session cookie along with the first answer, instead of a redirect that leaves the browser signed out.
- @webstir-io/module-contract@0.3.1
