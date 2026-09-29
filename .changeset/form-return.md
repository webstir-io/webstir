---
"@webstir-io/module-contract": patch
"@webstir-io/webstir-backend": patch
"@webstir-io/webstir-frontend": patch
"@webstir-io/webstir": patch
---

A failed form goes back to the right form on the right page, whatever failed it:
- Every POST form carries the page it was rendered on (`_webstir_page`), so a failure returns there without a Referer, or after an earlier failed post.
- A form that is one of many on a page names its state with `_webstir_form`, and every failure, the runtime's token check included, goes there.
- A posted file is kept in the form's values by its name, so a page can ask for it again. An app that spreads all of a form's values into a write now sees that name too.
- A signed-out request for a page-shaped GET route returns to that address after signing in.
