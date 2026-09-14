type DocsNavEntry = {
  path: string;
  title: string;
  section?: string;
};

type DocsIndexGroup = {
  key: string;
  title: string;
  path?: string;
  pages: DocsNavEntry[];
};

const BASE_PATH = resolveBasePath();

const indexSelector = '[data-docs-index]';
const indexRoot = document.querySelector<HTMLElement>(indexSelector);

if (indexRoot) {
  void populateDocsIndex(indexRoot);
}

window.addEventListener('webstir:client-nav', () => {
  const nextRoot = document.querySelector<HTMLElement>(indexSelector);
  if (nextRoot) {
    void populateDocsIndex(nextRoot);
  }
});

function resolveBasePath(): string {
  const raw = document.documentElement?.getAttribute('data-webstir-base') ?? '';
  return normalizeBasePath(raw);
}

function normalizeBasePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') {
    return '';
  }
  if (!trimmed.startsWith('/')) {
    return `/${trimmed}`;
  }
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

function withBasePath(value: string): string {
  if (!BASE_PATH) {
    return value;
  }
  if (!value.startsWith('/') || value.startsWith('//')) {
    return value;
  }
  if (value === BASE_PATH || value.startsWith(`${BASE_PATH}/`) || value.startsWith(`${BASE_PATH}?`) || value.startsWith(`${BASE_PATH}#`)) {
    return value;
  }
  return `${BASE_PATH}${value}`;
}

async function populateDocsIndex(root: HTMLElement): Promise<void> {
  const entries = await fetchDocsNav();
  root.innerHTML = '';

  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'docs-index__empty';
    empty.textContent = 'No docs yet. Add Markdown files to src/frontend/content/.';
    root.appendChild(empty);
    return;
  }

  for (const group of groupDocsEntries(entries)) {
    root.appendChild(renderDocsIndexGroup(group));
  }
}

function groupDocsEntries(entries: readonly DocsNavEntry[]): DocsIndexGroup[] {
  const groups = new Map<string, DocsIndexGroup>();

  for (const entry of entries) {
    const key = entry.section ?? sectionFromPath(entry.path);
    let group = groups.get(key);
    if (!group) {
      group = { key, title: toTitleCase(key.replace(/[-_]/g, ' ')), pages: [] };
      groups.set(key, group);
    }

    if (isSectionIndex(entry.path, key)) {
      group.title = entry.title;
      group.path = entry.path;
    } else {
      group.pages.push(entry);
    }
  }

  return Array.from(groups.values());
}

function renderDocsIndexGroup(group: DocsIndexGroup): HTMLElement {
  const section = document.createElement('section');
  section.className = 'docs-index__group';

  const heading = document.createElement('h2');
  heading.className = 'docs-index__heading';
  if (group.path) {
    const link = document.createElement('a');
    link.className = 'docs-index__heading-link';
    link.href = withBasePath(group.path);
    link.textContent = group.title;
    heading.appendChild(link);
  } else {
    heading.textContent = group.title;
  }
  section.appendChild(heading);

  if (group.pages.length === 0) {
    return section;
  }

  const list = document.createElement('ul');
  list.className = 'docs-index__list';

  for (const entry of group.pages) {
    const item = document.createElement('li');
    item.className = 'docs-index__item';

    const link = document.createElement('a');
    link.className = 'docs-index__link';
    link.href = withBasePath(entry.path);
    link.textContent = entry.title;

    item.appendChild(link);
    list.appendChild(item);
  }

  section.appendChild(list);
  return section;
}

function sectionFromPath(value: string): string {
  const segments = value.split('/').filter(Boolean);
  return segments.length > 1 ? segments[1] : segments[0] ?? 'docs';
}

function isSectionIndex(value: string, section: string): boolean {
  const normalized = value.endsWith('/') ? value : `${value}/`;
  return normalized === `/docs/${section}/`;
}

function toTitleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

async function fetchDocsNav(): Promise<DocsNavEntry[]> {
  try {
    const response = await fetch(withBasePath('/docs-nav.json'));
    if (!response.ok) {
      return [];
    }
    const payload = await response.json();
    if (!Array.isArray(payload)) {
      return [];
    }
    return payload
      .filter((entry): entry is DocsNavEntry => Boolean(entry && entry.path && entry.title))
      .map((entry) => ({
        path: String(entry.path),
        title: String(entry.title),
        section: typeof entry.section === 'string' ? entry.section : undefined
      }));
  } catch {
    return [];
  }
}
