# Webstir Plan

> This is the only active plan for the repo. Keep it short. Do these in order. If current code or active docs conflict with this file, current code wins.

## Context

- The prior framework-contract plan is complete.
- Webstir now has stable Bun-side operations, inspect/doctor/repair surfaces, and a thin agent contract.
- The next phase should prove those contracts are usable by external tooling and strong enough to ship cleanly.

1. Expose real Webstir operations through MCP.
   - Build the MCP adapter on top of `webstir operations --json` and the existing stable CLI contracts.
   - Keep the adapter thin: wrap inspect, scaffold, validate, and repair operations instead of inventing new behavior.
   - Lock the machine-readable outputs with contract-focused tests or fixtures so wrappers can rely on stable JSON shapes.
   - Status: done locally
   - Progress: `webstir mcp` now serves the thin stdio MCP layer on top of the stable JSON CLI contracts, and orchestrator integration tests cover both tool discovery and structured unhealthy inspect results

2. Harden the Bun release path.
   - Tighten the Bun orchestrator and package workflow around the current required checks, smoke coverage, and benchmark flow.
   - Make release readiness obvious for the supported Bun path, including packaged-install confidence and docs where needed.
   - Define one explicit release gate for the supported Bun path so release readiness is a concrete pass/fail state.
   - Status: done locally
   - Progress: `bun run check:release` now extends the required gate with the recipe-app benchmark, the docs call out the release gate explicitly, and package-install smoke now covers the shipped inspect commands against the local release set

3. Define a frontend inspect contract and unify inspection.
   - Add a real frontend inspect surface for scaffolded pages, frontend features, and other stable frontend-owned facts.
   - Do not ship this as a glorified file listing; expose only durable contract-level data that external tooling can rely on.
   - Once both sides are stable, add a top-level `webstir inspect` flow that composes frontend and backend inspection appropriately by workspace mode.
   - Status: done locally
   - Progress: `inspectFrontendWorkspace()` now exposes the canonical frontend-owned contract, `webstir frontend-inspect` surfaces it directly, and `webstir inspect` composes doctor plus frontend/backend inspection by workspace mode with JSON support and integration coverage
