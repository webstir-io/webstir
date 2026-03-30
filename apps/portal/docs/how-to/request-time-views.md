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

## Verify It

1. Run `webstir backend-inspect --workspace "$PWD"` to confirm the view appears in the backend manifest.
2. Run `webstir watch --workspace "$PWD"` and request the view path.
3. Check the response headers for `x-webstir-document-cache: miss|hit|stale`.

## Notes

- Request-time views are separate from fragment responses. Views return whole document HTML; fragments only replace a target region.
- Keep auth-gated document routes in the same `src/backend/module.ts` path. In the current manifest contract, route-level `session` metadata is the main way to declare auth-gated backend routes, while views stay in the `views` manifest surface.
- Use pages under `src/frontend/pages/**` for static document structure and route-backed views when the backend must load request-time data.

## Related Docs

- [Add Route](add-route.md)
- [CLI](../reference/cli.md)
- [Workflows](../reference/workflows.md)
- [Solution](../explanations/solution.md)
