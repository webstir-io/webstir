# Keep Sessions

A request's `ctx.session` is a plain object the server keeps between requests, behind a signed cookie. Sessions live in the app's [database](./database.md), so they survive restarts and deploys.

```ts
handler: async (ctx) => {
  ctx.session = { ...ctx.session, theme: 'dark' }; // kept for the next request
  return { status: 303, redirect: { location: '/' } };
}
```

- Set `ctx.session = null` to end the session.
- `renewSession(session)` from `@webstir-io/webstir-backend/runtime/session` moves it to a new id; do that when someone signs in. [Sign-in](./sign-in.md) does it for you.
- A route with `session: { mode: 'required' }` answers 401 to a request without a session.
- Flash messages, form state and CSRF tokens ride in the same session.

## Settings

| Variable | Default |
| --- | --- |
| `SESSION_SECRET` | required in production; in development one is made and kept in `.webstir/` |
| `SESSION_COOKIE_NAME` | `webstir_session` |
| `SESSION_MAX_AGE` | `604800` (seconds: a week) |
| `SESSION_COOKIE_SECURE` | on in production |

## Keep sessions somewhere else

Pass a store to the server in `src/backend/index.ts`. Its `get`, `set` and `delete` may answer at once or with a promise:

```ts
createDefaultBunBackendBootstrap({
  importMetaUrl: import.meta.url,
  sessionStore: {
    get: (id) => redis.get(id).then((value) => (value ? JSON.parse(value) : undefined)),
    set: (record) => redis.set(record.id, JSON.stringify(record)),
    delete: (id) => redis.del(id),
  },
});
```

`createInMemorySessionStore()` keeps them in memory, for tests.
