# Use the Database

A server app has a database: `ctx.db` in every route handler and view loader. It runs SQL with `?` placeholders on SQLite or Postgres, and it opens the first time something uses it, so an app that never touches it never creates one.

## Query it

```ts
const notes = await ctx.db.query<{ id: string; body: string }>(
  'SELECT id, body FROM notes WHERE owner_id = ? ORDER BY created_at DESC',
  [ctx.user.id],
);
const note = await ctx.db.get('SELECT body FROM notes WHERE id = ?', [id]); // first row or undefined
const { changes } = await ctx.db.execute('DELETE FROM notes WHERE id = ?', [id]);

await ctx.db.transaction(async (tx) => {
  await tx.execute('UPDATE accounts SET balance = balance - ? WHERE id = ?', [amount, from]);
  await tx.execute('UPDATE accounts SET balance = balance + ? WHERE id = ?', [amount, to]);
});
```

- A transaction commits when its function resolves and rolls back when it throws. One inside another is a savepoint.
- Dates are stored as ISO strings and booleans as `1` and `0`, the same on both databases.
- Jobs and scripts use the same database: `import { db } from '@webstir-io/webstir-backend/db'`.

## Choose the database

`DATABASE_URL` picks it:

| `DATABASE_URL` | Database |
| --- | --- |
| unset | SQLite at `data/app.sqlite` |
| `file:./data/app.sqlite` | SQLite, relative to the app |
| `postgres://user:password@host/database` | Postgres |

SQLite opens with WAL, foreign keys and a 5-second busy timeout. A transaction takes the write lock when it begins, so a script writing to the same file waits for it instead of failing. It suits most apps, in production too, on a disk that persists across deploys (see [Docker Deployment](./docker.md)).

## Change the schema with migrations

```bash
webstir add-migration create-notes --workspace "$PWD"
```

This writes `src/backend/migrations/0001-create-notes.sql`. Write the change in it:

```sql
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users (id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

- Migrations apply when the server starts, in `watch`, `test` and production, in file name order, each once, in a transaction with its record.
- A migration that fails stops the server with its file and the database's error.
- `--ts` writes a `.ts` migration exporting `up(db)`, for a change that needs code.
- Migrations only go forward: fix a mistake with a new one.
- With [sign-in](./sign-in.md), a migration can reference `users (id)`: Webstir creates its tables first.

```bash
webstir migrate --status --workspace "$PWD"   # each migration, and when it was applied
webstir migrate --workspace "$PWD"            # apply pending ones now, without starting the server
```

## Use an ORM or query builder

`ctx.db` runs SQL. For Drizzle, Kysely or another tool, point it at the same `DATABASE_URL`; Webstir's migrations and yours can share the database.
