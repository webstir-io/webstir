# Add Sign-In

```bash
webstir enable sign-in --workspace "$PWD"
```

People sign in with a code sent to their email, or the link in the same email. There are no passwords to store or reset. An app can also let them [sign in through another service](#sign-in-through-another-service). The command writes:

- **`src/backend/sign-in.ts`:** your choices: who may sign in, and the email's text.
- **`src/frontend/pages/sign-in/`** and **`src/frontend/pages/sign-in-confirm/`:** the pages, as your own HTML to style.

The server adds the rest when `sign-in.ts` exists: the routes the pages' forms post to, and the `users` table.

## Require it

```ts
const accountView = {
  definition: { name: 'account', path: '/account', page: 'account', auth: 'required' },
  load: (ctx) => ({ email: ctx.user.email }),
};
```

- `auth: 'required'` on a view or route sends a signed-out visitor to `/sign-in/` and back to where they were going. An API call (a route without a form, asking for JSON) gets 401 instead.
- `auth: { role: 'staff' }` also needs the role: signed out goes to sign in, as above; signed in without it gets the 404 page, so the address doesn't reveal what is there.
- `ctx.user` is `{ id, email }`, or the app's own user when it has a `loadUser` (below), or `null` when nobody is signed in. A migration can reference `users (id)`.
- A form that posts to `/sign-out/` signs out; with a field named `everywhere`, it ends every session of that user, on every device.

## How it works

1. The visitor gives their address. If they may sign in, Webstir emails a 6-digit code and a link. Someone already signed in, who still may, goes straight on.
2. The code works for 5 minutes and 3 tries. It can be typed with spaces or dashes, or pasted with the email's words around it. A new request replaces the old code, and the page says one is on its way. An address gets at most one code a minute and five in fifteen minutes.
3. The answer is the same whether or not the address may sign in, or asked too often, so the page tells nobody who has an account.
4. The link opens a page that signs in with a button (a POST), so a mail scanner that follows links uses nothing up.
5. Signing in starts a new session, and returns the visitor to the page they came from, never to another site. Someone already signed in who opens sign-in goes straight there.
6. Codes and link tokens are stored only as hashes, keyed with `SESSION_SECRET`.

In development, the email is printed in the terminal and kept in `.webstir/email.log`, and the page says so.

## Choose who may sign in

By default anyone can, and a first sign-in creates the user. For an app where people are invited, turn others away in `src/backend/sign-in.ts`. It is asked when a code is requested and again when the code or link is used, so someone removed in between is turned away:

```ts
const signIn: SignInOptions = {
  canSignIn: async (email) => Boolean(await db.get('SELECT 1 FROM invitations WHERE email = ?', [email])),
};
```

## Say who a signed-in person is

An app with its own idea of a user (a name, a team, roles) turns Webstir's `{ id, email }` into it once per request, with `loadUser`. What it returns is `ctx.user` in every view, route and shell loader, and its `roles` are what `auth: { role }` checks:

```ts
const signIn: SignInOptions = {
  loadUser: async (user) => {
    const member = await db.get('SELECT name, team, staff FROM members WHERE user_id = ?', [user.id]);
    if (!member) return null;
    return { ...user, name: member.name, team: member.team, roles: member.staff ? ['staff'] : [] };
  },
};
```

`null` means no access: that person is treated as signed out, and the sign-in page tells them this account has no access here. Type loaders with `ViewContext<Member>` and handlers with `ActionContext<Member>` from `@webstir-io/webstir-backend`.

## Sign in through another service

People can also sign in through a service the app trusts to say who they are. Each one is a provider in `src/backend/sign-in.ts`, and a "Sign in with" link on the sign-in page:

```ts
const signIn: SignInOptions = {
  providers: [acme],
  emailCode: false,
};
```

- `emailCode: false` leaves providers as the only way in: the page shows no email form, and production needs no `EMAIL_URL`.
- The link goes to `/sign-in/<id>/`, which sends the visitor to the provider. They come back to `/sign-in/<id>/callback/`, which is the address to register with the provider.
- `canSignIn` and `loadUser` apply as they do to email codes. A provider with `allowSignUp: false` only signs in people the app already has a user for.
- A person's first sign-in becomes the user with their address, or a new user. After that they are found by the provider's own id for them, so they stay the same user when their address changes.
- An answer that cannot be trusted, or a person who may not sign in, lands back on the sign-in page with a message, which the page shows from `flash`.

A provider is an object with an `id`, a `label`, and two functions:

```ts
import type { SignInProvider } from '@webstir-io/webstir-backend/sign-in';

const acme: SignInProvider = {
  id: 'acme',
  label: 'Acme',
  // Where to send the visitor, and what to keep in their session until they come back.
  async start({ redirectUri }) {
    return { location: authorizeUrl, keep: { state } };
  },
  // Who came back. Throw when the answer cannot be trusted.
  async finish({ url, redirectUri, kept }) {
    return { subject, email };
  },
};
```

`email` must be an address the provider vouches for, never one the person only claimed, since it decides which user they become. `setupProblem()` can name what the provider still needs in production, and the server refuses to start until it returns nothing.

A sign-in page written before providers needs two lines to show them: the `flash` messages outside the code step, and the links.

```html
<p role="status" data-each="flash as note" data-text="note.message"></p>
<p data-each="providers as provider">
    <a data-no-client-nav data-attr-href="provider.href">Sign in with <span data-text="provider.label"></span></a>
</p>
```

## An app with its own users table

Webstir makes `users (id, email, session_version, created_at)` before the app's migrations run, so they can reference `users (id)`. An app whose own migrations make `users`, with more columns such as a name or a status, says so, and Webstir leaves the table to them:

```ts
const signIn: SignInOptions = { usersTable: 'app', canSignIn };
```

Its table needs:

- `id` as text: Webstir gives a new user a UUID.
- `email`, unique, stored lowercase: Webstir looks addresses up lowercased.
- `session_version`, an integer that starts at 0 or 1, and `created_at`.
- A default, or room for NULL, in every other column, since a first sign-in inserts only these four. An invite-only app whose `canSignIn` turns unknown addresses away never has Webstir insert one.

## In production

The server refuses to start with sign-in unless it has:

- `SESSION_SECRET`
- `APP_URL`, the address people use, for the links in the email. It is never taken from the request.
- `EMAIL_URL` and `EMAIL_FROM` (see [Send Email](./email.md)), or an email transport the app sets, unless `emailCode` is off.
- Whatever each provider's `setupProblem()` names.
