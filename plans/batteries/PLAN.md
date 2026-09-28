# Plan: batteries

Step 5 of making Webstir the framework you can pick for any web app. A server app gets what almost every real app needs without assembling it: a database with migrations, sessions that survive a restart, jobs that run on a schedule or later with retries, email, file storage, and email-code sign-in. The Sqware Logics portal built each of these by hand; they move into Webstir, and the portal uses them from there.

## What's there today

- **Templates nobody gets.** The backend package holds a database client (`Bun.SQL`, SQLite and Postgres), a migration runner, a job scheduler, a SQLite session store, a bearer-token auth adapter and an env loader, under `packages/tooling/webstir-backend/templates/backend/`. No command writes them into an app. Only their own tests use them, and three docs pages describe files a new app doesn't have.
- **`ctx.db` is an empty object** for per-request scratch data, not a database.
- **Sessions are in memory** unless the app writes its own store. The store interface is synchronous, so it can't sit on `Bun.SQL` or Postgres.
- **Jobs don't run.** `add-job` writes a job and its schedule into `package.json`, but neither `watch` nor the published server runs the scheduler.
- **No email, no storage, no sign-in.** The auth adapter checks API bearer tokens. The `auth-crud` and `dashboard` demos fake sign-in with an in-memory map and unsigned cookies.
- **The portal hand-rolls all of it:** Drizzle migrations applied on connect, a copy of the SQLite session store, an outbox drained by `setInterval` for notification emails, SES email, S3 or local storage, and an email-code sign-in (6-digit code plus magic link, hashed, expiring, rate-limited, revocable).

## What changes

1. **The database is part of the server.**
   - `ctx.db` is the app's database: `query`, `get`, `execute` and `transaction`, with `?` placeholders on SQLite and Postgres.
   - `DATABASE_URL` picks it. The default is `file:./data/app.sqlite`, which is also fine in production on a persistent disk.
   - SQLite opens with WAL, foreign keys and a busy timeout.
   - It opens on first use. An app whose code never touches the database, and that stores no sessions, jobs or users, never creates one.
   - Outside a request, `import { db } from '@webstir-io/webstir-backend/db'` gives the same connection to jobs and scripts.
2. **Migrations apply when the server starts.**
   - They live in `src/backend/migrations/`: `0001-create-notes.sql`, or a `.ts` file exporting `up(db)` when a migration needs code.
   - They apply in order, each in a transaction, and are recorded in the database, in `watch`, `test` and the published server.
   - A failed migration stops the server with the file and the database's error.
   - `webstir add-migration <name>` writes the next file; `webstir migrate --status` lists what's applied.
   - Migrations only go forward.
3. **Sessions are durable.**
   - Sessions live in the app's database, in a table Webstir's own migration creates. They survive restarts and deploys.
   - The session store interface becomes async, so any database can back it. The in-memory store stays for tests.
   - The cookie comes from the env: `SESSION_SECRET` (required in production), plus name, lifetime and `Secure`.
4. **Jobs run.**
   - **Scheduled jobs** (`add-job <name> --schedule "0 3 * * *"`) run inside the server, in `watch` and in production. An overlapping run is skipped.
   - **Queued jobs:** `jobs.enqueue('send-invoice', { id })` stores the job in the database. A worker in the server runs it, retries it with backoff on failure, and gives up after a set number of tries, keeping the error. This replaces the portal's outbox.
   - `webstir jobs` lists scheduled jobs, the queue and failed jobs, and can run one now.
5. **Email.**
   - `email.send({ to, subject, html, text })` from a handler or a job.
   - `EMAIL_URL` picks the transport: `smtp://user:pass@host:587` covers SES, Postmark, Resend, Mailgun and any mail server.
   - In development, with no `EMAIL_URL`, email is printed to the terminal and written to `.webstir/email.log`, so sign-in codes are one glance away.
   - An app can pass its own transport function for an API-only provider.
   - A production server with sign-in enabled and no `EMAIL_URL` refuses to start.
6. **File storage.**
   - `files.put(key, data)`, `files.get(key)`, `files.url(key)` and `files.delete(key)`.
   - `STORAGE_URL` picks where files go: `file:./data/files` by default, or `s3://bucket` for S3, R2 or MinIO through Bun's S3 client.
   - A form's file field can be saved with `files.put`.
7. **Email-code sign-in.** `webstir enable sign-in` adds it:
   - **Tables:** Webstir's migrations create `users(id, email, session_version, created_at)` and the sign-in challenges.
   - **Pages:** `sign-in` and `sign-in/confirm` are written into the app as its own HTML, so they look like the app. The email's text is the app's too.
   - **The flow is the portal's:**
     - a 6-digit code and a magic link, stored hashed, expiring in 5 minutes, with 3 tries
     - rate limits per address
     - the same response whether or not the address can sign in
     - a magic link that confirms with a POST, so link scanners don't consume it
     - `returnTo` kept to the app's own pages
     - a new session id at sign-in
   - **Signed in:** `ctx.user` is the signed-in user, re-checked against `session_version` on each request.
   - **Guards:** `auth: 'required'` on a route or view sends a signed-out visitor to sign-in and back, or returns 401 for an API call.
   - **Signing out:** sign-out, and "sign out everywhere", which bumps `session_version`.
   - **Who may sign in** is the app's choice with one hook, `canSignIn(email)`. By default anyone can, and a first sign-in creates the user. An invite-only app like the portal returns false for unknown addresses.
8. **One env contract.**
   - The package loads `.env` and `.env.local`.
   - `init full` writes `.env.example` listing every setting and what it defaults to.
   - The published server checks what production requires before it listens, and names what's missing.
9. **A full app has them from the start.**
   - `init full` ships with the database, migrations, durable sessions, jobs, email and storage working with no setup.
   - `webstir enable backend` gives an existing app the same.
   - Sign-in is one command (`webstir enable sign-in`), since not every app has users.
   - API bearer auth stays: the adapter becomes a package export (`@webstir-io/webstir-backend/auth/bearer`) for `resolveRequestAuth`, instead of an orphaned template.
10. **The demos use them.**
    - `auth-crud` becomes a real app on the batteries: sign-in, notes in the database, durable sessions and an emailed notification through the queue.
    - `dashboard` drops its hand-rolled server session for the runtime's.
    - The orphaned templates are deleted, now that their code lives in the package.

## What stays

- Routes, views, forms, CSRF, flash, `renewSession` and the render layer.
- The published server's shape: `webstir-backend-deploy` serving pages and proxying to the backend.
- `resolveRequestAuth` for apps with their own identity provider.
- Static and SPA apps: none of this loads without a server.

## Tests and docs

- **Tests:**
  - **Database:** the same table test on SQLite and Postgres (Postgres when `TEST_DATABASE_URL` is set, and in CI through a service container): queries, placeholders, transactions rolling back.
  - **Migrations:**
    - apply once in order, and resume after a new file is added
    - a failing migration stops the server with its file and error
    - a `.ts` migration runs
    - `--status` lists them
  - **Sessions:**
    - a session survives a server restart
    - an expired one is gone
    - an async custom store works
  - **Jobs:**
    - a scheduled job runs in `watch` and in the published server
    - a queued job runs, retries after a failure and records its last error
    - an overlapping scheduled run is skipped
  - **Email:**
    - the dev log receives the message
    - SMTP delivers to a local test SMTP server
    - production without `EMAIL_URL` refuses to start when sign-in is enabled
  - **Storage:** put, get, url and delete on local disk and on S3 (a local S3-compatible server in CI).
  - **Sign-in, in the browser:**
    - request a code, read it from the dev email log, sign in and land on `returnTo`
    - the magic link signs in through its POST step
    - wrong codes run out after 3 tries
    - an unknown address gets the same response
    - rate limits apply
    - "sign out everywhere" ends another browser's session
    - a guarded page redirects and comes back
  - **Scaffolds:** `init full` then `publish`, then start the published server, runs a migration, keeps a session across a restart and runs a scheduled job; `enable sign-in` builds.
- **Docs:**
  - a how-to per battery: database and migrations, sessions, jobs, email, storage, sign-in
  - an env reference
  - the backend loop tutorial and templates reference rewritten to match what `init full` writes
  - the CLI reference for `add-migration`, `migrate`, `jobs` and `enable sign-in`

## Delivery

One PR, with a changeset. Merging it releases **Webstir 0.7.0** (minor). That publish is the one irreversible step. Two existing behaviours change, and the changeset says so:
- `ctx.db` becomes the database instead of an empty scratch object.
- A custom session store's methods become async.

After the release, the portal moves onto the batteries in its own repo: upgrade it from backend 0.3 and replace its hand-rolled database setup, session store, outbox, email, storage and sign-in with Webstir's. Its invite-only rule and staff/client model stay as its `canSignIn` hook and its own tables. What that move shows back about the batteries gets fixed in Webstir.

## Decisions (defaults chosen; say if you want otherwise)

- **SQL, not an ORM.** `ctx.db` runs SQL; an app that wants Drizzle or Kysely points it at the same `DATABASE_URL`. An ORM would decide how every app models data, and the portal already writes raw SQL in its stores.
- **SQLite by default, Postgres by URL.** One file is enough for most apps, and it's what the portal runs in production.
- **Migrations apply on start, forward only.** No separate deploy step to forget. Down migrations are rarely right on real data, so a mistake is fixed by a new migration.
- **Jobs run in the server process, on one machine.** No separate worker to deploy. The queue is at-least-once with retries, which covers email and notifications. Distributed workers and cross-machine locking are out of scope.
- **Email over SMTP.** Every provider offers it, so one transport covers all of them without an SDK per provider. The portal switches from the SES SDK to SES's SMTP endpoint.
- **Sign-in is email codes only.** Passwords, OAuth and passkeys are out of scope. An app can still bring its own through `resolveRequestAuth`.
- **Open sign-up by default.** A first sign-in creates the user; `canSignIn` makes an app invite-only.
