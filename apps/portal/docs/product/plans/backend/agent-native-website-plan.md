# Goal
- Goal: add an experimental agent-native capability layer to Webstir so a site can expose typed actions alongside normal HTML-first routes, views, jobs, and services.

# Constraints And Assumptions
- Keep the capability layer below any chat assistant. Webstir should expose typed actions and runtime policy, not LLM orchestration.
- Preserve the HTML-first baseline for pages, forms, links, redirects, fragments, sessions, and request-time views.
- Treat `packages/contracts/**` and `packages/tooling/**` as canonical. Use `examples/demos/**` and `apps/portal/docs/**` for proof and docs. Do not target `orchestrators/dotnet/**`.
- Keep the first shipped slice implementable on today's web: manifest discovery, typed action execution, auth/scope checks, idempotency, and a human-review flow.
- Do not auto-promote every route into an action. Read-only discovery can be partially derived later; write actions must be explicitly authored.
- Keep the first contract additive and experimental so existing route/view consumers remain unaffected.

# Non-Goals
- Shipping a built-in chat assistant in core Webstir.
- Designing browser-native or OS-native standards in this repo.
- Full third-party OAuth delegation in the first slice.
- Automatic route-to-action generation for destructive or stateful operations.
- Treating DOM scraping or prompt-driven UI inference as the primary agent path.

# Status Summary
- Overall status: proposed
- Last updated: 2026-03-13
- Notes:
  - The repo already has the main prerequisites: manifest-driven module contracts, backend auth/session plumbing, structured route metadata, and proof apps for HTML-first flows.
  - The current gap is a first-class `actions` primitive in the contract and backend runtime.
  - No implementation has landed yet; this document is the working plan for fresh-context delivery cycles.
  - First ready item: 1. Write The RFC And Freeze The MVP Contract

# Latest Cycle
- Iteration: 0
- Selected item: none
- Outcome: captured the architecture direction and staged delivery plan for agent-native capabilities; no code changes have landed yet.
- Checks run: none
- Branch: none
- Commit: none
- PR: none
- Follow-up notes:
  - Build this as typed backend/module contract work, not as frontend assistant logic.
  - Keep the MVP anchored to a simple well-known manifest and backend action endpoints.

# Architecture Direction
- Core abstraction: `actions` become a first-class sibling to `routes`, `views`, `jobs`, `events`, and `services` in `@webstir-io/module-contract`.
- Runtime model: the backend runtime publishes a site-level discovery manifest and mounts typed action endpoints that call explicit handlers, with auth/policy checks before execution.
- UI coexistence: human pages and forms remain first-class and should share domain services with actions where practical.
- Assistant boundary: embedded assistants, browser agents, and external tooling may orchestrate actions, but Webstir core does not own that orchestration.
- MVP discovery: publish a well-known manifest endpoint first; defer browser-native primitives and standards work.

# Industry Fit
- Working assumption: the near-term industry direction is toward typed site capabilities, manifests, and explicit auth/consent flows for agents, not immediate browser-native standards.
- This plan is aligned to that assumption because the MVP is fully implementable on today's web without waiting for new browser or OS primitives.
- The first release should optimize for first-party and same-origin use cases, where Webstir can prove that HTML-first UI and typed agent actions can share one domain model safely.
- Delegated third-party agents, broader interoperability, and browser-level discovery or permission UX are follow-on opportunities, not prerequisites for the initial value.
- If the ecosystem later converges on common discovery or permission standards, Webstir should adapt the manifest surface rather than redesign the core `actions` abstraction.

# MVP Definition
- Add contract support for `actions` with typed input/output schemas and explicit metadata.
- Publish a backend discovery document at a well-known URL.
- Mount backend action invocation endpoints.
- Support anonymous read actions, signed-in actions, and service-token callers.
- Require explicit idempotency for write actions.
- Support one reviewable-intent flow for risky actions instead of blind execution.
- Prove the model in one canonical demo.

# Plan Items
## 1. Write The RFC And Freeze The MVP Contract
- Status: ready
- Depends on: none
- Scope: write the design RFC for `actions`, manifest discovery, invocation endpoints, auth/policy, and the review-intent model before changing runtime code.
- Done when:
  - The contract names and top-level shapes are agreed for `ActionDefinition`, `ActionSpec`, and `moduleManifest.actions`.
  - The MVP boundary is explicit, including what is deferred.
  - One sample manifest and one sample action invocation are documented.
- Progress:
  - 2026-03-13: initial architecture direction and staged delivery plan captured in this doc.

## 2. Extend `@webstir-io/module-contract` With Action Primitives
- Status: planned
- Depends on: 1
- Scope: add the typed action contract next to the existing route/view/job/event/service metadata in `packages/contracts/module-contract`.
- Done when:
  - `moduleManifestSchema` accepts `actions`.
  - The package exports `ActionDefinition`, `ActionSpec`, `ActionHandler`, and `defineAction(...)`.
  - Action metadata includes input/output schema references, auth requirements, permission scopes, side-effect level, idempotency, rate limits, human-review requirements, and versioning.
  - Build output regenerates any schema artifacts needed by downstream tooling.
- Progress:
  - None yet.

## 3. Add Backend Discovery And Invocation Runtime
- Status: planned
- Depends on: 2
- Scope: extend `packages/tooling/webstir-backend` so module-defined actions are discoverable and invocable through the default runtime.
- Done when:
  - The backend publishes a site-level manifest such as `/.well-known/webstir-agent-manifest.json`.
  - The backend mounts action endpoints such as `POST /agent/actions/:name`.
  - Requests carry structured logging and request IDs through the action path.
  - Action execution resolves through explicit handlers instead of repurposing route handlers.
- Progress:
  - None yet.

## 4. Add MVP Auth, Policy, Idempotency, And Review Intents
- Status: planned
- Depends on: 3
- Scope: wire the first safe execution path for anonymous read actions, signed-in actions, and service-token callers, including one reviewable-intent flow for risky actions.
- Done when:
  - Anonymous invocation is limited to read-only actions.
  - Signed-in and service-token callers are checked against declared scopes.
  - Write actions enforce idempotency keys.
  - Risky actions can return a reviewable pending intent instead of executing immediately.
  - Audit logs capture actor, action, outcome, and request correlation.
- Progress:
  - None yet.

## 5. Prove The Model In `examples/demos/auth-crud`
- Status: planned
- Depends on: 4
- Scope: use the existing auth-and-CRUD demo as the first proof app instead of introducing a separate domain.
- Done when:
  - The demo exposes a small action set such as `list_projects`, `get_project`, `create_project`, `update_project`, and one review-required destructive flow.
  - The same underlying domain logic is reachable from the HTML-first UI and the action layer.
  - Tests cover successful invocation, auth failures, scope failures, idempotent writes, and review-required responses.
- Progress:
  - None yet.

## 6. Document The Authoring Model And Runtime Shape
- Status: planned
- Depends on: 5
- Scope: document how actions fit beside routes/views, how discovery works, and how authors should think about auth, review, and coexistence with normal navigation.
- Done when:
  - Portal docs explain `actions` as a first-class Webstir primitive.
  - Package READMEs describe the discovery and invocation surfaces accurately.
  - Docs are explicit about what is implementable now versus what would require future browser/platform support.
- Progress:
  - None yet.

## 7. Harden And Expand After The MVP Lands
- Status: planned
- Depends on: 6
- Scope: use follow-on cycles for narrower hardening and ecosystem work once the first slice is working end to end.
- Done when:
  - Rate limiting, consent persistence, revocation, and better audit inspection are defined or shipped.
  - The design for delegated third-party agents is explicit, likely as a follow-on auth slice.
  - Optional page-level manifest linking and broader demo coverage are evaluated from a stable base.
- Progress:
  - None yet.

# Suggested Execution Order
- First cycle: item 1
- Second cycle: item 2
- Third cycle: item 3
- Fourth cycle: item 4
- Fifth cycle: item 5
- Sixth cycle: item 6

# Validation Strategy
- Contract work: `bun run --filter @webstir-io/module-contract build` and `bun run --filter @webstir-io/module-contract test`
- Backend work: `bun run --filter @webstir-io/webstir-backend build` and `bun run --filter @webstir-io/webstir-backend test`
- Demo work: `bun run webstir -- test --workspace "$PWD/examples/demos/auth-crud"` plus any targeted browser/runtime coverage added with the slice
- Keep validation package-local first, then widen only when a slice crosses package boundaries

# Open Questions
- Whether `actions` should live only at the module level first, or whether Webstir should also aggregate a site-level manifest automatically across modules in the first release.
- Whether the well-known manifest should be Webstir-specific at first or immediately shaped for broader ecosystem reuse.
- Whether the first review-intent flow should be generic in the contract or introduced as backend runtime policy metadata first.
- How much of the auth declaration belongs in the shared contract versus runtime-specific backend metadata.

# Fresh Context Seed
```text
Current state
- Webstir has a plan doc for an experimental agent-native capability layer.
- The feature is scoped as typed backend/module actions, not built-in chat orchestration.
- No code has landed yet.

Done
- Captured the architecture direction, MVP boundary, phased plan, validation path, and open questions in apps/portal/docs/product/plans/backend/agent-native-website-plan.md.

Next
- Write the RFC and freeze the MVP contract for ActionDefinition, ActionSpec, moduleManifest.actions, discovery endpoint shape, and the review-intent model.
```
