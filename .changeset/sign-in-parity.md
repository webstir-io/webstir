---
"@webstir-io/webstir-backend": patch
---

- Sign-in: someone already signed in who opens the sign-in page goes on to where they were headed; resending a code says a new one is on its way; a code typed with spaces or dashes, or pasted with the email's words around it, still works; a link that has expired sends the visitor back to sign in still headed where they were; using a different email goes back to the email step with the address filled in.
- Sign-in asks `canSignIn` again when a code or link is used, so someone turned away after the code was sent can't finish signing in.
- `usersTable: 'app'` in the sign-in options leaves the `users` table to an app whose own migrations make it, instead of Webstir making it first.
- SQLite transactions take the write lock when they begin, so a script writing to the same database file waits instead of failing.
