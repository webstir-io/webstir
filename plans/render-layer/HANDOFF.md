# Render layer: handoff

Written 2026-09-24 for whoever picks this up next. Everything needed is in the repo and in the Sqware Logics portal checkout; this file says where and what is already decided.

## Why this exists

Webstir is Chris's framework, built because he did not want to use React, believes a better framework can be built without it, and wanted to learn by building one. Adoption is not a goal. The checkpoint is [`plans/plan.md`](../plan.md).

The one production app, the Sqware Logics client portal at `~/dev/sqware-logics/portal`, was built React-shaped: JSON endpoints, client-rendered pages, ~6k lines of client TypeScript. It ended up that way because Webstir cannot turn server data into HTML. A page's `load()` runs in the browser, request-time views inject JSON for the client to render, and the only server-side HTML path is string concatenation with a hand-rolled escape. That is the missing organ, and the render layer is the fix.

## What is decided

The full design, worked through four real portal pages, is [`DESIGN.md`](DESIGN.md). Read it before writing code. In brief:

- The page's `index.html` is the template. Five attributes: `data-text`, `data-attr-<name>`, `data-if` (with `!`), `data-each="items as item"`, `data-include="partial"`. Paths only, no expressions. Everything escaped, no raw-HTML construct, no class-toggling construct, no interpolation, no switch (loaders shape unions into one key per variant). Binding attributes are stripped from output.
- The framework injects CSRF into every POST form and supplies `flash` to every view.
- A view definition gains `page` to name the `index.html` it renders.
- Build compiles pages to a program (static chunks plus operations) and validates every path against the view's zod `data` schema, failing with file and line. The backend executes the program at request time with no HTML parser. This replaces `injectViewState` in `packages/tooling/webstir-backend/src/runtime/views.ts`.
- Forms: loader reads prior submission state; an action's validation failure re-renders the page with values and issues and answers 422.
- Dialogs with modes become pages; hash tabs become URLs; `<details>` replaces dialogs for confirmations and inline forms.

## Build order

1. **Compiler** in `packages/tooling/webstir-frontend` (cheerio is already a dependency). Inline partials, emit the program with source lines, strip attributes, validate paths against the schema. Proof: the clients page in DESIGN.md compiles; a misspelled path fails the build with file and line.
2. **Executor** in `packages/tooling/webstir-backend` (must not depend on the frontend package). Run a program against data with escaping, inject CSRF, merge `flash`. Add `page` to view definitions in `packages/contracts/module-contract`. Proof: the clients view returns finished HTML and no view-state script.
3. **Forms round trip.** Loader-side read of submission state; `failure: { rerender }` on actions. Proof: an invalid submission comes back as 422 with the error in the HTML, JavaScript off.
4. **Move the portal onto it**, in the portal repo: clients, client, member pages first; then the proposal record and reader, which need multipart parsing and loader side effects.

Compiled programs are build artifacts the backend reads from disk. Do not compile on first request; build-time validation is the point.

## Known framework gaps to close on the way

- Multipart forms are declared at `packages/tooling/webstir-backend/src/runtime/core.ts:62` but nothing parses them.
- Loaders need to be allowed to commit session and store writes (recording "seen" on render).
- File downloads from routes (`content-disposition`) work today via `headers` and `body` and need documenting as a recipe.

## Where things are

- Views runtime: `packages/tooling/webstir-backend/src/runtime/views.ts` (`renderRequestTimeView`, `injectViewState`).
- Forms runtime: `packages/tooling/webstir-backend/src/runtime/forms.ts` (`prepareFormState`, `processFormSubmission`, `groupFormIssuesByField`).
- Session and flash: `packages/tooling/webstir-backend/src/runtime/session.ts`.
- Client navigation swaps `<main>`: `orchestrators/bun/resources/templates/full/src/frontend/app/scripts/features/client-nav.ts`.
- Page load runs in the browser today: `packages/tooling/webstir-frontend/src/runtime/page-load.ts`.
- Frontend HTML processing uses cheerio; grep `from 'cheerio'` under `packages/tooling/webstir-frontend/src`.
- Portal pages designed against: `src/frontend/pages/{clients,client,proposal-viewer,proposal}` and `src/frontend/app/{proposal-document,proposal-conversation}.ts` in the portal repo.
- Evaluation harness for no-JS, CSRF, ownership, and restart checks: `tools/agent-eval`.

## How Chris works

- He wants the whole thing, not a slice or a pilot. Do not propose "start with one feature".
- No comparators, benchmarks, or experiments. Standards to meet, yes; measuring against the old code, no.
- Verify claims against the checkout and cite `file:line`. He reads them and pushes back on stale claims.
- Keep code files around 500 lines or fewer. No explanatory comments unless asked; match the file's comment style.
- Prefer package-local validation first (`bun run --filter <pkg> build && test`), then the repo gate.
- Edit `packages/**` and `orchestrators/bun/resources/**`; `orchestrators/bun/assets/**` is generated.
- Say what you are about to do in a line, then do it. Recap plainly at the end.

## Uncommitted state at handoff

`PLAN.md`, `plans/plan.md`, `plans/render-layer/DESIGN.md`, and this file are in the working tree, not committed. Nothing else changed. A scratch `full` app was generated outside the repo for counting files and can be ignored.
