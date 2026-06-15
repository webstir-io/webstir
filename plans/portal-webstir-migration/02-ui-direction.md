# Portal UI Direction

[Back to execmap](./EXECMAP.md)

## Goal

Define the visual direction for the Webstir portal screens before implementation.

## Tasks

- Identify the screens that matter for this migration.
- Keep design scope narrow and execution-oriented.
- Record the direction that should guide the Webstir page templates and CSS.

## Constraints

- This is a migration, not a full redesign.
- Preserve the current content hierarchy: home, tutorials, how-to, reference, explanations.
- Use existing Webstir SSG docs/search/content-nav primitives before adding bespoke UI.

## Direction

The portal should feel like a quiet technical product manual with a strong first impression, not a marketing landing page or a Docusaurus clone.

- Homepage: compact brand signal, direct product promise, two primary docs actions, and a small set of high-signal links.
- Docs shell: persistent left navigation on desktop, compact breadcrumb/search support, readable article width, minimal borders, and no card-within-card chrome.
- Theme: neutral light/dark system with Webstir blue as an accent, not a one-note blue surface.
- Density: documentation pages should scan quickly; homepage can have more spacing, but docs should stay utilitarian.
- Motion and decoration: none beyond ordinary hover/focus states.

## Exit Criteria

- Homepage and docs shell have a clear direction before implementation.
- No wireframe is needed because the existing SSG docs layout already defines the structural pattern.
