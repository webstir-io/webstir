# Page Behaviors

A few controls need a little script to feel right, and work without it. Mark them in the page, the shell or a partial, and the build adds Webstir's behaviors to the app bundle:

```html
<!-- Submits when a field changes; the button is for visitors without script. -->
<form method="get" action="/proposals/" data-submit-on-change>
  <select name="status">…</select>
  <button type="submit" class="no-script">Show</button>
</form>

<!-- Closes on a click outside it, and on Escape. -->
<details data-dismissable>
  <summary>Export</summary>
  …
</details>

<!-- Opens and closes the menu it names. -->
<button data-menu-trigger aria-controls="menu" aria-expanded="false" data-menu-until="760px">Menu</button>
<nav id="menu">
  …
  <a href="/" data-menu-dismiss>Home</a>
</nav>
```

- **`data-submit-on-change`** on a form submits it when one of its fields changes.
- **`data-dismissable`** on a `<details>` closes it on a click outside, and on Escape.
- **`data-menu-trigger`** on a button opens and closes the element its `aria-controls` names. The button's `aria-expanded` and the menu's `data-open` say which, so CSS shows the menu only with `data-open`, and closing it makes it inert. Escape, a click on a `[data-menu-dismiss]`, or the window growing past `data-menu-until` close it.
- **`<html data-enhanced>`** is set while the behaviors run, so CSS can hide what only visitors without script need:

```css
[data-enhanced] .no-script { display: none; }
```

Escape closes the innermost open menu or details, and a page's own Escape handling runs only when nothing was open.
