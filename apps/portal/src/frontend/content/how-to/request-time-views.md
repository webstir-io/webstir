# Request-Time Views

Use request-time views when you want the backend runtime to serve document HTML, load route-specific data on the server, and keep the page in the HTML-first lane.

This is the canonical Webstir path for dynamic documents that still behave like normal pages instead of fragment-only mutations or SPA routes.

## When To Use

- The page needs server-only data at request time.
- You want to keep navigation as normal document requests.
- You want the backend runtime to expose `x-webstir-document-cache` so you can observe document-shell reuse.

## Define The View

Add the view contract and loader to `src/backend/module.ts`:

```ts
import { z } from 'zod';
import { createModule, CONTRACT_VERSION } from '@webstir-io/module-contract';

const accountViewParams = z.object({
  id: z.string().min(1),
});

const accountViewData = z.object({
  account: z.object({
    id: z.string(),
    email: z.string().email(),
  }),
});

const accountView = {
  definition: {
    name: 'accountView',
    path: '/accounts/:id',
    summary: 'Render one account page',
  },
  params: accountViewParams,
  data: accountViewData,
  load: async (ctx: { params: { id: string } }) => ({
    account: {
      id: ctx.params.id,
      email: 'owner@example.com',
    },
  }),
};

export const module = createModule({
  manifest: {
    contractVersion: CONTRACT_VERSION,
    name: '@demo/accounts',
    version: '1.0.0',
    kind: 'backend',
    capabilities: ['http', 'views'],
    views: [accountView.definition],
  },
  views: [accountView],
});
```

## Type The Loader

`ViewContext` from `@webstir-io/webstir-backend` is what a loader receives: `url`, `params`, `session`, `user`, `forms`, `db`, `files`, `email`, `jobs`, `env`, `logger` and `now`. A loader returns its page's data without `flash`, which the framework adds; `flashSchema` from `@webstir-io/module-contract` is its shape in the data schema.

## Handle A Form

A page's form posts to a route that declares `form`. The runtime checks it before the handler runs:

- It checks the CSRF token when the route says `csrf: true`; every POST form a view renders already carries one.
- It hands the handler the parsed values as `ctx.form.values`.
- A submission that fails the check goes back to the page it came from, rendered again with the issue.

```ts
import { fieldIssue } from '@webstir-io/webstir-backend/runtime/views';

const addNote = {
  definition: {
    name: 'addNote',
    method: 'POST' as const,
    path: '/notes',
    auth: 'required' as const,
    form: { id: 'add-note', csrf: true },
  },
  async handler(ctx: ActionContext) {
    const title = String(ctx.form?.values.title ?? '').trim();
    if (!title) fieldIssue('title', 'Give it a title.');
    await ctx.db.execute('INSERT INTO notes (title) VALUES (?)', [title]);
    return { status: 303, redirect: { location: '/notes/' }, flash: [{ level: 'success', message: 'Added.' }] };
  },
};
```

- `fieldIssue(field, message)` sends the form back to its page with what was typed and the message; with no field, the message is for the whole form. `notFound()` and `redirect()` end an action as they end a loader.
- `fieldIssue(field, message, { form, values })` names another form's state for the page to read, such as one form per item (``form: `reply:${id}` ``), and replaces some of what was typed, such as a note that a file must be chosen again.
- An action that catches errors, to log or reword them, passes Webstir's own on: `if (isWebstirControl(error)) throw error;`. A test of an action reads what it sent back with `readFormIssue(error)`: its `field`, `message`, `formId` and `values`.
- The page reads the form's state with `ctx.forms.read('add-note')`: the declaration's `form.id`, or the route's name. `formView(state, fields)` and `formStateSchema(fields)` from `@webstir-io/module-contract` turn it into what the page binds: `submitted`, the typed `values`, and the first error per field in `errors` (plus `errors.form`).
- Every POST form a view renders also carries a submission id. The same submission sent twice (a double click, or a post the browser resends after a lost response) runs the action once, and the copy gets the first one's redirect. This works with or without script.

## Share Data Across Pages

The shell and partials often need the same data on every page, such as navigation or the signed-in account. Export a `shell` beside `views`, and every page a view renders binds it as `shell`, with no loader passing it along:

```ts
const shell = {
  data: z.object({ account: z.object({ email: z.string() }).nullable() }),
  load: (ctx: ViewContext) => ({ account: ctx.user ? { email: ctx.user.email } : null }),
};

export const module = { manifest, routes, views, shell };
```

```html
<p data-if="shell.account" data-text="shell.account.email"></p>
```

The build checks `shell.*` bindings against the shell's schema, as it checks the rest against the view's. A page no view renders has no data, so it can't bind `shell` either.

## Verify It

1. Run `webstir backend-inspect --workspace "$PWD"` to confirm the view appears in the backend manifest.
2. Run `webstir watch --workspace "$PWD"` and request the view path.
3. Check the response headers for `x-webstir-document-cache: miss|hit|stale`.

## Notes

- Request-time views are separate from fragment responses. Views return whole document HTML; fragments only replace a target region.
- A view that only a signed-in user may see says `auth: 'required'` in its definition, or `auth: { role: 'staff' }` for one role: a signed-out visitor is sent to sign in and back. Its loader gets `ctx.user`, `ctx.db` and the other batteries. See [Add Sign-In](./sign-in.md).
- Use pages under `src/frontend/pages/**` for static document structure and route-backed views when the backend must load request-time data.

## Related Docs

- [Add Route](add-route.md)
- [CLI](../reference/cli.md)
- [Workflows](../reference/workflows.md)
- [Solution](../explanations/solution.md)
