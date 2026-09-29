---
"@webstir-io/module-contract": minor
"@webstir-io/webstir-backend": minor
"@webstir-io/webstir-frontend": minor
"@webstir-io/webstir": minor
---

What the Sqware portal built for itself is now Webstir's:
- **Typing and forms:**
  - `ViewContext` and `ActionContext` type loaders and handlers.
  - `flashSchema`, `formStateSchema` and `formView` bind a page's messages and forms.
  - A loader returns its data without `flash`.
- **The runtime handles declared forms** (`form: { id?, csrf }`):
  - It checks the CSRF token itself and hands the handler `ctx.form`.
  - It sends a failed form back to the page it came from.
  - A handler can end with `fieldIssue(field, message, { form?, values? })`; `isWebstirControl` and `readFormIssue` let an app's own error handling and tests see it.
- **Submission ids:** every POST form a view renders carries one, so a resent post is answered once, with or without script.
- **Sign-in and roles:** sign-in's `loadUser` makes `ctx.user` the app's own user (or no access), and `auth: { role }` limits a route or view to users with that role.
- **Shell data:** a module's `shell` loader gives every page a view renders data as `shell`.
- **Behaviors:** `data-submit-on-change`, `data-dismissable` and `data-menu-trigger` get their behavior from the app bundle when a page uses them.
- **Files:** stored through the AWS SDK on S3, with `ifAbsent`, `metadata` and `maxBytes`, SDK credentials (profiles and roles included, and `S3_PROFILE` for storage's own), checksums, timeouts and retries.
- **GET routes outside `/api`**, such as downloads, reach the server in an app with pages.
- **Snapshots:** `SNAPSHOT_URL` keeps copies of a SQLite database after writes; `webstir snapshot` takes one now.

Breaking: a route that declares `form: { csrf: true }` now rejects a post without a token its session issued, before the handler runs.
