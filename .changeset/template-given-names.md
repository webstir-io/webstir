---
'@webstir-io/webstir-frontend': minor
'@webstir-io/webstir': minor
---

Templates can give a path or text a name. `data-with-<name>="path"` names a path on an element and inside it, so one partial serves different data: `<div data-include="field" data-with-field="form.email"></div>`. `data-with-<name>="'text'"` names text written in the template, which the build writes into the page. Both are settled at build time, checked against the view's schema like any other path, and leave the server's program format unchanged. A schema error on such a path names the real path it read. A page that gave names and has nothing left to render but a form's CSRF field is written as what it compiled to.
