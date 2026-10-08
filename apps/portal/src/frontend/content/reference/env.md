# Environment

A server app reads its settings from the environment, then from `.env.local`, then `.env`, in its root. A variable already set wins. `webstir init` writes `.env.example` listing them; the server checks what production needs before it listens.

| Variable | Default | What it sets |
| --- | --- | --- |
| `PORT` | `4321` | The port the server listens on. |
| `NODE_ENV` | `development` | `production` turns on the production checks and secure cookies. |
| `SESSION_SECRET` | made and kept in `.webstir/` in development | Signs session cookies, sign-in codes and file links. **Required in production.** |
| `SESSION_COOKIE_NAME` | `webstir_session` | The session cookie's name. |
| `SESSION_MAX_AGE` | `604800` | How long a session lasts, in seconds. |
| `SESSION_COOKIE_SECURE` | on in production | Sends the cookie only over HTTPS. |
| `APP_URL` | the request's address, in development | The address people use. **Required in production with sign-in.** |
| `DATABASE_URL` | `file:./data/app.sqlite` | SQLite (`file:...`) or Postgres (`postgres://...`). See [Use the Database](../how-to/database.md). |
| `EMAIL_URL` | printed and kept in `.webstir/email.log`, in development | SMTP URL for email. **Required in production to send.** See [Send Email](../how-to/email.md). |
| `EMAIL_FROM` | `Webstir <webstir@localhost>` in development | Who email comes from. **Required in production to send.** |
| `STORAGE_URL` | `file:./data/files` | Where files go: a folder, or `s3://bucket/prefix`. See [Store Files](../how-to/files.md). |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`, `S3_ENDPOINT`, `S3_PROFILE` | the `AWS_*` names, `AWS_PROFILE`, or the instance's role | Credentials and region for `s3://` storage and snapshots. |
| `S3_TIMEOUT_MS` | `10000` | How long one S3 request may take before it fails and, where safe, is retried (three attempts). |
| `SNAPSHOT_URL` | unset (off) | Where copies of a SQLite database go after writes: a folder, or `s3://bucket/prefix`. See [Snapshot the Database](../how-to/snapshots.md). |
| `SNAPSHOT_KEEP` | unset (every copy) | How many of the newest copies to keep. |
| `REQUEST_BODY_MAX_BYTES` | `1048576` | The largest request body the server accepts. |
| `SHUTDOWN_TIMEOUT` | `4` | How many seconds a stopping server waits for requests in flight, and for a running job, before closing them. See [Docker](../how-to/docker.md#stopping). |
| `WEBSTIR_JOBS` | on | `off` keeps this process from running scheduled and queued jobs. |
| `METRICS_ENABLED`, `METRICS_WINDOW` | on, `200` | Request counts and timings at `/metrics`, over the last N requests. |
| `AUTH_JWT_SECRET`, `AUTH_JWT_PUBLIC_KEY`, `AUTH_JWT_PUBLIC_KEY_FILE`, `AUTH_JWKS_URL`, `AUTH_JWT_ISSUER`, `AUTH_JWT_AUDIENCE`, `AUTH_SERVICE_TOKENS` | unset | Bearer-token auth for an API with its own identity provider, through `resolveBearerAuth` from `@webstir-io/webstir-backend/auth/bearer`. |

## What to keep

`data/` holds the SQLite database and stored files; `.webstir/` holds development secrets and email. Keep both out of git (the starters' `.gitignore` does), and give `data/` a disk that persists across deploys.
