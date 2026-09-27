---
"@webstir-io/webstir": patch
---

Watch no longer misses edits made while it starts or while its file watcher resyncs, and requests wait for a frontend rebuild instead of failing while it replaces `build/frontend`.
