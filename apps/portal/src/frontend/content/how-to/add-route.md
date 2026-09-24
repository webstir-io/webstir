# Add a Backend Route

This guide shows how to record backend route metadata and implement its handler. `add-route` writes metadata to `package.json`; it does not create a working endpoint.

Use this when a backend endpoint needs explicit manifest metadata, schema references, or `backend-inspect` visibility. For the default `full` app path, keep document pages in `src/frontend/pages/**` and keep form-handling logic in `src/backend/module.ts`, then add manifest-backed route entries as those backend surfaces stabilize.

## Prerequisites
- A Webstir workspace initialized via `webstir init ...`.
- Backend source at `src/backend/`.

## Steps
1. Add a route with defaults:
   - `webstir add-route users --workspace "$PWD"`
   - Writes `GET /api/users` to `webstir.moduleManifest.routes` in `package.json`.
2. Specify method and path explicitly when needed:
   - `webstir add-route users --workspace "$PWD" --method POST --path /api/users`
3. Attach metadata so documentation and tooling stay in sync:
   - `webstir add-route accounts --workspace "$PWD" --summary "List accounts" --description "Returns the current tenant accounts" --tags accounts,api`
   - Schema references follow the `kind:name@source` format described in the CLI reference. Example:\
     `webstir add-route accounts --workspace "$PWD" --params-schema zod:AccountParams@src/shared/contracts/accounts.ts --response-schema zod:AccountList@src/shared/contracts/accounts.ts`
4. Declare HTML-first route primitives when the route is a server-handled form or fragment update:
   - `webstir add-route sign-in --workspace "$PWD" --method POST --path /api/sign-in --interaction mutation --session required --session-write --form-urlencoded --csrf`
   - `webstir add-route account-panel --workspace "$PWD" --method POST --path /api/account/panel --interaction mutation --fragment-target account-panel --fragment-mode replace`
## Wire the handler
After writing the manifest entry, implement the handler in `src/backend/module.ts`. For example, record `webstir add-route hello --path /api/hello --workspace "$PWD"`, then add this entry to the existing `routes` array:

```ts
{
  definition: {
    name: 'hello',
    method: 'GET',
    path: '/api/hello',
    summary: 'Return a greeting',
  },
  handler: () => ({ status: 200, body: { message: 'Hello from Webstir' } }),
},
```

- Preserve the exported module and its `manifest.routes: routes.map((route) => route.definition)` mapping. The default `full` starter has a deliberately narrow local `RouteContext` type for its demo; use the public backend runtime types when your feature needs more context.
- Persistence and authentication require application wiring. The [coding-agent tutorial](../tutorials/build-with-an-agent.md) describes the complete persisted-form recipe and its package availability.
- The backend provider auto-loads `build/backend/module.js`, logs the manifest summary, and mounts every exported route. No manual registration is required when you edit `src/backend/module.ts`.

## Verify the manifest
- Run `webstir build --workspace "$PWD"` (or `webstir watch --workspace "$PWD"` in an `api` or `full` workspace).
- Print the manifest summary without starting the dev service:\
  `webstir backend-inspect --workspace "$PWD"`
- The inspect command rebuilds the backend and lists capabilities, routes, and jobs so you can verify manifest metadata before sharing it with collaborators or publishing packages.

## Notes
- The CLI prevents duplicate entries for the same method+path.
- The backend provider also validates the manifest and emits diagnostics on duplicates.
- `add-route` records metadata only. Verify the implemented endpoint with an HTTP request or browser, in addition to inspecting the manifest.
- `--session required` declares that a session must already exist. The runtime enforces it: requests without a session get `401` with a `session_required` error before the handler runs, and the rejection never creates a session. The declaration in `package.json` is applied to the matching `method` + `path` handler in `src/backend/module.ts` even when that handler states no `session` metadata; if the two disagree on `session.mode`, `required` wins and `backend-inspect`/startup report a warning. It does not check identity. Gate signed-in access in the handler (or a request hook) with `ctx.auth` or your own session data.
- `--form-urlencoded`, `--csrf`, and `--fragment-*` only declare the contract. Your handler in `src/backend/module.ts` still needs to implement the actual form, redirect, or fragment behavior.
- Schema references can point at Zod files (`zod:Type@path/to/file.ts`), JSON schema, or ts-rest routers. They only record metadata; implement request and response validation in application code.

## See Also
- CLI reference: `../reference/cli.md#add-route`
- Backend provider: `../explanations/solution.md` (manifest ingestion)
