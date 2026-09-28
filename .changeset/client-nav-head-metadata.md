---
"@webstir-io/webstir-frontend": patch
---

Client-nav now brings the new page's title and metadata along (named `<meta>`, Open Graph, and canonical/alternate/prev/next links) instead of keeping the previous page's, and loads a page in full when its referrer policy differs from the one on screen.
