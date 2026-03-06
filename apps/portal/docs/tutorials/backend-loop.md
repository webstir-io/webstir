# Backend Loop

Build a backend-only flow that registers routes, touches the database helper, schedules a job, and inspects the manifest without starting the full dev server.

## 1. Scaffold a workspace
```bash
webstir init my-backend --server-only
cd my-backend
cp .env.example .env
```

> Tip: The server-only template still includes the frontend folders so the CLI can upgrade later. Passing `--server-only` simply skips the initial frontend assets.

## 2. Run backend-only watch
```bash
webstir watch --runtime backend
```

- The CLI prints a scope summary such as `filter: backend, running: backend-only` so you can confirm it is ignoring the UI workers.
- The Node server restarts whenever files under `src/backend/**` change. Live reloads remain available for frontend edits if you drop the runtime flag.

## 3. Add a manifest-backed route
```bash
webstir add-route accounts \
  --method GET \
  --path /api/accounts \
  --summary "List accounts" \
  --description "Returns the signed-in user's accounts" \
  --tags accounts,api
```

Update `src/backend/module.ts` with the handler. The scaffold already exports a `module` object with `routes` and `jobs`; extend it as shown:

```ts
import { createDatabaseClient } from './db/connection';

const routes = [
  {
    definition: {
      name: 'listAccounts',
      method: 'GET',
      path: '/api/accounts',
      summary: 'Return account metadata',
      description: 'Demonstrates auth + db helpers'
    },
    handler: async (ctx: RouteContext) => {
      if (!ctx.auth?.userId) {
        return { status: 401, errors: [{ code: 'auth', message: 'Sign in required' }] };
      }

      const db = await createDatabaseClient();
      const accounts = await db.query('select id, email from accounts where owner_id = ?', [ctx.auth.userId]);
      await db.close();

      return { status: 200, body: { accounts, greetedAt: ctx.now().toISOString() } };
    }
  }
];

export const module = {
  manifest: {
    contractVersion: '1.0.0',
    name: '@demo/backend',
    version: '0.1.0',
    kind: 'backend',
    capabilities: ['http', 'auth', 'db'],
    routes: routes.map((route) => route.definition)
  },
  routes
};
```

- `RouteContext` (already defined in the template) exposes `params`, `query`, `body`, `auth`, `env`, `logger`, `requestId`, and `now()`.
- The backend provider loads `build/backend/module.js`, logs the manifest summary, and automatically mounts every exported route—no manual registration required.

## 4. Connect to the database helper
- The scaffold ships with `src/backend/db/connection.ts`, which can create SQLite (`better-sqlite3`) or Postgres (`pg`) clients based on `DATABASE_URL`.
- Install the driver you plan to use, for example:
  ```bash
  npm install better-sqlite3
  ```
- The helper ensures the SQLite directory exists and exposes simple `query/execute/close` methods, making it ideal for cron-style jobs or lightweight APIs.

## 5. Schedule a job
```bash
webstir add-job nightly --schedule "0 0 * * *" --description "Nightly account sync" --priority 5
```

Implement the job in `src/backend/jobs/nightly/index.ts`:

```ts
import { createDatabaseClient } from '../../db/connection';

export async function run() {
  const db = await createDatabaseClient();
  await db.execute('update accounts set synced_at = datetime("now")');
  await db.close();
  console.info('[nightly] accounts synced');
}
```

Test it quickly:
```bash
node build/backend/jobs/scheduler.js --job nightly
```

## 6. Inspect the manifest
You no longer need to start the dev service to verify capabilities/routes/jobs:

```bash
webstir build --runtime backend
webstir backend-inspect
```

The inspect command prints the capabilities list plus every route and job recorded in `.webstir/backend-manifest.json`. This is the fastest way to double-check that metadata and schema references are wired correctly before pushing a branch.

## 7. Publish backend assets only
```bash
webstir publish --runtime backend
```

This regenerates just the backend bundle and writes the manifest to `dist/backend/**`, leaving the frontend artifacts untouched. Combine it with the Docker sandbox or your deployment scripts once you are ready.

## Next
- How-to: [Add a Backend Route](../how-to/add-route.md)
- How-to: [Add a Backend Job](../how-to/add-job.md)
- Reference: [CLI](../reference/cli.md)
