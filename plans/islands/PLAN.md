# Plan: islands

Step 4 of making Webstir the framework you can pick for any web app. A Webstir page is HTML the server, the build or the browser renders from one template. Islands let a part of that page be a component from another UI library (React, Preact, Svelte, Vue, or anything else), so an app can use a date picker, a chart or an editor someone already built, or write its most interactive parts in the library its team knows, without giving up Webstir pages.

It is the standard islands pattern (Astro, Fresh, Eleventy's `<is-land>`): the page stays HTML, and only the islands load JavaScript.

## What's there today

- **A page's own interactivity lives in its script:** `setup` runs on every visit, with a `scope` for cleanup, and client-nav disposes it when the visitor leaves.
- **The runtime already has boundaries** (`runtime/boundary.ts`): something that mounts into an element, unmounts, and can hand its state across a remount. Watch uses them to swap a module in place.
- **Each page's script is bundled on its own,** without code splitting, so two pages that used React would each ship their own copy.
- **There is no way to say "this element is a React component".** An app can mount one by hand in `setup`, but it bundles React into the page and has to handle cleanup, client-nav and watch itself.

## What changes

1. **An island is a file.**
   - Islands live in `src/frontend/islands/<name>.<ext>`: `.tsx`/`.jsx` for React, Preact or Solid; `.svelte` for Svelte; `.vue` for Vue; `.ts`/`.js` for anything else.
   - The name is the file's name: `src/frontend/islands/price-chart.tsx` is the island `price-chart`.
2. **A page places an island with an attribute.**

   ```html
   <div data-island="price-chart" data-props="chart" data-load="visible">
     <p>Loading the chart…</p>
   </div>
   ```

   - The element's own content is what shows until the island mounts, and what visitors without JavaScript see. It renders from the template like the rest of the page.
   - `data-props` is a binding: it names a value in the page's data, which the page's renderer (server, build or browser) writes into the element as JSON. The same escaping rules apply as for every other binding.
   - An island without data takes no `data-props`.
3. **When an island loads is the page's choice,** with `data-load`:
   - `load` mounts as soon as the page is ready.
   - `idle` (the default) mounts when the browser is idle.
   - `visible` mounts when the element scrolls into view.
   - `media="(min-width: 800px)"` mounts when the media query matches.
4. **One contract, with adapters for the common libraries.**
   - An island module's default export is a component. Webstir finds its library from the file (`.svelte`, `.vue`), or from the app's dependencies for JSX (React, Preact or Solid, whichever the app has).
   - It mounts the component with that library's own API: `createRoot` for React, `render` for Preact, `mount` for Svelte, `createApp` for Vue, `render` for Solid.
   - A `.ts`/`.js` island exports `mount(element, props, { signal })` and may return a cleanup function. That covers any other library, or none.
   - The library is the app's own dependency; Webstir ships only the adapters.
5. **The build compiles islands and shares their libraries.**
   - Islands build as one code-split bundle, so React ships once however many islands use it, and only on pages that have one.
   - `.svelte` and `.vue` files compile through their official compilers, loaded from the app's own `svelte` or `vue` dependency. An app that uses neither never loads them.
   - The build writes a manifest from island name to its bundle; the page runtime reads it.
6. **Islands follow the page's lifecycle.**
   - Islands inside `<main>` mount after the page's `setup` and unmount when client-nav leaves the page. An island is also remounted when `render(data)` re-renders a browser-rendered page, with its new props.
   - Islands in the app shell mount once and stay across navigations.
   - Islands work with and without client-nav.
7. **Watch updates an island in place.**
   - Editing an island file remounts just that island from the new code. The rest of the page, its scroll and its other islands stay as they are.
   - Editing a page still refreshes the page, as step 2 made it.
8. **The build checks islands like it checks bindings,** and fails with the file and line when:
   - an island name has no file
   - `data-props` names a value the page's data doesn't have
   - `data-load` has a value it doesn't know
   - a `.svelte` or `.vue` island's library isn't installed
9. **`webstir add-island <name> [--react|--preact|--svelte|--vue|--solid]`** scaffolds an island in the library the app already uses, and adds the library when the app has none.

## What stays

- Templates, bindings, escaping and the three places a page renders.
- Pages, their scripts, `setup` and `render(data)`.
- Client-nav and the one watch pipeline.
- Apps that use no islands: they ship no island code at all.

## Tests and docs

- **Tests:**
  - A browser test per library (React, Preact, Svelte, Vue, Solid) and one for a plain `mount` island. Each checks:
    - the island mounts with its props and replaces its fallback content
    - it unmounts on navigation, and its cleanup runs
  - Load strategies: `visible` doesn't mount before the element is scrolled into view; `idle` and `media` mount when they should.
  - Two islands on two pages share one copy of their library: the published output has one React chunk.
  - Props render the same from the server, the build and the browser, escaped, for a server page, a static page and a browser-rendered page.
  - An island in the app shell survives a client-nav navigation. An island inside `<main>` is remounted by `render(data)`.
  - Watch: editing an island remounts it in place, and a page marker set in the browser stays.
  - The build errors (missing island, unknown props path, unknown `data-load`, library not installed) report the file and line.
  - `add-island` for each library.
- **Docs:** a new how-to, "Use components from another library (islands)". The CLI reference gets `add-island`; the rendering and client-nav guides mention islands.

## Delivery

One PR, with a changeset. Merging it releases **Webstir 0.6.0** (minor: a new capability; nothing existing changes). That publish is the one irreversible step.

## Decisions (defaults chosen; say if you want otherwise)

- **Islands render in the browser only.** The page's template renders the island element's fallback content everywhere; the component itself mounts in the browser. Rendering React or Vue on the server would bring a second template language into the server and build, which is what step 1 avoided.
- **Five libraries have adapters: React, Preact, Svelte, Vue, Solid.** Anything else works through the plain `mount` contract. They cover most of what teams reach for, and each adapter is a few lines.
- **`idle` is the default load strategy,** as in Astro and Fresh: it keeps islands off the page's critical path unless the page asks for `load`.
- **Props are the page's data, through a binding.** Islands never fetch their own initial state behind the page's back, so a page's data has one source whichever library shows it.
