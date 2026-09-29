---
"@webstir-io/webstir-backend": patch
---

`webstir migrate` gives migrations the database it is migrating, as the server does when it starts, so a migration that uses `db` or queues a job no longer locks up.
