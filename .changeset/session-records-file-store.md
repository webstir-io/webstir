---
"@webstir-io/webstir-backend": patch
---

- Database sessions go in their own table, `webstir_session_records`, so an app that already has a `webstir_sessions` table from the old session template keeps it and its sessions work. An app that ran 0.7.0 keeps its sessions where they are.
- `setFileStore({ put, get, url, delete })` backs `ctx.files` with the app's own storage client, such as an AWS SDK client that reads a credentials profile.
