---
"@webstir-io/webstir": patch
---

`webstir repair` no longer re-creates missing scaffold files (including `AGENTS.md`); it only migrates what Webstir moved or changed, and lists missing files instead. Pass `--restore-scaffold` (MCP: `restoreScaffold: true`) to restore them as before. `doctor` no longer reports missing scaffold files as drift.
