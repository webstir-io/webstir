---
"@webstir-io/module-contract": minor
"@webstir-io/webstir-backend": minor
"@webstir-io/webstir-frontend": minor
"@webstir-io/webstir": minor
---

Require Zod 4.6.6 or later and migrate schema inspection and JSON Schema generation to Zod 4. Applications must upgrade their schemas to Zod 4. Framework-owned manifest, render-program and flash arrays now reject more than 10,000 items before validating their elements; MCP tool calls also have a 10,000-element total input limit. Application-defined data schemas retain their own limits.

Remove the ts-rest adapter, its root helper/type exports, and the `/ts-rest` package export. Replace `fromTsRestRoute` and `fromTsRestRouter` with native `defineRoute` definitions. The `ts-rest` schema-reference metadata remains available.

Upgrade the MCP SDK to 1.32.0 and refresh locked dependencies to address the reported dependency audit advisories.

Raise Nodemailer's minimum to 10.1.4 to fix recipient parsing of quoted strings and nested comments. Refresh the SDK's transitive Hono, rate-limit and IP parser dependencies, remove the stale IP parser override, and return fast-uri to Ajv's supported 3.x range.
