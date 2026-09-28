# Use Components from Another Library (Islands)

An island is a part of a Webstir page that is a component from another UI library: React, Preact, Solid, Svelte, Vue, or plain code. The page stays HTML that renders on the server, at build time or in the browser; only its islands load JavaScript, when the page says they should.

## Add an island

```bash
webstir add-island price-chart --react --workspace "$PWD"
```

This writes `src/frontend/islands/price-chart.tsx` and adds React to `package.json` if the app doesn't have it (run `bun install` afterwards). Use `--preact`, `--solid`, `--svelte` or `--vue` for another library. Without a flag, it uses the library the app already has, or plain code when it has none.

An island is a file in `src/frontend/islands/`, named for the island:

| File | Library | What it exports |
| --- | --- | --- |
| `name.tsx`, `name.jsx` | React, Preact or Solid, whichever the app depends on | a component, as the default export |
| `name.svelte` | Svelte 5 | the component |
| `name.vue` | Vue 3 | the component |
| `name.ts`, `name.js` | none | `mount(element, props, { signal })`, which may return a cleanup function |

An app with more than one JSX library names the one its JSX islands use in `package.json`: `"webstir": { "islands": { "jsx": "preact" } }`.

## Place it in a page

```html
<div data-island="price-chart" data-props="chart" data-load="visible">
  <p>Loading the chart…</p>
</div>
```

- **`data-island`** names the island.
- **The element's content** shows until the island mounts, and is what visitors without JavaScript see. The island replaces it.
- **`data-props`** is a binding: it names a value in the page's data, which becomes the component's props. It works wherever the page renders: a view's `load`, a view rendered at publish, or the page's own `data.ts` and `load`. The build checks the path like any other binding.
- **`data-load`** says when the island loads:
  - `load`: as soon as the page is ready.
  - `idle` (the default): when the browser is idle.
  - `visible`: when the element scrolls into view.
  - `media`: when the query in `data-media` matches, for example `data-load="media" data-media="(min-width: 800px)"`.

## How islands behave

- **Only pages with islands load island code,** and each island's library ships once however many islands use it.
- **With client-nav,** a page's islands unmount when the visitor leaves the page, so their cleanup runs, and the next page's islands mount. Islands in the app shell mount once and stay.
- **A browser-rendered page's `render(data)`** mounts its islands again with the new props.
- **In `webstir watch`,** editing an island mounts it again from the new code, where it is; the rest of the page stays as it is.

## What the build checks

The build fails with the file and line when:
- an island's name has no file
- `data-props` names a value the page's data doesn't have
- `data-load` isn't one of the strategies, or `media` has no `data-media`
- an island's library, or its compiler, isn't installed
