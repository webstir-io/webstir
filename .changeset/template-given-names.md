---
'@webstir-io/webstir-frontend': minor
'@webstir-io/webstir': minor
---

Templates can give a path or text a name. `data-with-<name>="path"` names a path on an element and inside it, so one partial serves different data: `<div data-include="field" data-with-field="form.email"></div>`. `data-with-<name>="'text'"` names text written in the template, which the build writes into the page. Both are settled at build time, checked against the view's schema like any other path, and leave the server's program format unchanged. A schema error on such a path now names the real path it read.
