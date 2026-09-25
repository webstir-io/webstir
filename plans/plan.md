# Webstir Plan

> This is the repo planning checkpoint. Keep it short. If current code or active docs conflict with this file, current code wins.
>
> Active execution is indexed from [`PLAN.md`](../PLAN.md).

## Why Webstir exists

Webstir was built because its author did not want to use React, believes a better framework can be built without it, and wanted to learn how web frameworks work by building one.

## What better means

An app is HTML, CSS, and JavaScript. The server renders the page. Forms and links work before any script loads. Script enhances the page; it does not replace it.

## The path

- Keep making the framework better at this. The Sqware Logics portal is the real app that shows where the framework is still missing something or gets in the way.
- When the portal needs something the framework should have, such as auth, persistence, email, jobs, or storage, build it into Webstir and use it from there.
- Where the portal is built the React way, move it to the Webstir way.
- Write down what each of those teaches about how a framework should work.

## What better means next

In order. The first one is the framework's missing organ; the other two follow from it.

1. **Render server data into HTML.** Today a page's `load()` runs in the browser, request-time views inject JSON for the client to render, and the only server-HTML path is string concatenation with a hand-rolled escape. Build the render layer: the page's HTML file is the template, with a small HTML-native binding vocabulary; `load()` runs on the server; the document renders through the app shell; `setup()` only enhances. Client navigation already swaps `<main>`, so rendered pages are the fragment system. Forms re-render the same page with issues in the HTML.
2. **Deliver the batteries.** The backend package already has a database client, migrations, a jobs scheduler, and a SQLite session store, but `init full` ships none of them and `enable` does not know them. Make database, jobs, and durable sessions part of a full app. Lift a first-party email-code sign-in out of the portal; the current auth adapter is API bearer auth, not sign-in.
3. **Move plumbing out of the app.** A fresh full app is 35 files and the app owns the router, navigation, HMR, refresh, error, and feature scripts. Once the render layer lives in the package, that machinery moves with it. An app is pages, backend, and styles.

Not the priority: more CLI commands, inspect and repair, release tooling, the docs site, hardening. They are done enough.

## Immediate Next Step

Design and build the render layer, then move the portal onto it and let the portal decide what the binding vocabulary needs.
