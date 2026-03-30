# Webstir Docs

Webstir is a server-first, HTML-first framework for low-JS apps. It is not a broad React replacement or an architecture menu. The core model is:

- render documents on the server
- treat forms, links, redirects, auth, and document navigation as the baseline
- add JavaScript only when fragment updates or navigation polish materially improve the experience

The active implementation lives in the Bun orchestrator plus the canonical TypeScript packages under `packages/**`.

## Start Here

- [Getting Started](./tutorials/getting-started.md)
- [Your First App](./tutorials/first-app.md)
- [Workflows](./reference/workflows.md)
- [Solution Overview](./explanations/solution.md)

## Default User Path

- Install the packaged CLI in a small tool root with `bun add @webstir-io/webstir`.
- Scaffold a server-first workspace outside the monorepo with `webstir init`.
- Build the baseline app around working server routes, forms, redirects, and auth before opting into `client-nav` or other enhancements.
- Run `watch`, `test`, and `publish` against that workspace with the installed CLI.
- Use the repo-local `bun run webstir -- ...` form only when you are contributing inside this monorepo.

## Proof Apps

- [`examples/demos/auth-crud`](https://github.com/webstir-io/webstir/tree/main/examples/demos/auth-crud) proves sessions, auth gates, validation recovery, redirect-after-post, and fragment-enhanced CRUD forms.
- [`examples/demos/dashboard`](https://github.com/webstir-io/webstir/tree/main/examples/demos/dashboard) proves deliberate shell-level and panel-level refreshes without making SPA architecture the default.

## Docs Index

- Tutorials: [README](./tutorials/README.md)
- How-to guides: [README](./how-to/README.md)
- Reference: [README](./reference/README.md)
- Explanations: [README](./explanations/README.md)

## Current Framing

- The Bun orchestrator is the active workflow surface.
- The main product lane is server-first HTML delivery with low-JS enhancement on top.
- SSG is supported, but it is one delivery mode inside that lane, not the main identity of the product.
- The canonical package/runtime story lives in `packages/tooling/webstir-frontend` and `packages/tooling/webstir-backend`.

## Community & Support

- Code of Conduct: https://github.com/webstir-io/.github/blob/main/CODE_OF_CONDUCT.md
- Contributing guidelines: https://github.com/webstir-io/.github/blob/main/CONTRIBUTING.md
- Security policy and disclosure process: https://github.com/webstir-io/.github/blob/main/SECURITY.md
- Support expectations and contact channels: https://github.com/webstir-io/.github/blob/main/SUPPORT.md
