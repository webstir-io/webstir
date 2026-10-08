---
'@webstir-io/webstir-backend': patch
'@webstir-io/webstir': patch
---

Sign-in can go through other services. `providers` in `src/backend/sign-in.ts` takes objects with an `id`, a `label`, and `start` and `finish` functions; each gets a "Sign in with" link on the sign-in page, and the routes `/sign-in/<id>/` and `/sign-in/<id>/callback/`. A person is found again by the provider's own id for them, kept in a new `webstir_sign_in_identities` table, and `canSignIn`, `loadUser` and a provider's `allowSignUp` decide who gets in. `emailCode: false` turns the emailed code off, and production then needs no `EMAIL_URL`. The sign-in page from `webstir enable sign-in` now shows `flash` messages at the top and lists the providers; a page written earlier needs those two lines to show them.
