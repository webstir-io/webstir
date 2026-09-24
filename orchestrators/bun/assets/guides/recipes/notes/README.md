# Persisted notes with native forms

This recipe adds a small, single-user notes page to a `full` app. It includes SQLite storage, create/edit/delete handlers, server validation, CSRF protection, and HTML that works with JavaScript disabled. It deliberately has no sign-in; use the projects recipe's existing-auth pattern before exposing private notes to other users.

## Install and wire it

From the generated app, install Bun's TypeScript declarations:

```sh
bun add --dev @types/bun
```

Add `"bun"` to `compilerOptions.types` in `src/backend/tsconfig.json` alongside `"node"`. Copy the adjacent `notes.ts` into `src/backend/notes.ts`. Create `src/backend/database.ts`:

```ts
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let database: Database | undefined;

export function getDatabase(): Database {
  if (database) return database;
  const filename = path.resolve(appRoot, process.env.APP_DATABASE_PATH ?? 'data/app.sqlite');
  mkdirSync(path.dirname(filename), { recursive: true });
  const connection = new Database(filename, { create: true });
  try {
    connection.exec('PRAGMA journal_mode = WAL');
    connection.exec('PRAGMA busy_timeout = 5000');
  } catch (error) {
    connection.close();
    throw error;
  }
  database = connection;
  return connection;
}
```

The default database is `data/app.sqlite` under the app root, independent of the CLI caller's working directory. An absolute `APP_DATABASE_PATH` is used unchanged; a relative one is resolved from the app root. The `src/backend`, `build/backend`, and `dist/backend` layouts all keep that root two levels above this module. The getter and route factory open storage and initialize the notes table only on the first request: build/inspect can import route metadata without creating or migrating a database.

Add `/data/` to `.gitignore`. In `src/backend/module.ts`, import the application feature and append its routes to the existing `routes` array:

```ts
import { getDatabase } from './database.js';
import { createNotesRoutes } from './notes.js';

// Keep the existing route entries; add this last:
// ...createNotesRoutes(getDatabase),
```

The starter's local `DemoRoute` type describes only the demo. Let the expanded array infer its type by removing `: readonly DemoRoute[]` from `const routes`. Keep both `routes` and `manifest.routes: routes.map(route => route.definition)` in the exported module. Each recipe entry contains a real `handler`; `webstir add-route` only adds metadata and is not a feature implementation.

Keep `src/backend/index.ts` and its session configuration. The recipe marks page and mutation routes with `session: { mode: 'optional', write: true }`, assigns form state back to `context.session`, and uses the runtime's signed session cookie for CSRF tokens. Set a stable `SESSION_SECRET` in production. The default session store is in memory: a restart expires open forms, while notes remain in SQLite.

Using the absolute `WEBSTIR` path from the [setup guide](../../README.md), run `"$WEBSTIR" build --workspace "$PWD"`, then `"$WEBSTIR" watch --workspace "$PWD"`, and open `/api/notes` on the URL printed by watch. Use an absolute `APP_DATABASE_PATH` outside `build/` and `dist/` for deployment and restart checks; mount durable storage for that file. Do not run this SQLite example on an ephemeral filesystem and expect persistence across deployments.

## Prove the feature

With JavaScript disabled in a browser:

1. Create a note and follow its edit link. Change both fields, save, reload, and verify the values.
2. Bypass browser validation and POST a blank title with a valid form token. Expect HTTP 422, a visible error, preserved body text, and no new row. A bad CSRF token must return 403 without a write.
3. Submit `<img src=x onerror=alert(1)>` in both fields. It must appear as text without creating an image element.
4. Restart the server using the same database path. Verify the note remains, then delete it and reload. Direct edits/deletes of an unknown ID return 404.

Copy the adjacent `notes.test.ts` into `src/backend/tests/notes.test.ts`. It uses Webstir's public `test`, `assert`, and backend request context to check native submissions and validation. Run against a disposable database:

```sh
APP_DATABASE_PATH="$(mktemp -d)/notes.sqlite" "$WEBSTIR" test --runtime backend --workspace "$PWD"
```

The starter tests do not assert notes behavior. Keep the browser and restart checks above as separate proof; an HTTP test cannot prove rendered interaction or restart persistence. Keep ordinary HTML forms working before adding optional fragment responses or `client-nav`.
