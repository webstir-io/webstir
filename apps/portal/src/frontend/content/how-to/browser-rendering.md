# Render a Page in the Browser

A Webstir page is an `index.html` with binding attributes (`data-text`, `data-attr-*`, `data-if`, `data-each`, `data-include`) plus data. **Where it renders follows from where its data comes from:**

| Data comes from | The page renders |
| --- | --- |
| a backend view's `load` | per request, on the server ([Request-Time Views](./request-time-views.md)) |
| a view that runs at publish | at build time ([Static Sites](./static-sites.md)) |
| the page script's own `load`, with a `data.ts` beside the page | in the browser (this guide) |

The template, the build-time checks and the escaping are the same in all three, because the same compiled program and the same executor render it. Moving a page from the server to the browser means moving its loader, not rewriting its markup. This works in every mode, SPA included.

## Add `data.ts`

A page renders in the browser when a `data.ts` sits beside its `index.html`. It exports the page's data schema and the data its first load shows:

```ts
// src/frontend/pages/fruit/data.ts
import { z } from 'zod';

export const data = z.object({
  title: z.string(),
  status: z.string(),
  filter: z.string(),
  items: z.array(z.string()),
});

export const initial = { title: 'Fruit', status: 'Loading', filter: '', items: [] };
```

- The build checks every binding in the template against `data`, and fails with the file and line on a mismatch, as it does for a view's page.
- `initial` must match `data`. The published HTML is the page rendered with it, so the first load shows real markup (here, "Loading") instead of placeholders.
- `data.ts` is read by the build only. The schema never reaches the browser, so Zod adds nothing to the page's bundle. The app needs `zod` as a dependency.

## Load the data and set the page up

The page script exports `load` and, as usual, `setup`:

```ts
// src/frontend/pages/fruit/index.ts
import type { PageContext, PageLoadContext } from '@webstir-io/webstir-frontend/runtime';

export async function load({ url, signal }: PageLoadContext) {
  const response = await fetch('/api/fruit', { signal });
  return { title: 'Fruit', status: 'Loaded', filter: '', items: await response.json() };
}

export function setup({ root, data, render }: PageContext<Awaited<ReturnType<typeof load>>>) {
  root.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.id !== 'filter') return;
    const filter = input.value;
    render?.({ ...data, filter, items: data.items.filter((item) => item.includes(filter)) });
  });
}
```

```html
<!-- src/frontend/pages/fruit/index.html -->
<head>
  <title data-text="title">Fruit</title>
  <script type="module" src="index.js"></script>
</head>
<body>
  <main>
    <h1 data-text="title">Fruit</h1>
    <p data-text="status">Loading</p>
    <input id="filter" data-attr-value="filter" />
    <ul><li data-each="items as item" data-text="item">Fruit</li></ul>
    <p data-if="!items">Nothing here.</p>
  </main>
</body>
```

What happens:

1. **First load:** the browser shows the page rendered with `initial`. Webstir then runs `load`, renders the result into `<main>` and `<title>`, and calls `setup` with the data. `<html data-webstir-ready>` appears after that; tests wait on it.
2. **With client-nav:** navigating to the page keeps the outgoing page on screen until `load` finishes, then swaps in the page already rendered with its data. The `initial` markup never shows.
3. **`render(data)`** renders the page again with new data. It replaces `<main>`'s content and keeps focus (and the caret) on the same control, matched by id, then by name. Because the content is replaced, listen on `root` (which stays), not on elements inside it. A `render` call after the visitor has left the page does nothing.

## Rules

- **Bindings live in `<main>` or `<title>`,** because that's what a browser render replaces. The build reports a binding anywhere else.
- **No POST forms.** A browser-rendered page has no session to carry the form's CSRF token. Render a page with forms on the server (a view), or post from the page script with `fetch`.
- **A page renders in one place.** A page with a `data.ts` can't also be named by a backend view's `page`; the build asks you to keep one.
