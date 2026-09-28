# Backend Loop

Build a small API with a server and no pages (the `api` starter): a table made by a migration, routes that read and write it, a job the routes queue, and a job on a schedule.

## 1. Scaffold the app

```bash
webstir init api my-backend
cd my-backend
bun install
```

The app has `src/backend/index.ts` (the server), `.env.example` (its settings, all optional in development) and a `.gitignore` that keeps `data/` and `.webstir/` out of git.

## 2. Run it

```bash
webstir watch --workspace "$PWD"
```

The server restarts whenever a file under `src/backend/` changes.

## 3. Make a table

```bash
webstir add-migration create-notes --workspace "$PWD"
```

Write the table in `src/backend/migrations/0001-create-notes.sql`:

```sql
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

When the server restarts, it applies the migration: SQLite at `data/app.sqlite` is created, and the table in it.

## 4. Read and write it

Add `src/backend/module.ts`:

```ts
const listNotes = {
  definition: { name: 'listNotes', method: 'GET', path: '/api/notes' },
  handler: async (ctx) => ({
    body: { notes: await ctx.db.query('SELECT id, body FROM notes ORDER BY created_at DESC') },
  }),
};

const addNote = {
  definition: { name: 'addNote', method: 'POST', path: '/api/notes' },
  handler: async (ctx) => {
    const body = String((ctx.body as { body?: unknown })?.body ?? '');
    const id = crypto.randomUUID();
    await ctx.db.execute('INSERT INTO notes (id, body, created_at) VALUES (?, ?, ?)', [id, body, new Date()]);
    await ctx.jobs.enqueue('index-note', { id });
    return { status: 201, body: { id } };
  },
};

const routes = [listNotes, addNote];

export const module = {
  manifest: {
    contractVersion: '1.0.0',
    name: 'my-backend',
    version: '0.1.0',
    kind: 'backend',
    routes: routes.map((route) => route.definition),
  },
  routes,
};
```

```bash
curl -X POST localhost:4321/api/notes -H 'content-type: application/json' -d '{"body":"hello"}'
curl localhost:4321/api/notes
```

## 5. Add the jobs

The route queues `index-note`; make it, and a nightly clean-up:

```bash
webstir add-job index-note --workspace "$PWD"
webstir add-job prune --workspace "$PWD" --schedule "0 3 * * *"
```

```ts
// src/backend/jobs/index-note/index.ts
import { db } from '@webstir-io/webstir-backend/db';

export async function run(payload: { id: string }) {
  const note = await db.get('SELECT body FROM notes WHERE id = ?', [payload.id]);
  console.info('[index-note]', note);
}
```

Both run inside the server: `index-note` from the queue, retried if it throws, and `prune` at 3 a.m. See them, or run one now:

```bash
webstir jobs --workspace "$PWD"
webstir jobs run prune --workspace "$PWD"
```

## 6. Inspect and publish

```bash
webstir backend-inspect --workspace "$PWD"
webstir publish --workspace "$PWD"
```

`backend-inspect` prints the routes, jobs and migrations. In production, set `SESSION_SECRET` and keep `data/` on a disk that persists (see [Environment](../reference/env.md)).

## Next

- [Use the Database](../how-to/database.md)
- [Run Jobs](../how-to/add-job.md)
- [Add Sign-In](../how-to/sign-in.md)
