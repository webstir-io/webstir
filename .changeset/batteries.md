---
'@webstir-io/webstir': minor
'@webstir-io/webstir-backend': minor
'@webstir-io/module-contract': minor
---

Batteries: a server app gets a database, migrations, durable sessions, jobs, email, file storage and email-code sign-in, with no setup.

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
