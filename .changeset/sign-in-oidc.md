---
'@webstir-io/webstir-backend': minor
'@webstir-io/webstir': minor
---

Sign-in through OpenID Connect. `oidc({ id, label, issuer, clientId, clientSecret })` from `@webstir-io/webstir-backend/sign-in` is a provider for services such as Microsoft Entra, Google and Okta: the authorization code flow with PKCE, a state and a nonce, with the ID token checked for its issuer, audience, nonce, lifetime and signature. The person is the token's `sub`, with its `email` only when the provider says it is verified; `identity` reads other claims, and `scopes`, `authorizeParams` and `allowSignUp` adjust the rest. In production each provider needs an https `issuer`, a `clientId` and a `clientSecret`. The protocol is handled by `oauth4webapi`, a new dependency of the backend package.
