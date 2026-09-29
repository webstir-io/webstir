# Plan: what the portal still carries

The next step of `plans/plan.md`'s path: the portal shows where the framework is missing something. Every portal page already renders on the server through Webstir views, and no page script fetches data. What the portal still carries is a framework of its own around those views, and a JSON API left from its first, client-rendered design. This plan moves the generic part into Webstir and deletes the rest.

## What the audit found

Portal paths are relative to the portal repo; line counts are approximate.

- **A JSON API nothing uses.** 21 `/api/*` routes (`proposals/routes.ts`, `comments/routes.ts`, `http.ts`, ~380 lines). The pages call the services; the `portal:proposal` command calls them too. Only two routes have users: the PDF download and the feedback digest, which the README documents for the agent token. Twelve duplicate a form action, and one of those copies the publish notification code. `agent-token` hands the raw token over HTTP, which the README says the UI never does.
- **Its own page context and form plumbing** (`pages/shell.ts`, `pages/actions.ts`, ~290 lines):
  - `PageContext`, `flashSchema`, and a `FormState`-to-template helper, because the contract's view context has no `user`, `db`, `files` or `email`, and no flash or form-state schema.
  - A `formAction` wrapper around every form (~100 lines), because the runtime never enforces a route's declared `form.csrf`. Every handler has to call `processFormSubmission` itself, choose where to re-render, and turn "not found" and field errors into responses.
- **Its own access control.** `requireSignedIn` and `requireStaffPage`, called ~20 times, because a view's `auth: 'required'` means "has a session", while the portal's rule is "is a portal user" and, for some pages, "is staff". Webstir has no way for an app to say who a signed-in person is, or what a page requires beyond a session.
- **Its own duplicate-submission guard** (`pages/submissions.ts`, a `form_submissions` table). It works without script, lasts across restarts, and replays the flash. Webstir's guard only sees ids that client-nav adds, lives in the session, and replays only the redirect.
- **Its own file store** (`aws/private-object-client.ts` and `proposals/storage.ts`, ~490 lines). Webstir's `files` battery lacks what the portal needs: AWS profile credentials, write-once puts, checksums and metadata, size-bounded reads, timeouts and retries. The manifest declares `files`, but the code never uses it.
- **Its own database backup** (`database-backup.ts`, ~190 lines, and 13 hand-placed snapshot calls after writes). Webstir has none.
- **Shell data passed through every loader.** Each loader returns `nav` and the reader account (~19 call sites), and every page includes the sidebar, because `app.html` binds no data of its own.
- **Generic behaviors** (`app/behaviors.ts`, 162 lines): submit on change, dismissable `<details>`, the mobile drawer (Webstir has one but doesn't export it), slug filling, and chosen file names.
- **Small leftovers:**
  - `origin.ts` duplicates `appUrl()`, and `database.ts` is a re-export.
  - `safeReturn` duplicates the exported `safeReturnTo`.
  - Legacy links are written as full views just to redirect.
  - Two README lines are stale.

Domain code stays as it is: proposals, comments, PDFs, clients, activity, the identity SQL, the branded sign-in email, the SES transport (it uses Webstir's documented `setEmailTransport`), tooltips, the reader, drafts and theme.

## What changes in Webstir

1. **View and action contexts match the runtime.** The backend exports `ViewContext` and `ActionContext`, typed with the app's user, since they carry its database, files, email and jobs. The contract exports `flashSchema`, and a `formStateSchema` with a `formView()` helper for binding a form's values and errors. A loader's return type leaves out `flash`, which the framework adds.
2. **Form routes are enforced by the runtime.** For a route that declares `form`, the runtime:
   - checks the CSRF token itself (any token the session issued) and parses the values before the handler runs; the handler receives `ctx.form` (`values`, `id`)
   - re-renders a failed submission at the page it came from; with no page of the app's to go back to, it answers 403 as `processFormSubmission` does
   - turns a thrown `notFound()`, or a `fieldIssue(field, message)`, into a 404 or a re-render

   A form declaration can name its id (`form: { id }`), which the page's loader reads its state by; it is the route's name by default. `processFormSubmission` stays, and a handler that still calls it for a declared route passes its own check too, since the runtime uses nothing up.
3. **Apps say who is signed in and what a page needs.**
   - Sign-in gains `loadUser(ctx)`: the app turns the session's email into its own user, or null for "no access". `ctx.user` is then the app's user everywhere.
   - Views and routes gain `auth: { role: '<name>' }` next to `'required'`, checked against `user.roles`.
   - A signed-out visitor goes to sign-in and back, as now. A signed-in visitor without the role gets a 404 page, not a hint that the page exists. (The portal sends a non-staff visitor home today; it will show the 404 page.)
4. **Duplicate submissions are caught without script.** The render layer writes a submission id into every POST form it renders, and client-nav sends that id rather than one of its own. The runtime already remembers each accepted id with its redirect, in the session, which lives in the app database, and a repeat gets the same redirect. The first response's flash needs no replay: when that response is lost, its messages are still waiting in the session for the page the redirect leads to.
5. **The `files` battery covers private documents.** Its S3 store moves from Bun's S3 client, which lacks all of the below, to the AWS SDK. It adds:
   - AWS profile credentials, as the SDK resolves them
   - write-once puts that fail on an existing key
   - checksums and custom metadata
   - reads bounded by size
   - timeouts, with retries for idempotent calls

   `setFileStore` stays for anything else.
6. **Database snapshots.** `SNAPSHOT_URL` (a folder, or `s3://bucket/prefix`, apart from the files so backups can live in their own bucket) receives a copy of a SQLite database (`VACUUM INTO`), written once with a checksum:
   - after the app writes, coalesced: at most one runs, with one more after it for writes made meanwhile, and a pending one is taken before the database closes, so a command's writes are copied
   - keeping the newest `SNAPSHOT_KEEP` copies, or every copy for the bucket's lifecycle rules

   `webstir snapshot` takes one by hand. Postgres apps are told to use their host's backups.
7. **The shell has its own data.** An app can export a `shell` (a `data` schema and a `load`) from `module.ts`. Every page a view renders binds it as `shell`, in the page, its partials and `app.html`, and the build checks those bindings against its schema. Pages stop passing navigation and account data through. A page no view renders has no data, so it can't bind `shell` either.
8. **Declarative behaviors.** `data-submit-on-change`, `data-dismissable` on `<details>`, and a menu toggle (`data-menu-trigger`), packaged like client-nav and bundled when a page, the shell or a partial uses them. Each works as a plain HTML page without them.

Tests for each, docs for each (the render and forms how-tos, sign-in, files, a new snapshots page, the shell), and repair notes where an app's old code would now run twice.

## What changes in the portal

Once Webstir ships, in one portal PR:

- **Delete the JSON API.** 19 routes, `http.ts`, their fixtures and tests. The PDF and the digest move to page paths under the proposal. Browser tests that posted to the API post the forms instead.
- **Switch to the Webstir versions:**
  - the contexts, `formView`, and runtime form checks, which removes most of `shell.ts` and `actions.ts`
  - `loadUser` and roles, which removes `requireSignedIn`, `requireStaffPage` and the `currentIdentity` calls
  - the submission guard, which removes `submissions.ts`
  - `ctx.files`, which removes the private object client and the storage switch
  - snapshots, which removes `database-backup.ts` and its calls
  - the shell loader, which removes `nav` from every loader
  - the behaviors, which removes most of `behaviors.ts`
- **Small switches and deletes:** `appUrl`, the `db` import, `safeReturnTo`, legacy links as plain redirects, and the stale README lines.

## What stays

- The render layer, templates, views, sign-in email flow, sessions and every page's address.
- The portal's domain code, its migrations, its SES transport and its deploy.
- The Drizzle adoption code and the `form_submissions` table, until the held table-drop migration. Both go with that migration, when you say.

## Delivery

- **Webstir:** one branch, one review, released once as **0.9.0**. Items 2 and 4 change behavior, so it's a minor version. The work goes in the order above, each item verified with its package's tests as it lands.
- **Portal:** one branch, one PR once 0.9.0 is on npm, with its full gate including the browser suite.

**What can't be taken back:**
- One Webstir release, 0.9.0.
- The portal PR deploys automatically. Two of its switches touch production data: file storage (new reads and writes of the existing proposal files, same bucket and keys) and backups (same bucket, the snapshot battery's key layout). Before merging, I'll show you the key layout and a snapshot taken against a copy of production. Nothing is migrated or deleted.
- The unused `form_submissions` table and the Drizzle tables stay until the held migration.

## Decisions (defaults chosen; say if you want otherwise)

- **A page someone may not see is a 404,** for both signed-out-after-sign-in and missing-role visitors, as the portal does now, so a URL doesn't reveal what exists.
- **Duplicate-submission records stay in the session,** which lives in the app database, as they do now.
- **Snapshots are SQLite-only,** and go to their own `SNAPSHOT_URL`. A Postgres app uses its host's backups.
- **Drafts and theme stay in the portal.** They are app UI choices, not framework behavior.
- **One Webstir release, then one portal PR,** as for 0.8.0.

## Decided while building

- **Storage gets its own profile:** `S3_PROFILE`, falling back to `AWS_PROFILE`, because the portal's email uses one AWS profile and its documents another.
- **GET routes outside `/api` reach the server** in an app with pages, as views do, so downloads keep page-shaped addresses. The `enable frontend` note names them among what the server still answers.
- **Apps can test their actions:** `readFormIssue` is exported beside `isWebstirControl`.
- **The portal changes no host settings:** `setup.ts` carries `PORTAL_PROPOSAL_BUCKET`, `PORTAL_PROPOSAL_AWS_PROFILE` and `PORTAL_DATABASE_SNAPSHOT_BUCKET` over to `STORAGE_URL`, `S3_PROFILE` and `SNAPSHOT_URL` (`s3://<backups>/database-snapshots/v1`), as it already does for `APP_URL`. Keys stay as they are: `proposals/v1/<proposal>/<version>/document.json` and `database-snapshots/v1/<time>-<uuid>.sqlite`. New versions are recorded as `files:<key>`, and existing `s3:<key>` rows read the same key; the held migration can rewrite them.
- **The record page still sends a client to the reader:** the proposal is theirs, so a 404 would be wrong there. Client pages are staff-only and 404.
- **A comment form's token failure** is kept under the route's form id rather than the reply's, so it shows no message. A real user can't reach it: any token the session issued passes, and without a session, sign-in comes first.
