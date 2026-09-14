export {};

type DocsNavEntry = {
    path: string;
    title: string;
};

type NavNode = {
    segment: string;
    path: string;
    title: string;
    children: NavNode[];
    isPage: boolean;
};

type PageNavState = {
    navEntries?: DocsNavEntry[];
    cleanupToc?: () => void;
};

const STATE_KEY = '__webstirContentNavState';
const BASE_PATH = resolveBasePath();
const NAV_URL = withBasePath('/docs-nav.json');
const ARTICLE_SELECTOR = '[data-docs-article]';
const HEADING_SELECTOR = 'h2[id], h3[id]';

function getState(): PageNavState {
    const w = window as unknown as Record<string, PageNavState | undefined>;
    if (!w[STATE_KEY]) {
        w[STATE_KEY] = {};
    }
    return w[STATE_KEY] as PageNavState;
}

function resolveBasePath(): string {
    const raw = document.documentElement?.getAttribute('data-webstir-base') ?? '';
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '/') {
        return '';
    }
    const prefixed = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return prefixed.endsWith('/') ? prefixed.slice(0, -1) : prefixed;
}

function withBasePath(value: string): string {
    if (!BASE_PATH || !value.startsWith('/') || value.startsWith('//')) {
        return value;
    }
    if (value === BASE_PATH || value.startsWith(`${BASE_PATH}/`)) {
        return value;
    }
    return `${BASE_PATH}${value}`;
}

function stripBasePath(value: string): string {
    if (!BASE_PATH || !value.startsWith('/')) {
        return value;
    }
    if (value === BASE_PATH) {
        return '/';
    }
    return value.startsWith(`${BASE_PATH}/`) ? value.slice(BASE_PATH.length) : value;
}

function normalizeDocsPath(pathname: string): string {
    const normalized = stripBasePath(pathname);
    if (!normalized.startsWith('/docs')) {
        return normalized;
    }
    return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

async function fetchDocsNav(): Promise<DocsNavEntry[]> {
    const state = getState();
    if (state.navEntries) {
        return state.navEntries;
    }

    try {
        const response = await fetch(NAV_URL, { headers: { Accept: 'application/json' } });
        const payload = response.ok ? await response.json() : [];
        const entries = Array.isArray(payload)
            ? payload
                  .filter((entry): entry is DocsNavEntry => Boolean(entry && entry.path && entry.title))
                  .map((entry) => ({ path: String(entry.path), title: String(entry.title) }))
            : [];
        state.navEntries = entries;
        return entries;
    } catch {
        state.navEntries = [];
        return [];
    }
}

function buildNavTree(entries: readonly DocsNavEntry[]): NavNode {
    const root: NavNode = { segment: 'docs', path: '/docs/', title: 'Docs', children: [], isPage: false };

    for (const entry of entries) {
        const segments = normalizeDocsPath(entry.path).split('/').filter(Boolean);
        let current = root;
        for (let index = 1; index < segments.length; index += 1) {
            const segment = segments[index];
            let child = current.children.find((node) => node.segment === segment);
            if (!child) {
                child = {
                    segment,
                    path: `/${segments.slice(0, index + 1).join('/')}/`,
                    title: segment,
                    children: [],
                    isPage: false
                };
                current.children.push(child);
            }
            current = child;
        }
        current.title = entry.title;
        current.isPage = true;
    }

    return root;
}

function flattenPages(node: NavNode, out: DocsNavEntry[] = []): DocsNavEntry[] {
    if (node.isPage) {
        out.push({ path: node.path, title: node.title });
    }
    for (const child of node.children) {
        flattenPages(child, out);
    }
    return out;
}

function renderPaginationLink(entry: DocsNavEntry, direction: 'prev' | 'next'): HTMLAnchorElement {
    const link = document.createElement('a');
    link.className = `docs-pagination__link docs-pagination__link--${direction}`;
    link.href = withBasePath(entry.path);
    link.rel = direction;

    const label = document.createElement('span');
    label.className = 'docs-pagination__label';
    label.textContent = direction === 'prev' ? 'Previous' : 'Next';

    const title = document.createElement('span');
    title.className = 'docs-pagination__title';
    title.textContent = entry.title;

    link.append(label, title);
    return link;
}

async function renderPagination(article: HTMLElement): Promise<void> {
    document.querySelectorAll('[data-docs-pagination]').forEach((node) => node.remove());

    const entries = await fetchDocsNav();
    if (entries.length === 0) {
        return;
    }

    const pages = flattenPages(buildNavTree(entries));
    const currentPath = normalizeDocsPath(window.location.pathname);
    const index = pages.findIndex((page) => page.path === currentPath);
    if (index === -1) {
        return;
    }

    const prev = index > 0 ? pages[index - 1] : undefined;
    const next = index < pages.length - 1 ? pages[index + 1] : undefined;
    if (!prev && !next) {
        return;
    }

    const nav = document.createElement('nav');
    nav.className = 'docs-pagination';
    nav.dataset.docsPagination = 'true';
    nav.setAttribute('aria-label', 'Docs pagination');

    if (prev) {
        nav.appendChild(renderPaginationLink(prev, 'prev'));
    }
    if (next) {
        nav.appendChild(renderPaginationLink(next, 'next'));
    }

    article.insertAdjacentElement('afterend', nav);
}

function renderToc(article: HTMLElement): void {
    const state = getState();
    state.cleanupToc?.();
    state.cleanupToc = undefined;
    document.querySelectorAll('[data-docs-toc]').forEach((node) => node.remove());

    const headings = Array.from(article.querySelectorAll<HTMLHeadingElement>(HEADING_SELECTOR));
    if (headings.length < 2) {
        return;
    }

    const layoutInner = article.closest<HTMLElement>('.docs-layout__inner');
    if (!layoutInner) {
        return;
    }

    const aside = document.createElement('aside');
    aside.className = 'docs-toc';
    aside.dataset.docsToc = 'true';

    const title = document.createElement('p');
    title.className = 'docs-toc__title';
    title.id = 'docs-toc-title';
    title.textContent = 'On this page';

    const nav = document.createElement('nav');
    nav.className = 'docs-toc__nav';
    nav.setAttribute('aria-labelledby', title.id);

    const list = document.createElement('ol');
    list.className = 'docs-toc__list';

    const links = new Map<HTMLHeadingElement, HTMLAnchorElement>();
    for (const heading of headings) {
        const item = document.createElement('li');
        item.className = `docs-toc__item docs-toc__item--${heading.tagName.toLowerCase()}`;

        const link = document.createElement('a');
        link.className = 'docs-toc__link';
        link.href = `#${heading.id}`;
        link.textContent = heading.textContent?.trim() ?? heading.id;

        item.appendChild(link);
        list.appendChild(item);
        links.set(heading, link);
    }

    nav.appendChild(list);
    aside.append(title, nav);
    layoutInner.appendChild(aside);

    let frame = 0;
    const updateActive = () => {
        frame = 0;
        const offset = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
        let active: HTMLHeadingElement | undefined;
        for (const heading of headings) {
            if (heading.getBoundingClientRect().top - offset <= 1) {
                active = heading;
            } else {
                break;
            }
        }
        for (const [heading, link] of links) {
            if (heading === active) {
                link.setAttribute('aria-current', 'true');
            } else {
                link.removeAttribute('aria-current');
            }
        }
    };
    const onScroll = () => {
        if (!frame) {
            frame = requestAnimationFrame(updateActive);
        }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    updateActive();
    state.cleanupToc = () => {
        window.removeEventListener('scroll', onScroll);
        if (frame) {
            cancelAnimationFrame(frame);
        }
    };
}

function initPageNav(): void {
    const article = document.querySelector<HTMLElement>(ARTICLE_SELECTOR);
    if (!article) {
        getState().cleanupToc?.();
        document.querySelectorAll('[data-docs-toc], [data-docs-pagination]').forEach((node) => node.remove());
        return;
    }

    renderToc(article);
    void renderPagination(article);
}

initPageNav();
window.addEventListener('webstir:client-nav', () => {
    initPageNav();
});
