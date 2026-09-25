# Render layer: binding vocabulary

Designed against four Sqware Logics portal pages. The clients page (`src/frontend/pages/clients/`) is 168 lines of HTML and 187 of TypeScript. The client detail page (`src/frontend/pages/client/`) is 196 and 347, with two dialogs and four actions. The proposal record page (`src/frontend/pages/proposal-viewer/`) is 274 and 950. The proposal reader (`src/frontend/pages/proposal/`) is 398 lines of script plus a 690-line block renderer and a 960-line conversation component shared with the record page. All of them fetch JSON in the browser and build markup with `document.createElement`.

## Principles

- The page's `index.html` is the template. It stays valid HTML that opens in a browser and reads as a finished page with placeholder content.
- Bindings are attributes. No braces, no expressions, no filters, no calls. A binding is a dot path into the view's data, optionally negated with `!`.
- Logic lives in the loader, in TypeScript, on the server. If the HTML needs a value shaped a certain way, the loader shapes it.
- State goes into semantic attributes (`aria-current`, `open`, `disabled`, `hidden`, `data-*`), and CSS selects on them. There is no construct for toggling a class.
- Everything is escaped. There is no way to inject raw HTML from a binding.
- A binding that names a path the view's data schema does not have fails the build with the file and line.
- One URL per thing. A page that today needs a dialog with three modes is usually two pages.

## The vocabulary

Five attributes.

| Attribute | On | Meaning |
| --- | --- | --- |
| `data-text="path"` | any element, including `<title>` | Replace the element's content with the escaped value. Existing content is design-time placeholder. |
| `data-attr-<name>="path"` | any element | Set attribute `<name>` to the escaped value. A boolean adds or removes the attribute. `null` or `undefined` removes it. |
| `data-if="path"` / `data-if="!path"` | any element | Remove the element from the output when the value is falsy (or truthy, with `!`). Removed, not hidden. |
| `data-each="items as item"` | the repeating element | Repeat this element once per array entry with `item` in scope. Zero entries removes it. Nests. |
| `data-include="name"` | any element | Replace the element's content with `src/frontend/app/partials/<name>.html` at build time. The partial binds against the page's data. |

Falsy: `null`, `undefined`, `false`, `""`, `0`, and an empty array.

Binding attributes are stripped from the rendered HTML. The browser receives plain markup.

`data-each` over an array of strings binds the name to the string itself, so `data-text="cell"` reads it. Inside a nested `data-each`, outer names stay in scope; an inner name shadows an outer one. There is no switch: a discriminated union is shaped by the loader into one populated key per variant, and the HTML has one sibling per variant guarded by `data-if`.

There is no text interpolation. A sentence with values in it wraps each value in an element: `Remove <strong data-text="member.title"></strong> from <strong data-text="client.name"></strong>?` That is better HTML anyway.

Two things the framework supplies without an attribute:

- Every `<form method="post">` in a rendered page receives a hidden `_csrf` input from the session. The page author never writes it.
- Every view's data includes `flash`, an array of `{ level, message }` from the session flash that actions publish. Pages render it or not.

## Where a view names its page

A view definition gains `page`, the directory under `src/frontend/pages/` whose `index.html` it renders. Today the runtime resolves the document from the request path, which cannot work for `/clients/:slug/`. Static pages that no view claims keep directory routing as they have it now.

## The clients page

`src/frontend/pages/clients/index.html`, in full apart from the `<head>`.

```html
<main>
  <div class="portal-shell">
    <aside class="portal-sidebar" data-include="sidebar"></aside>

    <section class="portal-content">
      <header class="portal-page-header">
        <h1 class="slds-page-title">Clients</h1>
      </header>

      <section aria-label="Clients">
        <div class="client-list" data-if="clients">
          <a class="client-row" data-each="clients as client" data-attr-href="client.href">
            <span class="client-row-name" data-text="client.name">Acme Logistics</span>
            <span class="client-row-affordance" aria-hidden="true">
              <svg class="slds-icon slds-icon--sm" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
            </span>
          </a>
        </div>

        <section class="slds-empty" data-if="!clients" aria-labelledby="clients-empty-title">
          <h2 class="slds-record-title" id="clients-empty-title">No clients yet</h2>
          <p>Add a client to manage their members.</p>
        </section>
      </section>

      <details class="management-panel" id="new-client" data-attr-open="create.open">
        <summary class="management-text-action">New client</summary>
        <form class="slds-form" method="post" action="/clients/">
          <p class="slds-error" role="alert" data-if="create.issues.form" data-text="create.issues.form">Something went wrong.</p>
          <label class="slds-field">
            <span class="slds-label">Client name</span>
            <input class="slds-input" name="name" type="text" minlength="2" maxlength="120" autocomplete="organization" required
                   data-attr-value="create.values.name" />
            <span class="slds-error" data-if="create.issues.name" data-text="create.issues.name">Enter a name.</span>
          </label>
          <label class="slds-field">
            <span class="slds-label">URL name</span>
            <input class="portal-mono-input slds-input" name="slug" type="text" maxlength="64" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" autocomplete="off" required
                   data-attr-value="create.values.slug" />
            <span class="slds-help">Lowercase letters, numbers and dashes. Used in links to this client.</span>
            <span class="slds-error" data-if="create.issues.slug" data-text="create.issues.slug">Use lowercase letters, numbers and dashes.</span>
          </label>
          <footer class="slds-form-footer">
            <button class="slds-button" type="submit">Create client</button>
          </footer>
        </form>
      </details>
    </section>
  </div>
</main>
```

What changed and why:

- The `Loading…` paragraph, the `hidden` toggles, and the `aria-busy` dance are gone. The server renders the finished state.
- The permission gate and the signed-out redirect are loader decisions. A non-staff user never receives this page; they receive a 303.
- The `<dialog>` became a `<details>`. It works with no script, it is keyboard accessible, and `data-attr-open="create.open"` reopens it when a submission comes back with issues.
- The form posts to `/clients/`. Success is a 303 back. Failure re-renders this page with `create.values` and `create.issues` filled. No JSON endpoint exists for the feature.
- Every row is an anchor. Client navigation already swaps `<main>` on anchor clicks.

## The sidebar partial

`src/frontend/app/partials/sidebar.html`. Four pages carry this markup today with the active item hardcoded per page. The partial is static markup with bound state; the icons stay in the HTML because nothing repeats.

```html
<div class="portal-sidebar-header">
  <a class="portal-brand" href="/" aria-label="Sqware Logics Client Portal">
    <span class="portal-brand-mark" aria-hidden="true"></span>
    <span class="portal-brand-text">Client Portal</span>
  </a>
  <!-- mobile menu trigger and drawer markup unchanged -->
</div>

<nav class="portal-navigation slds-shell-nav" aria-label="Client portal">
  <a class="portal-navigation-item slds-shell-nav-item" href="/" data-attr-aria-current="nav.proposals">
    <svg class="portal-shell-icon slds-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M8 13h8M8 17h6" /></svg>
    Proposals
  </a>
  <a class="portal-navigation-item slds-shell-nav-item" href="/clients/" data-if="nav.clients" data-attr-aria-current="nav.clients.current">
    <svg class="portal-shell-icon slds-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 10h2M13 10h2M9 14h2M13 14h2M10 21v-3h4v3" /></svg>
    Clients
  </a>
</nav>

<div class="portal-theme" data-theme-switch></div>

<form method="post" action="/sign-out/">
  <button class="portal-sign-out slds-shell-nav-item" type="submit">Sign out</button>
</form>
```

The loader supplies `nav: { proposals: 'page' | null, clients: { current: 'page' | null } | null }`. The `slds-shell-nav-item--active` class is dropped; the stylesheet selects `[aria-current="page"]` instead. Sign out is a form, so it works with no script and gets its CSRF input for free. The Clients link only renders for staff, which today is decided by a JS check after load.

## The client detail page

Today: one URL, a member list, and a dialog that is "Add member", "Edit member", and "Resend invitation" depending on state, plus a second dialog to confirm removal. That is the SPA telling you to keep everything on one URL. The multi-page answer is two pages: the client, and one member of the client. Client navigation makes the second feel like a panel.

### `/clients/:slug/`

`src/frontend/pages/client/index.html`, view `clientPage` with `page: 'client'`.

```html
<head>
  <title data-text="title">Client · Sqware Logics</title>
  <link rel="stylesheet" href="index.css" />
  <script type="module" src="index.js" data-webstir-load></script>
</head>
<main>
  <div class="portal-shell">
    <aside class="portal-sidebar" data-include="sidebar"></aside>

    <section class="portal-content">
      <header class="portal-page-header">
        <nav aria-label="Breadcrumb"><a href="/clients/">Clients</a></nav>
        <h1 class="slds-page-title" data-text="client.name">Client</h1>
      </header>

      <p class="proposal-status" role="status" data-each="flash as note" data-attr-data-tone="note.level" data-text="note.message"></p>

      <section class="client-panel slds-panel" aria-labelledby="members-title">
        <header class="client-panel-header">
          <h2 class="slds-section-title" id="members-title">Members</h2>
        </header>

        <ol class="client-list" data-if="members">
          <li class="client-item client-member-item" data-each="members as member">
            <a class="client-member-row" data-attr-href="member.href" data-attr-aria-label="member.editLabel">
              <span class="client-item-main">
                <span class="client-item-title" data-text="member.title">Jordan Lee</span>
                <span class="client-item-meta" data-if="member.meta" data-text="member.meta">jordan@example.com</span>
              </span>
              <span class="client-item-actions">
                <span class="slds-badge slds-badge--warning" data-if="member.disabled">Disabled</span>
                <svg class="slds-icon slds-icon--sm" viewBox="0 0 24 24" aria-hidden="true"><path d="m16 3 5 5M4 20l4-1L21 6a2 2 0 0 0-4-4L4 15l-1 6Z" /></svg>
              </span>
            </a>
          </li>
        </ol>

        <div class="client-empty" data-if="!members">
          <h3 class="client-empty-title">No members yet</h3>
          <p class="client-empty-copy">Nobody at <strong data-text="client.name">this client</strong> can sign in until you add them.</p>
        </div>

        <details class="management-panel" id="add-member" data-attr-open="add.open">
          <summary class="management-text-action">Add member</summary>
          <form class="slds-form" method="post" data-attr-action="add.action">
            <p class="portal-dialog-copy">We’ll email them an invitation to view proposals shared with <strong data-text="client.name">this client</strong>.</p>
            <p class="slds-error" role="alert" data-if="add.issues.form" data-text="add.issues.form"></p>
            <label class="slds-field">
              <span class="slds-label">Work email</span>
              <input class="slds-input" name="email" type="email" autocomplete="off" required data-attr-value="add.values.email" />
              <span class="slds-error" data-if="add.issues.email" data-text="add.issues.email"></span>
            </label>
            <label class="slds-field">
              <span class="slds-label">Name <span class="client-field-optional">(optional)</span></span>
              <input class="slds-input" name="name" type="text" maxlength="120" autocomplete="off" data-attr-value="add.values.name" />
            </label>
            <footer class="slds-form-footer">
              <button class="slds-button" type="submit">Add member</button>
            </footer>
          </form>
        </details>
      </section>
    </section>
  </div>
</main>
```

The loader shapes each member for the markup: `title` is the display name or the email, `meta` is the email only when there is a display name, `disabled` is a boolean, `href` is the member page, `editLabel` is "Edit Jordan Lee". The row is one anchor, so the whole row is the edit affordance. The legacy `?id=` URL and the canonical-slug redirect that `index.ts` performs today are a 301 from the loader.

### `/clients/:slug/members/:userId/`

`src/frontend/pages/member/index.html`, view `memberPage` with `page: 'member'`. Edit, resend, and remove are three forms on one small page. Remove is a `<details>` that holds the confirmation, so it cannot be submitted by accident and needs no script.

```html
<head>
  <title data-text="title">Member · Sqware Logics</title>
  <link rel="stylesheet" href="index.css" />
  <script type="module" src="index.js" data-webstir-load></script>
</head>
<main>
  <div class="portal-shell">
    <aside class="portal-sidebar" data-include="sidebar"></aside>

    <section class="portal-content">
      <header class="portal-page-header">
        <nav aria-label="Breadcrumb">
          <a href="/clients/">Clients</a> / <a data-attr-href="client.href" data-text="client.name">Client</a>
        </nav>
        <h1 class="slds-page-title" data-text="member.title">Member</h1>
        <span class="slds-badge slds-badge--warning" data-if="member.disabled">Disabled</span>
      </header>

      <p class="proposal-status" role="status" data-each="flash as note" data-attr-data-tone="note.level" data-text="note.message"></p>

      <form class="slds-form" method="post" data-attr-action="edit.action">
        <p class="slds-error" role="alert" data-if="edit.issues.form" data-text="edit.issues.form"></p>
        <label class="slds-field">
          <span class="slds-label">Work email</span>
          <input class="slds-input" name="email" type="email" required data-attr-value="edit.values.email" />
          <span class="slds-error" data-if="edit.issues.email" data-text="edit.issues.email"></span>
        </label>
        <label class="slds-field">
          <span class="slds-label">Name <span class="client-field-optional">(optional)</span></span>
          <input class="slds-input" name="name" type="text" maxlength="120" data-attr-value="edit.values.name" />
        </label>
        <footer class="slds-form-footer">
          <button class="slds-button" type="submit">Save</button>
        </footer>
      </form>

      <form method="post" data-attr-action="invite.action" data-if="invite">
        <button class="management-text-action" type="submit">
          <svg class="slds-icon slds-icon--sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18v14H3zM3 5l9 7 9-7" /></svg>
          Resend invitation
        </button>
      </form>

      <details class="management-panel management-panel--danger">
        <summary class="management-text-action management-text-action--danger">Remove member</summary>
        <form method="post" data-attr-action="remove.action">
          <p class="portal-dialog-copy">
            Remove <strong data-text="member.who">Jordan Lee (jordan@example.com)</strong> from <strong data-text="client.name">this client</strong>?
            They will lose access to its shared proposals. You can add them again later.
          </p>
          <footer class="slds-form-footer">
            <a class="slds-button slds-button--secondary" data-attr-href="client.href">Cancel</a>
            <button class="slds-button slds-button--danger" type="submit">Remove</button>
          </footer>
        </form>
      </details>
    </section>
  </div>
</main>
```

`invite` is `null` unless the member is active, so the resend form only renders when today's script would have shown the button. After any of the three actions the server publishes a flash and redirects: save and resend come back to this page, remove goes to the client page. "Invitation sent to jordan@example.com." and "Member saved, but the invitation could not be sent." are flash messages, not client state.

## The proposal record and reader

Two pages today. The record page (`src/frontend/pages/proposal-viewer/`, 950 lines of script) is the staff view: versions, sharing, conversations, a feedback digest, and a new-version upload. The reader (`src/frontend/pages/proposal/`, 398 lines) renders the document for clients and staff, with a 690-line block renderer and a 960-line conversation component shared between the two. Paths as today: the reader at `/clients/:client/proposals/:slug/` with an optional `/v:label`, the record at `.../manage`.

The first finding settles the open question about trusted HTML. The proposal document is structured data, not markup: `ProposalDocument` is a summary, an optional brief, and sections of typed blocks (`prose`, `columns`, `cards`, `callout`, `steps`, `workflow`, `table`, `list`, `links`). Prose is `paragraphs: string[]`, plain text. Nothing in the portal needs to inject HTML from data, so the vocabulary keeps no construct for it.

### Rendering a variant

Blocks are a discriminated union. The vocabulary has no switch. The loader turns each block into an object with one populated key, and the HTML has one sibling per kind guarded by `data-if`. The build validates every path against the schema, so a kind the HTML forgets is a build error rather than a blank.

```ts
// loader, per block
{ prose: block.type === 'prose' ? { heading: block.heading ?? null, paragraphs: block.paragraphs } : null,
  cards: block.type === 'cards' ? { items: block.items } : null,
  table: block.type === 'table' ? { columns: block.columns, rows: block.rows } : null,
  /* six more */ }
```

### The reader

`src/frontend/pages/proposal/index.html`, the document region. The section body is a `<details>` rather than a button with `aria-expanded`, so sections expand with no script and `data-attr-open` honors the document's `detailsOpen`.

```html
<nav class="structured-proposal-navigation" aria-label="Sections">
  <ol>
    <li data-each="sections as section">
      <a data-attr-href="section.href" data-text="section.title">Scope</a>
      <span class="structured-proposal-navigation-count" data-if="section.openThreads" data-text="section.openThreads">2</span>
    </li>
  </ol>
</nav>

<article class="structured-proposal">
  <header class="structured-proposal-head">
    <h1 data-text="version.title">Proposal title</h1>
    <p class="structured-proposal-summary" data-text="document.summary">One-line summary.</p>
    <a class="slds-button slds-button--secondary" data-attr-href="pdf.href" data-if="pdf">Download PDF</a>
  </header>

  <section class="structured-proposal-brief" data-if="brief">
    <dl class="structured-proposal-brief-facts">
      <div data-each="brief.facts as fact">
        <dt data-text="fact.label">Timeline</dt>
        <dd data-text="fact.value">12 weeks</dd>
      </div>
    </dl>
    <aside class="structured-proposal-decision" data-if="brief.decision">
      <p class="structured-proposal-decision-label" data-if="brief.decision.label" data-text="brief.decision.label">Decision</p>
      <p data-text="brief.decision.text">Approve phase one.</p>
    </aside>
  </section>

  <section class="structured-proposal-section" data-each="sections as section" data-attr-id="section.id">
    <div class="structured-proposal-section-head">
      <h2>
        <span class="structured-proposal-section-number" aria-hidden="true" data-text="section.number">01</span>
        <span class="structured-proposal-section-title" data-text="section.title">Scope</span>
      </h2>
      <a class="structured-proposal-section-discuss" data-attr-href="section.discussHref" data-attr-aria-label="section.discussLabel">
        <svg class="slds-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-8 8H8l-4 3v-6.5A8 8 0 0 1 5 5a8 8 0 0 1 8-1h0a8 8 0 0 1 8 8Z" /></svg>
        <span data-if="section.openThreads" data-text="section.openThreads">2</span>
      </a>
      <p class="structured-proposal-section-summary" data-text="section.summary">What this section covers.</p>
    </div>

    <details class="structured-proposal-section-body" data-if="section.hasDetails" data-attr-open="section.open">
      <summary class="structured-proposal-section-toggle" data-text="section.detailsLabel">View details</summary>

      <div class="structured-proposal-highlights" data-if="section.highlights">
        <section class="structured-proposal-card" data-each="section.highlights as card">
          <p class="structured-proposal-card-eyebrow" data-if="card.eyebrow" data-text="card.eyebrow">Outcome</p>
          <h3 data-text="card.title">Faster quotes</h3>
          <p data-if="card.text" data-text="card.text">Detail.</p>
          <ul data-if="card.items"><li data-each="card.items as item" data-text="item">Point</li></ul>
        </section>
      </div>

      <div data-each="section.blocks as block">
        <div class="structured-proposal-prose" data-if="block.prose">
          <h3 data-if="block.prose.heading" data-text="block.prose.heading">Heading</h3>
          <p data-each="block.prose.paragraphs as paragraph" data-text="paragraph">Paragraph.</p>
        </div>

        <div class="structured-proposal-cards" data-if="block.cards">
          <section class="structured-proposal-card" data-each="block.cards.items as card">
            <p class="structured-proposal-card-eyebrow" data-if="card.eyebrow" data-text="card.eyebrow">Eyebrow</p>
            <h3 data-text="card.title">Title</h3>
            <p data-if="card.text" data-text="card.text">Text.</p>
            <ul data-if="card.items"><li data-each="card.items as item" data-text="item">Point</li></ul>
          </section>
        </div>

        <aside class="structured-proposal-callout" data-if="block.callout">
          <p class="structured-proposal-callout-label" data-if="block.callout.label" data-text="block.callout.label">Note</p>
          <p data-text="block.callout.text">Callout text.</p>
        </aside>

        <div class="structured-proposal-table-wrap" data-if="block.table">
          <table>
            <thead><tr><th data-each="block.table.columns as column" data-text="column">Column</th></tr></thead>
            <tbody>
              <tr data-each="block.table.rows as row"><td data-each="row as cell" data-text="cell">Cell</td></tr>
            </tbody>
          </table>
        </div>

        <div data-if="block.list">
          <h3 data-if="block.list.heading" data-text="block.list.heading">Heading</h3>
          <ol data-if="block.list.ordered"><li data-each="block.list.items as item" data-text="item">Step</li></ol>
          <ul data-if="!block.list.ordered"><li data-each="block.list.items as item" data-text="item">Point</li></ul>
        </div>

        <!-- columns, steps, workflow, links follow the same shape -->
      </div>
    </details>
  </section>
</article>
```

Three things this page adds to the vocabulary's semantics, not its syntax:

- **Scalar iteration.** `data-each="row as cell"` over `string[]` binds `cell` to the string itself, so `data-text="cell"` reads it. Same for paragraphs and list items.
- **Nesting scope.** Inside `section.blocks as block`, `section` is still in scope. An inner name shadows an outer one.
- **Cards appear twice** (highlights and the `cards` block) with identical markup. That duplication is the cost of having no component construct. It is accepted for now: eight lines, and the alternative is a second templating concept. If a third copy shows up, revisit.

The section rail's scroll-spy (`watchHead`) stays a small enhancement. The comment count badge is server data. The PDF is a link to the existing render route with a `content-disposition`.

### The record page

`.../manage/`, view `proposalRecordPage`. Today one URL with three hash-switched panels. Three URLs instead: `.../manage/`, `.../manage/conversations/`, `.../manage/versions/`. One view, one loader, a `view` param that decides which panel renders; the tab links bind `aria-current`. Client navigation makes switching instant, and each panel is bookmarkable, which the hash version only pretended to be.

```html
<header class="record-header">
  <nav class="portal-breadcrumb" aria-label="Breadcrumb"><a href="/">Proposals</a></nav>
  <h1 class="slds-page-title" data-text="proposal.title">Proposal</h1>
  <p class="record-client-name" data-text="proposal.clientName">Client</p>
  <p class="record-state">
    <span class="record-state-item" data-each="state as item" data-attr-data-tone="item.tone" data-text="item.text">Not shared</span>
  </p>
  <details class="portal-action-menu">
    <summary class="portal-action-trigger" aria-label="Proposal actions">…</summary>
    <div class="portal-action-panel">
      <button class="portal-action-item" type="button" data-copy-link data-attr-data-href="proposal.clientHref">Copy client link</button>
      <a class="portal-action-item" data-attr-href="digest.href">Feedback digest</a>
      <form method="post" data-attr-action="unshare.action" data-if="unshare">
        <button class="portal-action-item portal-action-item--danger" type="submit">Unshare proposal</button>
      </form>
    </div>
  </details>
</header>

<nav class="record-view-tabs" aria-label="Proposal views">
  <a class="record-view-tab" data-attr-href="tabs.proposal.href" data-attr-aria-current="tabs.proposal.current">Proposal</a>
  <a class="record-view-tab" data-attr-href="tabs.conversations.href" data-attr-aria-current="tabs.conversations.current">Conversations</a>
  <a class="record-view-tab" data-attr-href="tabs.versions.href" data-attr-aria-current="tabs.versions.current">Versions</a>
</nav>

<section class="record-versions" data-if="panel.proposal">
  <h2 class="record-section-title">Current version</h2>
  <div class="record-empty" data-if="!latest">
    <h3>No versions yet</h3>
    <p>Upload a proposal file to create v1. Nothing is visible to <strong data-text="proposal.clientName">the client</strong> until you share it.</p>
  </div>
  <div class="version-item" data-if="latest" data-attr-data-shared="latest.shared">
    <p class="version-label">
      <span class="version-number" data-text="latest.label">v3</span>
      <span class="version-flag" data-tone="success" data-if="latest.shared"><span data-text="proposal.clientName">Client</span> sees this</span>
      <time data-attr-datetime="latest.createdAt" data-text="latest.createdOn">Sep 12, 2026</time>
    </p>
    <div class="version-actions">
      <a class="slds-button slds-button--secondary slds-button--compact" data-attr-href="latest.previewHref">Preview</a>
      <a class="slds-button slds-button--secondary slds-button--compact" data-attr-href="latest.downloadHref">Download</a>
      <details class="management-panel" data-if="!latest.shared">
        <summary class="slds-button slds-button--compact">Share with client</summary>
        <form method="post" data-attr-action="latest.shareAction">
          <p>Share <strong data-text="latest.label">v3</strong> with <strong data-text="proposal.clientName">the client</strong>? They will be emailed. Earlier shared versions stay visible in their history.</p>
          <button class="slds-button" type="submit">Share</button>
        </form>
      </details>
    </div>
  </div>

  <details class="management-panel" id="new-version" data-attr-open="create.open">
    <summary class="management-text-action">New version</summary>
    <form method="post" enctype="multipart/form-data" data-attr-action="create.action">
      <p class="portal-dialog-copy">Creates the next version. It stays private until you share it.</p>
      <p class="slds-error" role="alert" data-if="create.issues.form" data-text="create.issues.form"></p>
      <label class="slds-field">
        <span class="slds-label">Title</span>
        <input class="slds-input" name="title" type="text" minlength="3" maxlength="120" required data-attr-value="create.values.title" />
        <span class="slds-error" data-if="create.issues.title" data-text="create.issues.title"></span>
      </label>
      <label class="slds-field">
        <span class="slds-label">Summary</span>
        <textarea class="slds-input" name="summary" maxlength="1000" required data-text="create.values.summary"></textarea>
      </label>
      <label class="slds-field">
        <span class="slds-label">Proposal file</span>
        <input class="portal-file-input" name="document" type="file" accept=".json,application/json" data-attr-required="create.fileRequired" />
        <span class="slds-help" data-text="create.fileHelp">Choose a proposal file to replace the content. Leave it empty to change only the title or summary.</span>
        <span class="slds-error" data-if="create.issues.document" data-text="create.issues.document"></span>
      </label>
      <fieldset class="version-addresses" data-if="create.openThreads">
        <legend class="slds-label">This version addresses</legend>
        <p class="version-addresses-copy">Tick the conversations this version answers. They are resolved and marked with the version.</p>
        <label class="version-address" data-each="create.openThreads as thread">
          <input type="checkbox" name="addresses" data-attr-value="thread.id" />
          <span data-text="thread.sectionTitle">Scope</span>: <span data-text="thread.excerpt">Can we start in Q1?</span>
        </label>
      </fieldset>
      <footer class="slds-form-footer">
        <button class="slds-button" type="submit">Create version</button>
      </footer>
    </form>
  </details>
</section>

<section class="record-history" data-if="panel.versions">
  <h2>Versions</h2>
  <ol class="version-list">
    <li class="version-item" data-each="history as version">
      <a class="version-row-link" data-attr-href="version.previewHref">
        <span class="version-number" data-text="version.label">v2</span>
        <span class="version-flag slds-badge" data-if="version.draft">Draft</span>
        <span class="version-title" data-if="version.title" data-text="version.title">Earlier title</span>
        <time data-attr-datetime="version.createdAt" data-text="version.createdOn">Aug 30, 2026</time>
      </a>
    </li>
  </ol>
  <a class="slds-button slds-button--secondary" data-if="history.more" data-attr-href="history.more.href">Show older versions</a>
</section>
```

What changed:

- **Share and unshare** are forms inside a `<details>` confirmation. Both were dialogs.
- **New version** is a multipart form. Today the script reads the file in the browser, parses it, merges it with the previous document, and posts JSON. The server does that now: the loader prefills title and summary from the latest version, and the action reads the uploaded file or falls back to the latest document. The "addresses" checklist is `data-each` over open threads; the action resolves the ticked ones.
- **Digest** is a link to a route that returns `text/markdown` with a `content-disposition`, taking `?scope=` from a small `<form method="get">` on the conversations panel. The dialog, the `<pre>`, and the copy button are gone. Copying is an enhancement if anyone misses it.
- **Show older versions** is a link with `?history=20`; the loader paginates. The script's counter is gone.
- **Copy client link** is the one thing that needs script: the clipboard. Eight lines keyed on `data-copy-link`.

### Conversations

Both pages render threads with the same partial, `data-include="conversation"`, bound to `threads`. Every action is a form and a 303 back to the same panel with the thread's id in the fragment.

```html
<form class="conversation-compose" method="post" data-attr-action="compose.action">
  <label>Section
    <select name="section">
      <option value="__general__">General</option>
      <option data-each="sections as section" data-attr-value="section.id" data-text="section.title">Scope</option>
    </select>
  </label>
  <fieldset data-if="compose.canChooseVisibility">
    <legend>Visibility</legend>
    <label><input type="radio" name="visibility" value="internal" checked /> Internal</label>
    <label><input type="radio" name="visibility" value="shared" /> With <span data-text="proposal.clientName">the client</span></label>
  </fieldset>
  <textarea class="conversation-input" name="body" required maxlength="4000" data-text="compose.draft"></textarea>
  <button class="conversation-submit" type="submit">Post</button>
</form>

<article class="conversation-thread" data-each="threads as thread" data-attr-id="thread.id"
         data-attr-data-visibility="thread.visibility" data-attr-data-resolved="thread.resolved" data-attr-data-unread="thread.unread">
  <p class="conversation-tags">
    <span class="conversation-tag" data-attr-data-kind="thread.visibility" data-text="thread.visibilityLabel">Internal</span>
    <span class="conversation-tag" data-kind="resolved" data-if="thread.resolvedLabel" data-text="thread.resolvedLabel">Resolved in v3</span>
    <span class="conversation-version" data-text="thread.versionLabel">v2</span>
    <a class="conversation-context-link" data-attr-href="thread.sectionHref" data-text="thread.sectionTitle">Scope</a>
  </p>

  <div class="conversation-comment" data-each="thread.messages as message" data-attr-id="message.id">
    <span class="conversation-avatar" aria-hidden="true" data-attr-data-role="message.authorRole" data-text="message.initials">JL</span>
    <div class="conversation-comment-content">
      <div class="conversation-meta">
        <span class="conversation-author" data-text="message.authorName">Jordan Lee</span>
        <time class="conversation-date" data-attr-datetime="message.createdAt" data-text="message.when">Today</time>
        <span class="conversation-fresh" data-kind="new" data-if="message.unread">New</span>
        <span class="conversation-edited" data-if="message.edited">Edited</span>
      </div>
      <p class="conversation-body conversation-deleted" data-if="message.deleted">Original message deleted</p>
      <p class="conversation-body" data-if="!message.deleted" data-text="message.body">Can we start in Q1?</p>

      <details class="conversation-message-menu portal-action-menu" data-if="message.mine">
        <summary class="portal-action-trigger" aria-label="Message actions">…</summary>
        <div class="portal-action-panel">
          <details>
            <summary class="portal-action-item">Edit</summary>
            <form method="post" data-attr-action="message.editAction">
              <textarea class="conversation-input" name="body" required maxlength="4000" data-text="message.body"></textarea>
              <button class="conversation-submit" type="submit">Save</button>
            </form>
          </details>
          <details>
            <summary class="portal-action-item portal-action-item--danger">Delete</summary>
            <form method="post" data-attr-action="message.deleteAction">
              <p>Delete this message? Replies stay.</p>
              <button class="slds-button slds-button--danger" type="submit">Delete</button>
            </form>
          </details>
        </div>
      </details>
    </div>
  </div>

  <div class="conversation-thread-actions">
    <details class="conversation-reply">
      <summary class="conversation-reply-toggle">Reply</summary>
      <form method="post" data-attr-action="thread.replyAction">
        <textarea class="conversation-input" name="body" required maxlength="4000"></textarea>
        <button class="conversation-submit" type="submit">Post reply</button>
      </form>
    </details>
    <form method="post" data-attr-action="thread.resolveAction" data-if="thread.resolveAction">
      <button class="conversation-reply-toggle" type="submit" data-text="thread.resolveLabel">Resolve</button>
    </form>
  </div>
</article>
```

Two decisions here:

- **Seen is recorded on render.** Today a 4-second timer posts `/comments/seen` when the conversations tab is visible. With a real URL for the conversations panel, opening it is the event. The loader records it. That is a side effect in a GET, and it is the right one: "opened the conversation" is what the request means. The timer was compensating for a URL that never changed.
- **Message text prefills a `<textarea>` with `data-text`.** A textarea's content is its value, so no new construct.

Counts per section (open, unread) are loader data. The `initials`, `when` ("Today" or a date), and `resolvedLabel` strings are shaped in the loader, as the principles say.

### What is left in the scripts

Reader: the section rail scroll-spy. Record: copy to clipboard. Conversations: nothing. Between them the 950-line record script, the 398-line reader script, the 690-line block renderer, and the 960-line conversation component are replaced by two partials, one block of loader code, and roughly thirty lines of enhancement.

### Framework gaps these pages found

1. **Multipart forms are declared but not parsed.** The route contract allows `multipart/form-data` at [core.ts:62](../../packages/tooling/webstir-backend/src/runtime/core.ts:62), and nothing in the runtime reads it. The new-version upload needs it. Files must be bounded by the existing body limit and handed to the handler as `File` values.
2. **Downloads from routes.** Digest (`text/markdown`), version source (`application/json`), and PDF need `content-disposition` on a route result. `RouteHandlerResult` already carries `headers` and an arbitrary `body`, so this is a recipe, not a change, but it should be documented as the way to serve a file.
3. **Loader side effects.** Recording seen on render needs the runtime to commit session and store writes made during a view's `load`. Today `load` is treated as read-only. Allow it, and say so in the contract.

## The server side

Sketch. The exact runtime API is the next design; the shapes below are what the HTML needs.

```ts
// src/backend/clients/pages.ts
const clientsPage = defineView({
  definition: { name: 'clientsPage', path: '/clients/', page: 'clients', session: { mode: 'required' } },
  data: z.object({ nav: navSchema, flash: flashSchema, clients: z.array(clientRow), create: formState(createFields) }),
  async load(ctx) {
    const user = requireStaff(ctx);
    const form = ctx.forms.read('createClient');
    return {
      nav: navFor(user, 'clients'),
      clients: service.listClients(user).map(toClientRow),
      create: { open: form.issues.length > 0, values: form.values, issues: groupFormIssuesByField(form.issues) },
    };
  },
});

const clientPage = defineView({
  definition: { name: 'clientPage', path: '/clients/:slug/', page: 'client', session: { mode: 'required' } },
  data: z.object({ nav: navSchema, flash: flashSchema, title: z.string(), client: clientRef, members: z.array(memberRow), add: formState(memberFields) }),
  async load(ctx) {
    const user = requireStaff(ctx);
    const client = service.getClientBySlug(user, ctx.params.slug);
    const form = ctx.forms.read('addMember');
    return {
      nav: navFor(user, 'clients'),
      title: `${client.name} · Sqware Logics`,
      client: { name: client.name, href: `/clients/${client.slug}/` },
      members: service.listMembers(user, client.id).map((m) => toMemberRow(client, m)),
      add: { open: form.issues.length > 0, action: `/clients/${client.slug}/members/`, values: form.values, issues: groupFormIssuesByField(form.issues) },
    };
  },
});

const memberPage = defineView({
  definition: { name: 'memberPage', path: '/clients/:slug/members/:userId/', page: 'member', session: { mode: 'required' } },
  // title, client, member { title, who, disabled }, edit, invite | null, remove
});

// Actions: one POST route per form. Each validates, applies, publishes a flash, and returns a 303.
// On validation issues, `failure: { rerender: clientPage }` re-runs the loader with values and issues in scope and answers 422.
const addMember    = formAction('POST', '/clients/:slug/members/',                { rerender: clientPage, success: (c) => c.href });
const updateMember = formAction('POST', '/clients/:slug/members/:userId/',        { rerender: memberPage, success: (m) => m.href });
const resendInvite = formAction('POST', '/clients/:slug/members/:userId/invite/', { success: (m) => m.href });
const removeMember = formAction('POST', '/clients/:slug/members/:userId/remove/', { success: (c) => c.href });
```

`requireStaff` throws a redirect: signed out becomes a 303 to sign-in with `returnTo`, signed in without staff access becomes a 303 to `/`. `flash` and `nav` are boring enough that the runtime should merge `flash` in itself and the app should have one `navFor` helper.

`processFormSubmission`, `groupFormIssuesByField`, and session flash already exist in the backend runtime. New: `failure: { rerender }` and `page` on the view definition.

## What is left in the page scripts

Clients page, about fifteen lines: mount the mobile menu and theme switch, and fill the slug from the name as the user types.

Client page and member page: mount the mobile menu and theme switch. That is all. The 347 lines of today's client script, with its two dialogs, three-mode form, member cache, and six fetches, are deleted. Form enhancement (fetch and swap on submit) is the existing app feature and needs nothing from these pages.

## How rendering works

1. **Build.** The frontend build already parses every page with cheerio. It inlines `data-include` partials, then compiles `index.html` into a template program: static HTML chunks interleaved with operations (`text`, `attr`, `if`, `each`) carrying their paths and source lines. The program is written next to the page in the build output.
2. **Validate.** For a page that a view claims, the build walks every path against the view's `data` schema. A missing path, or `data-each` on a non-array, is a build error with file and line. A page with bindings that no view claims is a build error too.
3. **Request.** The backend runtime runs the view's loader, merges `flash`, then executes the program against the data. The executor is string concatenation over pre-split chunks with escaping, and it injects the CSRF input into POST forms. It needs no HTML parser, so it lives in the backend package, which does not depend on the frontend package. The result is composed into the app shell and returned.
4. **Enhance.** The browser receives finished HTML. `setup()` runs on it. Client navigation and form enhancement fetch HTML and swap `<main>`, exactly as today.

This replaces `injectViewState` in the backend views runtime. The JSON view-state script is dropped; the rendered DOM is the state.

## Decided on these pages

- **Shared navigation** is a build-time `data-include` partial with bound state. Not a shell slot: the sign-in page has no sidebar.
- **No class toggling.** State goes into semantic attributes and CSS selects on them. `aria-current="page"` replaced the `--active` class.
- **No interpolation.** Values in sentences get their own element.
- **Dialogs with modes become pages.** The member page replaced a three-mode dialog and a confirmation dialog.
- **Hash-switched panels become URLs.** The record page's three tabs are three paths rendered by one view.
- **No trusted-HTML construct.** The proposal document is structured data with plain-text prose. Nothing in the portal needs to inject markup, so the vocabulary keeps no way to do it.
- **No component construct, yet.** Cards render from identical markup in two places. Accepted at two copies; revisit at three.
- **A view's loader may have side effects.** Recording that a conversation was opened happens when its page renders.

## Open

- **Enhancing `<details>` into a dialog.** Whether the app wants it at all is a design question for the portal, not the framework. If it does, it is a small opt-in feature script like form enhancement, keyed on a `data-*` attribute.
- **A component construct.** Not needed by these four pages. The proposals list and the sign-in page are the remaining portal pages; if either repeats markup a third time, design it then.
