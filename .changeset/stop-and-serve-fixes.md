---
'@webstir-io/webstir-backend': patch
'@webstir-io/webstir': patch
---

Three fixes to how an app is stopped and served:

- `webstir-backend-deploy` exits with `1` when its app server dies, so a restart policy starts it again. It used to stay up, answering nothing.
- A published app no longer serves a view's page template as a file. `/pages/<page>/index.html` and spellings that reach it, such as `/clients%2f`, answer 404; the page is only ever rendered by its view, which decides who sees it.
- Stopping `webstir watch` always stops the app server it started. A stop that came while watch was still starting, or a hang-up (`SIGHUP`) from a closed terminal, used to end the command and leave the app server running. `webstir-backend-deploy` and the app server treat a hang-up as a stop too.
