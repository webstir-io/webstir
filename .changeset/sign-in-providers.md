---
'@webstir-io/webstir-backend': patch
'@webstir-io/webstir': patch
---

Sign-in can go through other services. `providers` in `src/backend/sign-in.ts` takes objects with an `id`, a `label`, and `start` and `finish` functions; each gets a "Sign in with" button on the sign-in page, a form that posts to `/sign-in/<id>/`, and comes back to `/sign-in/<id>/callback/`. A person is found again by the provider's own id for them, kept in a new `webstir_sign_in_identities` table; a user is one person at a provider. `canSignIn`, `loadUser` and a provider's `allowSignUp` decide who gets in. `emailCode: false` turns the emailed code off, and production then needs no `EMAIL_URL`. The sign-in page from `webstir enable sign-in` now shows `flash` messages at the top and a form for each provider; a page written earlier needs those to show them.
