# Snapshot the Database

An app on SQLite keeps copies of its database, taken as it changes, so a lost disk or a bad deploy costs minutes of data, not all of it:

```bash
SNAPSHOT_URL=s3://my-app-backups/database-snapshots/v1
```

- After the app writes, through `ctx.db` or `db` in a view, action, job or command, a consistent copy (`VACUUM INTO`) goes to `SNAPSHOT_URL` about a second later. Writes close together share one copy, and at most one is taken at a time, with one more after it for writes made meanwhile.
- A copy is named for when it was taken: `2026-09-29T12-00-00.000Z-<uuid>.sqlite`. It is written once, with a checksum, and never replaced.
- Closing the database first takes the copy its last writes are waiting for: when a command ends, and when the server stops (a deploy or restart sends it SIGTERM).
- `SNAPSHOT_URL` takes the same forms as `STORAGE_URL`: `file:./data/snapshots` for a folder, or `s3://bucket/prefix` with the same credentials. See [Store Files](./files.md).
- Give snapshots a place of their own, not `STORAGE_URL` itself: `SNAPSHOT_KEEP` removes the oldest `.sqlite` files it finds there.
- `SNAPSHOT_KEEP=48` keeps only the newest 48. Unset, every copy stays, for the bucket's lifecycle rules to expire.
- A copy that fails is retried, then logged; the write it followed has already succeeded.
- `webstir snapshot --workspace <path>` takes one now.

Webstir's own tables that change on almost every request, sessions and the job queue, don't trigger a copy by themselves; the next copy includes them.

## Restore

Stop the app, replace its database file (`data/app.sqlite`, or the path `DATABASE_URL` names) with the copy, and start it again.

## Postgres

Snapshots are for SQLite. A Postgres database is its host's to back up.
