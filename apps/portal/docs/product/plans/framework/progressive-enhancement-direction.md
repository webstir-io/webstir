# Progressive Enhancement Direction

## Thesis
- Webstir is not trying to become a React-first framework or a Next.js clone.
- Webstir should be an HTML-first, progressively enhanced, full-stack web framework.
- The target is modern web applications that work without client JavaScript first, then improve when JavaScript is present.
- Comparisons to Next.js should be framed around production viability and user-perceived performance, not parity with React-specific primitives.

## Product Principles
- Prefer server-rendered HTML over SPA-first architecture.
- Treat forms, links, redirects, and document navigation as primary primitives.
- Use client JavaScript to enhance the baseline experience, not to replace it.
- Keep the network, browser, and device cost low by default.
- Do not assume Webstir lacks a cache or invalidation story without checking the existing contract and runtime surfaces first.

## Anti-Goals
- Do not rebuild the React mental model with different package names.
- Do not optimize for React-specific features such as Server Components parity as a primary goal.
- Do not let provider modularity become the product story.
- Do not drift into a static-site-only tool with optional JavaScript sprinkles.

## What Webstir Must Be Good At
- Server-rendered HTML applications with selective enhancement.
- Forms and mutations that work cleanly without client JavaScript.
- Partial page updates and fragment rendering without forcing SPA architecture.
- Sessions, cookies, CSRF, auth gates, redirects, flash messages, and cache-aware request handling.
- Low-JavaScript delivery with strong performance on low-end devices and poor networks.
- Straightforward deployment on plain Node, Docker, and static/CDN-friendly setups where appropriate.

## Progress
- Completed: progressive-enhancement route primitives landed in `@webstir-io/module-contract`.
  - Routes now support explicit mutation metadata, form metadata, fragment metadata, redirect outputs, and fragment/redirect handler results.
- Completed: backend scaffold runtime honors the new route results.
  - The default server and Fastify scaffold now handle redirects, fragment responses, and `application/x-www-form-urlencoded` request bodies.
  - Backend tests now include an end-to-end runtime check for redirect and fragment responses.
- Current focus: build the client/runtime counterpart that can consume fragment responses and update the DOM without collapsing into SPA routing.

## Repo-Specific Worklist

### 1. Contract primitives for progressive enhancement
- Extend `@webstir-io/module-contract` so forms, mutations, fragment responses, redirects, flash/session messaging, and request pipeline hooks are explicit framework primitives.
- Keep route/view contracts, but add the missing authoring model for progressive enhancement workflows.
- Main touchpoint: `packages/contracts/module-contract/src/index.ts`.
- Status: initial slice complete; follow-up work still needed for richer response variants and adjacent primitives such as flash/session messaging.

### 2. Real server-rendered HTML runtime
- Build a runtime path for request-time HTML rendering, not only SSG metadata and `view-data.json` generation.
- Treat server-rendered HTML as the flagship path in the frontend/backend integration.
- Main touchpoints: `packages/tooling/webstir-frontend/src/modes/ssg/views.ts`, `packages/tooling/webstir-frontend/src/provider.ts`, `packages/tooling/webstir-backend/src/provider.ts`.

### 3. First-class fragment and partial update model
- Add an official way to update a region of the page after form submissions or user interactions.
- This should feel native to the framework and preserve the non-JavaScript baseline.
- Main touchpoints: `packages/tooling/webstir-frontend/src/builders/htmlBuilder.ts`, `packages/tooling/webstir-frontend/src/html/*`, `orchestrators/bun/src/dev-server.ts`, `orchestrators/bun/src/backend-runtime.ts`.
- Status: server-side transport is in place; client-side consumption and DOM replacement are still outstanding.

### 4. Forms and mutations as the primary workflow
- Make server-handled forms easier than client-heavy mutation flows.
- Cover parsing, validation, error presentation, redirect-after-post, CSRF, and flash message ergonomics in the default scaffold/runtime.
- Main touchpoints: `packages/tooling/webstir-backend/src/scaffold/assets.ts`, `packages/tooling/webstir-backend/src/build/*`, `packages/tooling/webstir-backend/src/manifest/pipeline.ts`.

### 5. Request pipeline and middleware execution
- Wire middleware or request hooks through the actual Bun runtime, not just the manifest schema.
- Make auth, logging, sessions, redirects, and cache-aware behavior composable in the request path.
- Main touchpoints: `packages/contracts/module-contract/src/index.ts`, `packages/tooling/webstir-backend/src/provider.ts`, `orchestrators/bun/src/backend-runtime.ts`.

### 6. Explicit cache and invalidation ergonomics
- Surface the existing cache story in a way application authors can use and understand.
- Document what is cached, where it lives, how it is invalidated, and how page or fragment correctness is maintained.
- Main touchpoints: contract docs, backend runtime, and framework docs.

### 7. Reframe the frontend package around HTML-first app delivery
- Move the product story away from "experimental page pipeline" and toward "HTML-first application runtime."
- Keep SSG as one mode, not the center of the framework identity.
- Main touchpoints: `packages/tooling/webstir-frontend/README.md`, `apps/portal/docs/how-to/*`, `apps/portal/docs/reference/*`.

### 8. Production hardening
- Replace "experimental" by earning trust through correctness and stability.
- Prioritize test coverage for forms, partial updates, auth/session flows, middleware behavior, cache correctness, and watch/publish reliability.
- Main touchpoints: `packages/tooling/webstir-frontend/tests`, `packages/tooling/webstir-backend`, `orchestrators/bun/tests`.

### 9. Proof applications
- Add canonical end-to-end apps that prove the model on real software, not just toy demos.
- Target examples such as auth, CRUD backoffice, content plus forms, dashboards with partial refreshes, and background jobs.
- Main touchpoint: `examples/demos/*`.

### 10. Opinionated documentation
- Teach the Webstir way of building applications instead of only documenting APIs and provider seams.
- Put forms, fragments, sessions, caching, navigation, and deployment at the center of the docs.
- Main touchpoint: `apps/portal/docs/`.

## Working Priorities
- Build the client/runtime counterpart for fragment responses.
- Prove a full form-submit -> fragment-update flow end to end.
- Build one canonical application that demonstrates the model clearly.

## Decision Filter
- Does this make HTML-first app development more coherent?
- Does this preserve a no-JavaScript baseline?
- Does this make progressive enhancement easier than building a client-heavy workaround?
- Does this reduce browser and network cost?
- Does this make Webstir more obviously distinct from React-first frameworks?
