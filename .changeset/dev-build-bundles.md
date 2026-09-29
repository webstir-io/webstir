---
"@webstir-io/module-contract": patch
"@webstir-io/webstir-backend": patch
"@webstir-io/webstir-frontend": patch
"@webstir-io/webstir": patch
---

`webstir watch` and `webstir build` carry an app's own imports into the backend's server entry, jobs and TypeScript migrations, as publish does, so an app whose backend files import each other starts in development. `webstir snapshot` copies the database as it is, without applying pending migrations.
