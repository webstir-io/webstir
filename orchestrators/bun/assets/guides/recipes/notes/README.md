# Persisted notes with native forms

This recipe adds a small, single-user notes page to a `full` app. It includes a table in the app's database, create/edit/delete handlers, server validation, CSRF protection, and HTML that works with JavaScript disabled. It deliberately has no sign-in; add it (`webstir enable sign-in`) and scope notes to `ctx.user.id`, as the projects recipe does, before exposing private notes to other users.

## Install and wire it

Using the absolute `WEBSTIR` path from the [setup guide](../../README.md), add a migration for the table:

```sh
"$WEBSTIR" add-migration create-notes --workspace "$PWD"
```

Write this in the new `src/backend/migrations/0001-create-notes.sql` (the number follows any migrations the app already has):

```sql
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  body TEXT NOT NULL CHECK (length(body) <= 10000),
  created_at TEXT NOT NULL
);
```

The server applies it once, when it next starts. The app's database is SQLite at `data/app.sqlite` under the app root by default, whatever directory the server starts from; `DATABASE_URL` points it elsewhere, such as Postgres. Build and inspect never open it.

Copy the adjacent `notes.ts` into `src/backend/notes.ts`. In `src/backend/module.ts`, import the feature and append its routes to the existing `routes` array:

```ts
import { createNotesRoutes } from './notes.js';

// Keep the existing route entries; add this last:
// ...createNotesRoutes(),
```

The starter's local `DemoRoute` type describes only the demo. Let the expanded array infer its type by removing `: readonly DemoRoute[]` from `const routes`. Keep both `routes` and `manifest.routes: routes.map(route => route.definition)` in the exported module. Each recipe entry contains a real `handler`; `webstir add-route` only adds metadata and is not a feature implementation.

Keep `src/backend/index.ts`. The recipe marks page and mutation routes with `session: { mode: 'optional', write: true }`, assigns form state back to `context.session`, and uses the runtime's signed session cookie for CSRF tokens. Sessions live in the same database, so open forms survive a restart. Set a stable `SESSION_SECRET` in production.

Run `"$WEBSTIR" build --workspace "$PWD"`, then `"$WEBSTIR" watch --workspace "$PWD"`, and open `/api/notes` on the URL printed by watch. For deployment, keep `data/` on durable storage, or point `DATABASE_URL` at Postgres; do not expect a SQLite file on an ephemeral filesystem to survive a deploy.

phemeral filesystem and expect persistence across deployments.

## Prove the feature

With JavaScript disabled in a browser:

1. Create a note and follow its edit link. Change both fields, save, reload, and verify the values.
2. Bypass browser validation and POST a blank title with a valid form token. Expect HTTP 422, a visible error, preserved body text, and no new row. A bad CSRF token must return 403 without a write.
3. Submit `<img src=x onerror=alert(1)>` in both fields. It must appear as text without creating an image element.
4. Restart the server. Verify the note remains, then delete it and reload. Direct edits/deletes of an unknown ID, with a valid form token, return 404.

Copy the adjacent `notes.test.ts` into `src/backend/tests/notes.test.ts`. It uses Webstir's public `test`, `assert`, and backend request context to check native submissions and validation. Run against a disposable database:

```sh
DATABASE_URL="file:$(mktemp -d)/notes.sqlite" "$WEBSTIR" test --runtime backend --workspace "$PWD"
```

The starter tests do not assert notes behavior. Keep the browser and restart checks above as separate proof; an HTTP test cannot prove rendered interaction or restart persistence. Keep ordinary HTML forms working before adding optional fragment responses or `client-nav`.
