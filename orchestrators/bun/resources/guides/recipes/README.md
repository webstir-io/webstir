# Complete feature recipes

- [Persisted notes](notes/README.md): a migration and the app's database, native create/edit/delete forms, validation, escaping, CSRF, and restart verification.
- [Authenticated status and filtering](projects/README.md): extend the app's sign-in with owner-scoped queries, a data migration, native filters, and access checks.

Each recipe ships copyable application code beside its guide. Use the copy delivered with your installed Webstir version. Adapt it inside your app; editing Webstir itself is unnecessary. Keep existing handlers, customization, and authentication unless the requested feature requires a change. Route scaffolding describes a route; an exported application handler and an application-specific check establish working behavior.
