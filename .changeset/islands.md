---
"@webstir-io/webstir": minor
"@webstir-io/webstir-frontend": minor
"@webstir-io/module-contract": minor
---

Islands: a part of a Webstir page can be a component from React, Preact, Solid, Svelte or Vue, or plain `mount` code. An island is a file in `src/frontend/islands/`; a page places it with `data-island="<name>"`, passes it props from the page's data with the `data-props` binding (rendered on the server, at build or in the browser, escaped), and says when it loads with `data-load` (`load`, `idle`, `visible`, or `media` with `data-media`). The element's own content shows until it mounts. Islands build as one code-split bundle under `/app/islands/`, so a library ships once, and only pages with islands load them. They unmount and mount with client-nav navigations and `render(data)`, and `webstir watch` mounts an edited island again in place. The build checks island names, load strategies, `data-props` paths and that each island's library is installed, with the file and line. New `webstir add-island <name> [--react|--preact|--solid|--svelte|--vue]` scaffolds one. Render programs are now version 2 (they carry JSON attributes); rebuild to refresh them.
