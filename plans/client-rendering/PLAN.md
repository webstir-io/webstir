# Plan: render pages in the browser from the same template

Step 1 of making Webstir the framework you can pick for any web app: one page model that renders at build time, per request, or in the browser. Server and static rendering exist today. This step adds the browser, so a client-rendered page is the same kind of page as the others instead of a separate system.

## The idea in one paragraph

A page is `index.html` with the five binding attributes, plus data. **Where it renders follows from where its data comes from.** A backend view with a loader renders it per request. A view that runs at publish renders it at build time. A `load` exported from the page's own script renders it in the browser. The template, the bindings, the build-time checks and the escaping rules are the same in all three. Moving a page from server to browser means moving its loader, not rewriting its markup.

## What changes

1. **The build bundles the program into the page's script.**
   - When a page's script exports `load` and no backend view claims the page, the build compiles `index.html` into its render program as it does now.
   - The build then embeds the program in the page's JavaScript bundle as a module.
   - It is never written as a served `.program.json`; the rule that programs are never served stays as it is.
2. **The build checks bindings against the page's data schema.**
   - A browser page declares its data in a sibling `data.ts` that exports a Zod schema, the same shape views use.
   - The build imports it, walks every binding path against it, and fails with the file and line on a mismatch.
   - The schema is used at build time only, so Zod is not shipped to the browser. `load` is typed against the schema.
3. **The browser runs the program.**
   - The frontend runtime imports `executeRenderProgram` from `module-contract`, where shared runtime code already lives. It is small and dependency-free.
   - After `load` returns, client-nav executes the program against the data and swaps `<main>`, using the existing prepared-page path. The outgoing page stays on screen until the data is ready, with no loading flash.
   - Escaping is identical to the server's, because it is the same code.
4. **First load.**
   - A browser page's HTML ships with `<main>` rendered from the page's optional exported `initial` data (for example an empty list and a loading message). Without `initial`, the build uses the template's placeholder content and marks `<main>` `aria-busy`.
   - Then `load` runs and the program renders the real content.
   - `data-webstir-ready` appears only after that, so tests and scripts wait on the real page.
5. **Re-rendering after the first render.**
   - `setup` gets `render(data)`, which runs the program again with new data and replaces `<main>`'s content. Focus and scroll are kept where the element still exists.
   - This covers client-heavy pages such as filters, sorting and live data.
   - It is a full replace of `<main>`, not a DOM diff. A morphing update is a later step if real pages need it.
6. **POST forms in browser pages.**
   - The executor already inserts the CSRF field into POST forms, and it needs a token.
   - In full-mode apps, the server writes the session's token into the app shell as `<meta name="csrf-token">`, and the runtime passes it to the executor.
   - A browser page with a POST form in an app without a backend is a build error with the file and line, because it could never submit.

## What stays the same

- The binding vocabulary, the build checks and the escaping rules.
- Server-rendered and statically rendered pages.
- Client-nav's link and form handling.
- Pages that don't opt in. A page script without `load` behaves exactly as today.

## Out of scope (later steps)

- Collapsing the four workspace modes into one, and one watch pipeline instead of two.
- Retiring the SPA router in favour of client-nav.
- Islands, meaning mounting another UI library inside a page.
- DOM morphing for re-renders.
- Batteries: auth, database and jobs.

## Proof

- **One template, three places.** The same `index.html` and data render at build, per request and in the browser. A table test asserts identical HTML across all three, including escaping, `data-each`, `data-if`, attributes and URL blocking.
- **Build checks.**
  - A browser page with a binding its schema lacks fails with the file and line.
  - A browser page with a POST form in an app without a backend fails.
  - The page bundle contains the program and the executor, and not Zod.
- **Browser tests** in the dashboard demo, which becomes the client-rendered example:
  - Client navigation to a browser page shows no loading flash.
  - First load shows `initial` and then the data.
  - `render(data)` updates the page and keeps focus.
  - A superseded navigation leaves nothing behind.
  - A POST form submits with the token.
- **Size.** The browser-side executor adds under 3 KB minified to the runtime.

## Delivery

Three layers, one release. Each layer branches from `main` after the previous one merges.

1. **Build:** compile, embed, check against `data.ts`, and the CSRF build error.
2. **Runtime:** render on navigation, first load, `render(data)`, and the token from the shell.
3. **Docs and demos:** a guide page, "Rendering in the browser". The dashboard demo becomes the client-rendered example.

Each layer carries a changeset. Merging the "Version packages" PR releases **Webstir 0.4.0** (a minor version: a new capability, and nothing existing changes). That publish is the one irreversible step.

## Decisions (defaults chosen; say if you want otherwise)

- **First load shows `initial` data or marked placeholders**, then real content. The alternative is keeping `<main>` hidden until data arrives, which is worse without JavaScript and slower to show anything.
- **A page's data source decides where it renders**, with no extra `render:` setting. One fewer thing to keep consistent.
- **`render(data)` replaces `<main>`** rather than diffing. It's simple and predictable, and diffing comes later if needed.

## As built (changes from this plan)

- **`initial` is required** in `data.ts` and checked against `data`. The first load always renders from it, so there's no placeholder or `aria-busy` branch.
- **No POST forms on browser-rendered pages** in this step. The CSRF token has no clean source in a static page, so they're a build error in every mode. Forms stay on server-rendered pages, or post from the page script.
- **Bindings must sit inside `<main>` or `<title>`**, which is what a browser render replaces. Anything else is a build error.
- **The browser proof is a dedicated test workspace**, not the dashboard demo. The dashboard demonstrates server-rendered fragment updates, and the SPA demo is shared by the SPA watch tests. The test publishes an SSG workspace with a browser-rendered page and runs it with and without client-nav.
- **SPA watch** hands a workspace with browser-rendered pages to the document builder, as it already does for client-nav and server views.
- **`@webstir-io/module-contract/render`** is a new, Zod-free entry for the executor, so page bundles don't ship Zod.
