# Your First App

Build a small server-first HTML app with the packaged CLI, then validate the same watch, test, and publish loop you will use in a real workspace.

## Start From A Fresh Workspace

This tutorial assumes you already installed the CLI as shown in [Getting Started](./getting-started.md) and still have the absolute `WEBSTIR` path in your shell.

```bash
"$WEBSTIR" init full my-first-app
cd my-first-app
bun install
```

## Run In Dev Mode

```bash
"$WEBSTIR" watch --workspace "$PWD"
```

This starts the frontend dev server plus the backend runtime. The watch loop keeps document assets and `/api/*` responses in sync.

## Walk The Built-In Form Flow

Open `/`. The home page is rendered by the server on each request, and its form works as a plain HTML form:

1. Enter a name and submit. The server answers the post with a redirect back to `/`, carrying a message the page shows: redirect-after-post, the baseline for every form.
2. Try it with JavaScript disabled. It works the same way.

The app is small on purpose. `src/backend/module.ts` holds both halves:

- the `home` view, which renders `src/frontend/pages/home/index.html` on each request and lists the data it binds in a zod schema
- the `greet` route, which reads the `application/x-www-form-urlencoded` form, checks its CSRF token, and redirects with a flash message

`src/backend/index.ts` is the thin entry that starts the server; the rest of the plumbing (dev reload, error reporting, compiler settings) comes from the Webstir packages.

## Opt Into Client Navigation Later

New `full` apps start with `client-nav` on: links and form redirects swap the page in place instead of reloading it. Turn it off by removing `clientNav` from `webstir.enable` in `package.json`, and the same form flow keeps working as full-page navigation.

## Add A Page

```bash
"$WEBSTIR" add-page about --workspace "$PWD"
```

Open `/about`, edit files under `src/frontend/pages/about/`, and watch the document rebuild.

## Grow The Example

Make the example your app's first real flow:

- add fields to the home view's `data` schema and return them from its `load`, then bind them in the page with `data-text` and the other bindings
- give the `greet` route real work: validate the form and send it back with its errors, or save it with `ctx.db`
- add views and routes to the same `routes` and `views` lists as the app grows

For a larger example, with the progressive-enhancement flow, fragment updates and the page lifecycle, see the full demo in `examples/demos/full`.

## Validate The Workspace

```bash
"$WEBSTIR" test --workspace "$PWD"
"$WEBSTIR" publish --workspace "$PWD"
```

Inspect:

- `build/frontend/**` and `build/backend/**` for watch/build output
- `dist/frontend/**` for publish-ready assets

## Next

- [Solution Overview](../explanations/solution.md)
- [Watch](../how-to/watch.md)
- [Publish](../how-to/publish.md)
