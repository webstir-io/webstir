# Add status and filtering to an authenticated app

This recipe adds `active`/`archived` status, a native GET filter, and owner-scoped create/edit/delete forms. Its adjacent `projects.ts` is a complete feature module using the same Webstir form, session and database APIs as the notes recipe. It does not change how the app signs people in.

## Preserve the authentication boundary

Start with an app that knows who is signed in: Webstir's sign-in (`webstir enable sign-in`), which gives `ctx.user`, or the app's own identity provider through `resolveRequestAuth`, whose verified principal these routes read as `ctx.auth.userId`. Keep the app's existing sign-in and sign-out. Never read the owner from a form field or trust a caller-supplied user ID header. The `full` starter's display-name cookie is a demonstration, not a production identity system.

The database contract here is `projects(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL)`. If your app uses another schema, apply these changes to its existing handlers and migration system instead of replacing its tables or authorization. Preserve existing fields and constraints.

## Add the feature

Copy `projects.ts` to `src/backend/projects.ts`, then append `...createProjectRoutes()` to the existing `src/backend/module.ts` routes and regenerate the manifest route list from that array. Remove the starter-only `: readonly DemoRoute[]` annotation if present. Leave other application routes in place; if `/api/projects` already exists, integrate the recipe into that feature rather than registering duplicate paths.

```ts
import { createProjectRoutes } from './projects.js';

// Within the existing routes array:
// ...createProjectRoutes(),
```

Add the schema with a migration (`"$WEBSTIR" add-migration project-status --workspace "$PWD"`). For an app that already has `projects(id, owner_id, title)`, add the status once with a default of `active`, preserving existing rows and owners, and index it:

```sql
ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'archived'));
CREATE INDEX projects_owner_status ON projects (owner_id, status);
```

For an app without the table, create it instead, with `owner_id REFERENCES users (id)` when the app uses Webstir's sign-in. The server applies the migration once, when it next starts; build and inspect never open the database.

Back up existing data before applying a production migration. Keep the column if you roll back the UI; dropping it loses stored status values.

Using the absolute `WEBSTIR` path from the [setup guide](../../README.md), run `"$WEBSTIR" build --workspace "$PWD"`, `"$WEBSTIR" test --workspace "$PWD"`, and `"$WEBSTIR" watch --workspace "$PWD"`. Sign in through the app's existing flow and visit `/api/projects`. Filtering submits a GET form to `/api/projects?status=archived`; mutations submit native POST forms and redirect with HTTP 303. No client JavaScript is required. The signed session cookie identifies the server-side session that stores form state, while the verified principal supplies identity; possessing a session alone does not authorize a request.

## Prove the boundary and behavior

Use two accounts and an anonymous browser with JavaScript disabled:

1. Verify existing projects receive `active` after migration without changing owner/title. Create and edit each status. Reload, filter each status, use Back, and confirm the URL and selected option agree. Empty results still show usable controls.
2. Verify invalid statuses return 422 without changing stored data; unknown filters return 400. Blank/long titles and invalid CSRF tokens also fail without a write. Submitted HTML must render as text.
3. Account B must neither list nor update/delete account A's project, even with A's ID and B's valid CSRF token. Cross-owner and missing IDs both return 404. Anonymous GET and POST requests return 401.
4. Restart the backend and sign in again through the real auth flow. Status and ownership must persist. Existing sign-in/out and unrelated app features must still pass their tests.

Keep owner predicates in every SELECT, UPDATE, and DELETE even when an earlier lookup already checked ownership. Do not turn the owner into a hidden field or replace sign-in with `session.mode: 'required'`. Add optional fragment enhancement only after these native-browser and authorization checks pass.

Add these cases to `src/backend/tests/projects.test.ts` using `test` and `assert` from `@webstir-io/webstir-testing`, plus `getBackendTestContext` from `@webstir-io/webstir-backend/testing`. Its `request(path, init)` makes real HTTP requests to the test backend. Use your existing authentication test helpers to obtain A/B cookies; retain each response's `set-cookie` and send it on subsequent requests. Submit `URLSearchParams` with content type `application/x-www-form-urlencoded` and `redirect: 'manual'` to assert the 303 itself. Extract each form's `_csrf` token from that user's rendered page. The notes recipe's test shows the request/cookie pattern. Run with `"$WEBSTIR" test --runtime backend --workspace "$PWD"` against a disposable database and test identities; retain the separate JavaScript-disabled browser proof.
