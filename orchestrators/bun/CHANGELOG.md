# @webstir-io/webstir

## 0.3.1

### Patch Changes

- 6bdf69d: `webstir repair` no longer re-creates missing scaffold files (including `AGENTS.md`); it only migrates what Webstir moved or changed, and lists missing files instead. Pass `--restore-scaffold` (MCP: `restoreScaffold: true`) to restore them as before. `doctor` no longer reports missing scaffold files as drift.
- a68ce70: Watch no longer misses edits made while it starts or while its file watcher resyncs, and requests wait for a frontend rebuild instead of failing while it replaces `build/frontend`.
- Updated dependencies [09e9cf3]
- Updated dependencies [4fe87a6]
  - @webstir-io/webstir-frontend@0.3.1
  - @webstir-io/webstir-backend@0.3.1
  - @webstir-io/module-contract@0.3.1
