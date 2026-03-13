# Webstir Docs

Webstir is an HTML-first full-stack framework. The core model is:

- render documents on the server
- treat forms, links, redirects, and document navigation as the baseline
- add JavaScript only where fragment updates or navigation polish materially improve the experience

The active implementation lives in the Bun orchestrator plus the canonical TypeScript packages under `packages/**`.

## Start Here

- [Getting Started](./tutorials/getting-started.md)
- [Your First App](./tutorials/first-app.md)
- [Workflows](./reference/workflows.md)
- [Solution Overview](./explanations/solution.md)

## Proof Apps

- [`examples/demos/auth-crud`](https://github.com/webstir-io/webstir/tree/main/examples/demos/auth-crud) proves sessions, auth gates, validation recovery, redirect-after-post, and fragment-enhanced CRUD forms.
- [`examples/demos/dashboard`](https://github.com/webstir-io/webstir/tree/main/examples/demos/dashboard) proves shell-level and panel-level refreshes without forcing SPA architecture.

## Docs Index

- Tutorials: [README](./tutorials/README.md)
- How-to guides: [README](./how-to/README.md)
- Reference: [README](./reference/README.md)
- Explanations: [README](./explanations/README.md)
- Product plans: [README](./product/plans/README.md)

## Current Framing

- The Bun orchestrator is the active workflow surface.
- SSG is supported, but it is one delivery mode inside an HTML-first framework, not the main identity of the product.
- The canonical package/runtime story lives in `packages/tooling/webstir-frontend` and `packages/tooling/webstir-backend`.

## Community & Support

- Code of Conduct: https://github.com/webstir-io/.github/blob/main/CODE_OF_CONDUCT.md
- Contributing guidelines: https://github.com/webstir-io/.github/blob/main/CONTRIBUTING.md
- Security policy and disclosure process: https://github.com/webstir-io/.github/blob/main/SECURITY.md
- Support expectations and contact channels: https://github.com/webstir-io/.github/blob/main/SUPPORT.md
