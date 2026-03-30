# Primitives

The current Webstir golden path is built from a small set of HTML-first primitives. Use these as the default building blocks before reaching for broader app architecture.

## Page

- Canonical location: `src/frontend/pages/<name>/index.html|css|ts`
- Scaffold command: `webstir add-page <name> --workspace <path>`
- Use when you need a routed document page that is built and published by the frontend pipeline

`page` is the default frontend primitive. Keep page HTML in `src/frontend/pages/**` and keep shared shell assets in `src/frontend/app/**`.

## Form

- Canonical location: plain HTML `<form>` elements in page HTML or request-time backend HTML
- Default scaffold: the built-in `full` template route in `src/backend/module.ts`
- Use when the browser should be able to submit without client JavaScript

The form primitive is just HTML. Webstir adds value by making the backend route understand `application/x-www-form-urlencoded` payloads and by keeping the redirect-after-post path as the baseline behavior.

## Action

- Canonical location: `src/backend/module.ts`
- Default shape: a `POST` route with `interaction: 'mutation'` plus `form` metadata
- Use when a form submit mutates state and then returns either a redirect or a fragment response

Start from the `full` template when you need the default action shape. Use `webstir add-route` only when the endpoint also needs manifest-backed metadata outside the default scaffold flow.

## Fragment Target

- Canonical HTML marker: `data-webstir-fragment-target="<name>"`
- Canonical backend metadata: `fragment: { target, selector?, mode? }`
- Default scaffold: the progressive-enhancement example in the `full` template

Fragment targets are optional. The baseline route should still work as a normal form submission and redirect when enhancement is unavailable.

## Request-Time View

- Canonical location: backend-owned HTML returned at request time
- Contract surface: backend runtime document responses plus `defineView(...)` in `@webstir-io/module-contract` when you need typed view metadata
- Proof references:
  - `packages/contracts/module-contract/examples/accounts/module.ts`
  - `packages/tooling/webstir-backend/README.md`

Use request-time views when the backend owns the HTML response and the page depends on live request/session/auth state.

## Auth-Gated Route

- Canonical location: `src/backend/module.ts`
- Default guard surface: `ctx.auth` and route/session metadata
- Proof references:
  - `examples/demos/auth-crud`
  - `apps/portal/docs/tutorials/backend-loop.md`

Use an auth-gated route when the server, not the client, decides whether a request may proceed. The route should still preserve the same HTML-first fallback behavior as the rest of the golden path.

## Choosing The Primitive

When in doubt:

1. Start with `page`.
2. Add a plain HTML `form`.
3. Handle the submit in a backend `action`.
4. Add a `fragment target` only if partial updates materially improve the flow.
5. Add an `auth-gated route` when the server must enforce identity or session requirements.
6. Reach for a typed `request-time view` when the backend response itself is the product surface and needs an explicit contract.

## Related Docs

- [Workflows](./workflows.md)
- [Templates](./templates.md)
- [CLI](./cli.md)
- [Solution](../explanations/solution.md)
