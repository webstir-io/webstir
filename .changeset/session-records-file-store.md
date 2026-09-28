---
"@webstir-io/webstir-backend": patch
---

- Database sessions move to their own table, `webstir_session_records`, so an app that already has a `webstir_sessions` table from the old session template keeps it and its sessions work. Sessions stored by 0.7.0 carry over.
- `setFileStore({ put, get, url, delete })` backs `ctx.files` with the app's own storage client, such as an AWS SDK client that reads a credentials profile.
