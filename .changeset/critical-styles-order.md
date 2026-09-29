---
"@webstir-io/webstir-frontend": patch
---

Client navigation keeps Webstir's critical page styles before the app's stylesheet, where a full page load has them, so the app's own styles still win after navigating.
