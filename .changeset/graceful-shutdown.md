---
'@webstir-io/webstir-backend': patch
'@webstir-io/webstir': patch
---

A stopping server finishes what it is doing. On `SIGTERM` or `SIGINT` the server takes no new connections, lets requests in flight finish, stops its jobs, then closes the database and exits with `0`. `webstir-backend-deploy` waits for its own requests before it stops the app server, where it used to close every connection at once. `SHUTDOWN_TIMEOUT` sets each wait in seconds, 4 by default, after which what is still open is closed; a second signal exits at once with `1`. `startPublishedWorkspaceServer().stop()` now waits the same way, and `stop({ now: true })` does not.
