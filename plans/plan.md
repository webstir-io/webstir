# Webstir Plan

> This is the repo planning checkpoint. Keep it short. If current code or active docs conflict with this file, current code wins.

## Context

- The prior framework-contract plan is complete.
- Webstir now has stable Bun-side operations, inspect/doctor/repair surfaces, and a thin agent contract.
- The external-tooling, Bun-release, and unified-inspection slice has been completed and merged.
- The agent-driven custom runtime hardening slice has been completed and merged.
- The Webstir portal migration from Docusaurus to Webstir SSG is complete.
- Repository review found additional safety boundaries not covered by the completed hardening slice.
- The destructive `refresh` correction is implemented and verified for delivery.
- Name-derived scaffold output containment is implemented and verified for delivery.
- Fail-closed provider diagnostics is implemented and verified for delivery.
- Provider-authored asset containment is implemented and verified for delivery.
- Fixed `enable` and `repair` write destination containment is implemented and verified for delivery.
- Fail-closed frontend config updates are implemented and verified for delivery.

## Immediate Next Step

Audit the remaining Bun mutation sinks for another reproduced unsafe write before considering descriptor-relative write hardening.
