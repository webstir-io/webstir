---
"@webstir-io/module-contract": minor
"@webstir-io/webstir-backend": minor
"@webstir-io/webstir-frontend": minor
"@webstir-io/webstir": minor
---

Webstir's plumbing moves out of the app and into the packages. The build adds to every page what the app used to carry: the live-update and reload clients in `watch`, the app bundle (enabled features, the error reporter in an app with a server, and `app.ts` only when the app has one), and the app's styles linked ahead of the page's own, with enabled features' stylesheets included. A feature flag alone turns a feature on, `webstir.enable.clientErrors` turns error reporting off or on, and `registerHotModule` comes from `@webstir-io/webstir-frontend/runtime`. `@webstir-io/webstir-frontend/tsconfig.json` and `@webstir-io/webstir-backend/tsconfig.json` hold the compiler settings, so a fresh full app is 14 files: no `hmr.js`, `refresh.js`, `error.ts`, `app.ts`, type stubs, `base.tsconfig.json`, `src/shared/` or `Errors.*.html`, and its server is one view and one form. `webstir repair` removes the copies older versions wrote where they are unchanged and notes any the app changed. The providers' unused `getScaffoldAssets` is removed from the module contract.
