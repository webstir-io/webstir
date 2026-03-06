# Add a Backend Route

This guide shows how to add a backend route to your module manifest and optionally scaffold a Fastify handler.

## Prerequisites
- A Webstir workspace initialized via `webstir init ...`.
- Backend source at `src/backend/`.

## Steps
1. Add a route with defaults:
   - `webstir add-route users`
   - Writes `GET /api/users` to `webstir.moduleManifest.routes` in `package.json`.
2. Specify method and path explicitly when needed:
   - `webstir add-route users --method POST --path /api/users`
3. Attach metadata so documentation and tooling stay in sync:
   - `webstir add-route accounts --summary "List accounts" --description "Returns the current tenant accounts" --tags accounts,api`
   - Schema references follow the `kind:name@source` format described in the CLI reference. Example:\
     `webstir add-route accounts --params-schema zod:AccountParams@src/shared/contracts/accounts.ts --response-schema zod:AccountList@src/shared/contracts/accounts.ts`
4. Scaffold a Fastify handler (optional):
   - `webstir add-route accounts --fastify`
   - Creates `src/backend/server/routes/accounts.ts`.
   - If `src/backend/server/fastify.ts` exists, imports and registers `registerAccounts(app)` automatically.

## Wire the handler
After writing the manifest entry, implement the handler in `src/backend/module.ts` (or the Fastify scaffold). The template already exports a manifest and route list—extend it with your logic:

```ts
// src/backend/module.ts
import { createDatabaseClient } from './db/connection';
// RouteContext is already defined earlier in the scaffold file.

const routes = [
  {
    definition: {
      name: 'listAccounts',
      method: 'GET',
      path: '/api/accounts',
      summary: 'Return the current accounts',
      description: 'Demonstrates auth + db helpers'
    },
    handler: async (ctx: RouteContext) => {
      if (!ctx.auth?.userId) {
        return { status: 401, errors: [{ code: 'auth', message: 'Sign in required' }] };
      }

      const db = await createDatabaseClient();
      const accounts = await db.query('select id, email from accounts where owner_id = ?', [ctx.auth.userId]);
      await db.close();

      return { status: 200, body: { accounts } };
    }
  }
];

export const module = {
  manifest: {
    contractVersion: '1.0.0',
    name: '@demo/backend',
    version: '0.1.0',
    kind: 'backend',
    capabilities: ['http'],
    routes: routes.map((route) => route.definition)
  },
  routes
};
```

- The scaffolded `RouteContext` exposes `params`, `query`, `body`, `auth`, `env`, `logger`, and `now()` helpers.
- The backend provider auto-loads `build/backend/module.js`, logs the manifest summary, and mounts every exported route. No manual registration is required when you edit `src/backend/module.ts`.

## Verify the manifest
- Run `webstir build --runtime backend` (or `webstir watch --runtime backend`) to regenerate `.webstir/backend-manifest.json`.
- Print the manifest summary without starting the dev service:\
  `webstir backend-inspect`
- The inspect command lists capabilities, routes, and jobs so you can verify manifest metadata before sharing it with collaborators or publishing packages.

## Notes
- The CLI prevents duplicate entries for the same method+path.
- The backend provider also validates the manifest and emits diagnostics on duplicates.
- Route handler scaffolding is optional and intended as a starting point; adapt it to your server style.
- Schema references can point at Zod files (`zod:Type@path/to/file.ts`), JSON schema, or ts-rest routers. They only record metadata; the backend provider enforces the manifest at build time.

## See Also
- CLI reference: `../reference/cli.md#add-route`
- Backend provider: `../explanations/solution.md` (manifest ingestion)
