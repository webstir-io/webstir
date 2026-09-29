---
"@webstir-io/module-contract": patch
"@webstir-io/webstir-backend": patch
"@webstir-io/webstir-frontend": patch
"@webstir-io/webstir": patch
---

Client navigation keeps the outgoing page's inlined styles until the next page replaces it, so a page whose small stylesheet is inlined no longer flashes unstyled while the next page's stylesheet loads.
