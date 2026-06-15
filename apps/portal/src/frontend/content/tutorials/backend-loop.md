# Backend Loop

Build a backend-only flow that registers routes, touches the database helper, schedules a job, and inspects the manifest in an `api` workspace.

## 1. Scaffold an API workspace

```bash
webstir init api my-backend
cd my-backend
bun install
cp .env.example .env
```

`api` mode is the current backend-only path. It skips the frontend build plan instead of relying on a `--server-only` flag.

## 2. Run the backend watch loop

```bash
webstir watch --workspace "$PWD"
```

- The API workspace starts the backend build watcher and runtime only.
- The runtime restarts whenever files under `src/backend/**` change.

## 3. Add a manifest-backed route

```bash
webstir add-route accounts \
  --workspace "$PWD" \
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

- `RouteContext` exposes `params`, `query`, `body`, `auth`, `env`, `logger`, `requestId`, and `now()`.
- The backend provider loads `build/backend/module.js`, logs the manifest summary, and mounts exported routes automatically.

## 4. Connect to the database helper

- The scaffold ships with `src/backend/db/connection.ts`, which uses `Bun.SQL` for both SQLite and Postgres based on `DATABASE_URL`.
- SQLite works out of the box with `file:./data/dev.sqlite`, `sqlite:./data/dev.sqlite`, or `:memory:`.
- Postgres uses the same helper with a `postgres://...` URL, so you do not need to add a separate `pg` client just to use the scaffolded connection layer.

## 5. Schedule a job

```bash
webstir add-job nightly \
  --workspace "$PWD" \
  --schedule "0 0 * * *" \
  --description "Nightly account sync" \
  --priority 5
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
bun build/backend/jobs/scheduler.js --job nightly
bun build/backend/jobs/scheduler.js --watch
```

- The local scheduler now understands real cron expressions and cron nicknames on Bun `1.3.11+`, so schedules such as `0 0 * * *`, `*/15 * * * *`, `@daily`, `@monthly`, `rate(15 minutes)`, and `@reboot` all work in the built-in watch loop while still being preserved exactly in the manifest for your production scheduler.

## 6. Inspect the manifest

```bash
webstir build --workspace "$PWD"
webstir backend-inspect --workspace "$PWD"
```

`backend-inspect` rebuilds the backend and prints the current capabilities, routes, and jobs. Use it when you want a manifest summary without starting the watch loop.

## 7. Publish the backend workspace

```bash
webstir publish --workspace "$PWD"
```

In an `api` workspace, publish runs the backend-only plan.

## Next

- How-to: [Add a Backend Route](../how-to/add-route.md)
- How-to: [Add a Backend Job](../how-to/add-job.md)
- Reference: [CLI](../reference/cli.md)
