# CSS Playbook (Minimal Webstir CSS)

Conventions for writing CSS in Webstir templates and SSG sites. The goal is to keep styling predictable and reduce "naming entropy" (lots of one-off classes and tokens).

## Principles
- Tokens-first: use CSS custom properties instead of ad-hoc `#hex`/`px` values.
- Tiny surface area: prefer a few layout building blocks + a few components over "utility everything".
- Deterministic cascade: use cascade layers so "where do I put this?" is obvious.
- Accessible defaults: focus rings, readable type, and sensible spacing are part of the system.

## The Contract (v0)
This reflects the current SSG template CSS system.

### File layout + layers
The SSG starter treats `src/frontend/app/app.css` as the single entrypoint:
- It declares a stable `@layer` order (so overrides are deterministic).
- It imports every stylesheet under `src/frontend/app/styles/**` (avoid nested imports inside those files).

Default layer order:
```css
@layer reset, tokens, base, layout, components, features, utilities, overrides;
```

Core system files (SSG template today):
- `src/frontend/app/styles/reset.css`
- `src/frontend/app/styles/tokens.css`
- `src/frontend/app/styles/base.css`
- `src/frontend/app/styles/layout.css`
- `src/frontend/app/styles/components/markdown.css`
- `src/frontend/app/styles/components/header.css`
- `src/frontend/app/styles/components/buttons.css`
- `src/frontend/app/styles/utilities.css`

Page-level CSS lives next to the page and uses `@layer overrides`:
- `src/frontend/pages/home/index.css`
- `src/frontend/pages/docs/index.css`

Feature CSS is opt-in:
- `src/frontend/app/styles/features/*.css` (added by enable commands)
- `app.css` imports feature files under the `features` layer

### Layout (classes)
Use a small fixed set of layout building blocks:
- `.ws-container` — centered max-width container (uses `--ws-container` and `--ws-container-pad`)
- `.ws-stack` — vertical layout with gap
- `.ws-cluster` — inline row with wrap + gap
- `.ws-grid` — responsive grid
- `.ws-sidebar` — content + sidebar layout (uses `--ws-sidebar` above `48rem`)

Tune layout building blocks with CSS variables instead of creating more classes:

```html
<div class="ws-stack" style="--ws-gap: var(--ws-space-4)">
  ...
</div>
```

### Components (`data-ui` + class-based)
SSG template components live in `@layer components`. Today that includes:
- `data-ui="btn"` (preferred) and legacy `.button` / `.button--primary` aliases
- `.ws-icon-button` (shared icon-only button chrome for menu + search triggers)
- `.ws-drawer-backdrop` (shared drawer overlay; uses `--ws-drawer-top`)
- `.app-header`, `.app-header__inner`, `.app-brand`, `.app-nav`, `.app-menu` (header + nav)
- `main > article` sizing for Markdown pages (`components/markdown.css`)

Button variants implemented today:
- `data-variant="solid|ghost"`
- `data-size="sm|lg"` (default is the un-set "md" size)
- `data-tone="accent"` (used by solid buttons)

Example:

```html
<a data-ui="btn" data-variant="solid" data-tone="accent" href="/about">About</a>
```

Prefer `aria-*` and native attributes for state:
- `aria-current="page"`, `aria-expanded="true|false"`, `disabled`, etc.

### Tokens
Define and customize design values via CSS variables (custom properties).

Common token categories:
- Color: `--ws-bg`, `--ws-fg`, `--ws-muted`, `--ws-border`, `--ws-accent`, `--ws-accent-hover`, `--ws-focus`
- Space: `--ws-space-1..8`, `--ws-gutter` (used by containers)
- Radius: `--ws-radius-1..3`
- Type: `--ws-font-sans`, `--ws-font-mono`

Layout sizing tokens (use tokens instead of hardcoded `px` in templates):
- `--ws-container` — default content container max width
- `--ws-shell-container` — wider “chrome” container (header + docs layout)
- `--ws-article` — prose width target (typically `ch`-based)
- `--ws-docs-sidebar`, `--ws-docs-toc` — docs shell column widths
- `--ws-container-pad` — side padding for `.ws-container` (defaults to `--ws-gutter`)

### Scoping
Docs-only rules must be scoped under a stable attribute:
- `[data-scope="docs"] { ... }`

This keeps "docs chrome" styles from leaking into app pages.

Docs layout specifics (SSG template):
- `.docs-layout` sets `--ws-container: var(--ws-shell-container)`
- `.docs-layout__inner` defines the grid using `--ws-docs-sidebar` and `--ws-docs-toc`
- Breakpoints: `53.75rem` collapses to one column; `68.75rem` hides the TOC
- Styles live in `src/frontend/pages/docs/index.css` under `@layer overrides`

## SSG Layout Patterns (Current Templates)

### App shell (header + main)
The shared header lives in `src/frontend/app/app.html` and `components/header.css`:

```html
<header class="app-header">
  <div class="app-header__inner ws-container">...</div>
</header>
```

`app-header__inner` widens the container to `--ws-shell-container`.

### Marketing/landing hero (home page)
The home page uses `.hero` + `.hero__inner` and is styled in `src/frontend/pages/home/index.css` under
`@layer overrides`.

### Docs layout (docs index + markdown)
Docs pages use a dedicated layout in `src/frontend/pages/docs/index.html`:

```html
<section class="docs-layout" data-scope="docs">
  <div class="ws-container docs-layout__inner">...</div>
</section>
```

`docs-layout` widens the container and drives the sidebar + TOC grid.

### Search UI styling
The search feature module can style its UI in one of two ways:
- Default: injects an inline `<style>` tag (works even if your template doesn’t ship search CSS).
- Preferred for SSG templates: styles live in CSS (`app/styles/features/search.css`) and JS is behavior-only.

When you run `webstir enable search`, Webstir opts you into CSS-based styling by:
- Adding `src/frontend/app/styles/features/search.css` to your app
- Adding `@import "./styles/features/search.css";` to `src/frontend/app/app.css`
- Setting `data-webstir-search-styles="css"` on the `<html>` element in `src/frontend/app/app.html`

To opt in manually, set:
```html
<html lang="en" data-webstir-search-styles="css">
```

## How To Make Changes (fast rules)

### I need a new spacing/color/etc.
Add or adjust a token, then use it everywhere. Don’t introduce raw values in page CSS unless it’s truly page-specific.

### I need a new reusable UI piece
Add a `data-ui` id and style it once in the component layer, then reuse it. Update the registry (keep the list of allowed ids short).

### I need a one-off tweak for a single page
Keep it in that page’s `index.css` under `@layer overrides`. If it repeats, promote it into a layout
building block/component.

## Current `data-ui` Registry (SSG Template)
- `btn`

Shared classes (SSG Template):
- `ws-icon-button`
- `ws-drawer-backdrop`

## Related
- Static Sites (SSG Preview) — [static-sites](./static-sites.md)
