---
'@webstir-io/webstir-backend': patch
'@webstir-io/webstir': patch
---

Three fixes to how an app is stopped and served:

- `webstir-backend-deploy` exits with `1` when its app server dies, so a restart policy starts it again. It used to stay up, answering nothing.
- A view's page template is no longer served as a file, by a published app or by `webstir watch`. `/pages/<page>/index.html`, its compressed copies, and spellings that reach them, such as `/clients%2f`, answer 404; the page is only ever rendered by its view, which decides who sees it.
- Stopping `webstir watch` or `webstir-backend-deploy` always stops the app server it started. A stop that came while either was still starting used to end the command and leave the app server running. A hang-up (`SIGHUP`) from a closed terminal now stops `webstir watch` the same way.
