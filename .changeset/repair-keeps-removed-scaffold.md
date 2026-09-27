---
"@webstir-io/webstir": patch
---

`webstir repair` now restores only the scaffold files a workspace still needs (the app shell, entries, and files something still imports or references) and no longer re-creates starter files a mature app removed.
