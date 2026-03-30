# Webstir Plan

> This is the only active plan for the repo. Keep it short. Do these in order. If current code or active docs conflict with this file, current code wins.

## Context

- Webstir is not anti-React and it is not trying to beat React at everything.
- The strategy is to make Webstir better than a React-based framework for a narrow HTML-first, server-first lane where low-JS delivery, progressive enhancement, and explicit structure matter.
- The bet is that Webstir can be more legible to agents than React if the system stays rigid, inspectable, repairable, and built around one clear golden path.
- That means the product should win on determinism, scaffolding, diagnostics, repair, and higher-level Webstir primitives rather than on React compatibility or component-parity work.
- MCP and a Webstir agent matter, but only after the framework exposes stable operations they can call. They should sit on top of the contract, not hide missing product clarity.
- The backend/runtime foundation is good enough that the next phase should focus on product lane, golden path, inspectability, repairability, and proof.

1. Finish the backend test port fix.
   - Scope: `packages/tooling/webstir-backend/tests/integration.test.js`, `packages/tooling/webstir-backend/src/testing/index.ts`
   - Status: done locally
   - Progress: the source TS/JS test harness paths are now aligned, Bun bind failures retry correctly, and `bun run check:required` passed

2. Lock the product lane.
   - Decide exactly which HTML-first app category Webstir is for right now.
   - Status: done locally
   - Progress: `README.md` and the portal docs now frame Webstir as a server-first, HTML-first, low-JS framework rather than a broad React replacement

3. Define one golden path for building apps.
   - Write down the default way to do pages, forms, routes, fragments, auth, and deploy.
   - Status: done locally
   - Progress: docs now spell out the default `full` path, the full scaffold/demo/smoke path no longer auto-enables `client-nav`, and proof apps are labeled as proof apps instead of the default shape

4. Add a real inspect / doctor / repair contract.
   - Make it easy to answer: what exists, what is broken, and how to fix it.
   - Status: done locally
   - Progress: `backend-inspect --json`, `doctor --json`, and `repair --json` now provide structured output; the Bun CLI, docs, integration tests, and installed-package smoke all cover the surfaced contract

5. Raise the first-class Webstir primitives.
   - Add canonical scaffolds and contracts for page, form, action, fragment target, request-time view, and auth-gated route.
   - Do not chase JSX or component parity unless it clearly improves the golden path.
   - Status: done locally
   - Progress: `webstir add-route` now exposes the existing route-level interaction/session/form/fragment contract, backend inspect reports request-time views, and the portal docs now present request-time views plus auth-gated route metadata as canonical server-first primitives

6. Prove the lane with recipe apps and benchmarks.
   - Build a small set of gold-standard examples.
   - Benchmark real agent tasks against them.
   - Use the results to tighten the framework contract.
   - Status: done locally
   - Progress: the repo now treats `full`, `auth-crud`, and `dashboard` as the pinned recipe apps, the benchmark plan is codified in `tools/run-agent-task-benchmarks.mjs`, and `bun run benchmark:agent-tasks` passes against the current lane

7. Expose stable framework operations through MCP.
   - Only do this after inspect / build / test / repair / scaffold contracts are stable.
   - MCP should wrap real framework operations, not prompt-only workarounds.
   - Status: done locally
   - Progress: `webstir operations --json` now exposes the stable operation catalog with JSON support, mutability, and MCP-readiness metadata so wrappers can target real framework operations instead of scraping CLI help

8. Build a thin Webstir agent.
   - The agent should orchestrate Webstir operations, not invent architecture from scratch.
   - It should be able to inspect, scaffold, validate, and repair the golden path reliably.
   - Status: done locally
   - Progress: `webstir agent` now orchestrates `inspect`, `validate`, `repair`, `scaffold-page`, `scaffold-route`, and `scaffold-job` on top of the stable command contract, with JSON output, integration tests, and packaged-install smoke coverage

> Foundation already landed and not part of the active plan unless regressions reopen it: Bun-only backend runtime, package-managed backend bootstrap, clearer session/flash/CSRF boundaries, and stronger CI/install/smoke coverage.
