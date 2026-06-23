export {};

type DocsNavEntry = {
    path: string;
    title: string;
    section?: string;
    order?: number;
};

type NavNode = {
    segment: string;
    path: string;
    title: string;
    children: NavNode[];
    isPage: boolean;
    position: number;
};

type ContentNavState = {
    navEntriesByUrl?: Map<string, DocsNavEntry[]>;
};

type ContentNavConfig = {
    basePath: string;
    label: string;
    navUrl: string;
};

const STATE_KEY = '__webstirContentNavState';
const BASE_PATH = resolveBasePath();
const NAV_LAYOUT_SELECTOR = '[data-content-nav="true"]';
const APP_NAV_SELECTOR = '.app-nav';
const APP_NAV_DOCS_SELECTOR = '[data-content-nav-menu], [data-docs-nav-menu]';
const DEFAULT_CONTENT_CONFIG: ContentNavConfig = {
    basePath: '/docs/',
    label: 'Docs',
    navUrl: withBasePath('/docs-nav.json')
};

function getState(): ContentNavState {
    const w = window as unknown as Record<string, ContentNavState | undefined>;
    if (!w[STATE_KEY]) {
        w[STATE_KEY] = {};
    }
    return w[STATE_KEY] as ContentNavState;
}

function normalizeContentPath(pathname: string, config: ContentNavConfig): string {
    const normalized = stripBasePath(pathname);
    if (!isContentPath(normalized, config)) {
        return normalized;
    }
    if (normalized === config.basePath.slice(0, -1)) {
        return config.basePath;
    }
    return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function isContentPath(pathname: string, config: ContentNavConfig): boolean {
    const baseWithoutSlash = config.basePath.slice(0, -1);
    return pathname === baseWithoutSlash || pathname === config.basePath || pathname.startsWith(config.basePath);
}

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

function stripBasePath(value: string): string {
    if (!BASE_PATH || !value.startsWith('/')) {
        return value;
    }
    if (value === BASE_PATH) {
        return '/';
    }
    if (value.startsWith(`${BASE_PATH}/`) || value.startsWith(`${BASE_PATH}?`) || value.startsWith(`${BASE_PATH}#`)) {
        return value.slice(BASE_PATH.length);
    }
    return value;
}

function resolveLayoutConfig(layout: HTMLElement): ContentNavConfig {
    const basePath = normalizeContentBasePath(layout.dataset.contentBase ?? DEFAULT_CONTENT_CONFIG.basePath);
    const label = layout.dataset.contentLabel?.trim() || DEFAULT_CONTENT_CONFIG.label;
    const navUrl = withBasePath(layout.dataset.contentNavUrl?.trim() || DEFAULT_CONTENT_CONFIG.navUrl);
    return { basePath, label, navUrl };
}

function normalizeContentBasePath(value: string): string {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '/') {
        return DEFAULT_CONTENT_CONFIG.basePath;
    }

    const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    const withTrailing = withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
    const segments = withTrailing.split('/').filter(Boolean);
    return `/${segments[0] ?? 'docs'}/`;
}

async function fetchDocsNav(config: ContentNavConfig): Promise<DocsNavEntry[]> {
    const state = getState();
    state.navEntriesByUrl ??= new Map<string, DocsNavEntry[]>();
    const cached = state.navEntriesByUrl.get(config.navUrl);
    if (cached) {
        return cached;
    }

    try {
        const response = await fetch(config.navUrl, { headers: { Accept: 'application/json' } });
        if (!response.ok) {
            state.navEntriesByUrl.set(config.navUrl, []);
            return [];
        }

        const payload = await response.json();
        if (!Array.isArray(payload)) {
            state.navEntriesByUrl.set(config.navUrl, []);
            return [];
        }

        const entries = payload
            .filter((entry): entry is DocsNavEntry => Boolean(entry && entry.path && entry.title))
            .map((entry) => ({
                path: String(entry.path),
                title: String(entry.title),
                section: typeof entry.section === 'string' ? entry.section : undefined,
                order: typeof entry.order === 'number' ? entry.order : undefined
            }));

        state.navEntriesByUrl.set(config.navUrl, entries);
        return entries;
    } catch {
        state.navEntriesByUrl.set(config.navUrl, []);
        return [];
    }
}

function buildNavTree(entries: readonly DocsNavEntry[], config: ContentNavConfig): NavNode {
    let position = 0;
    const baseSegments = config.basePath.split('/').filter(Boolean);
    const root: NavNode = {
        segment: baseSegments[0] ?? 'docs',
        path: config.basePath,
        title: config.label,
        children: [],
        isPage: false,
        position: position++
    };

    for (const entry of entries) {
        const normalizedPath = normalizeContentPath(entry.path, config);
        const segments = normalizedPath.split('/').filter(Boolean);
        if (segments.length <= baseSegments.length) {
            continue;
        }

        let current = root;
        for (let index = baseSegments.length; index < segments.length; index += 1) {
            const segment = segments[index];
            const nodePath = `/${segments.slice(0, index + 1).join('/')}/`;
            let child = current.children.find((node) => node.segment === segment);
            if (!child) {
                child = {
                    segment,
                    path: nodePath,
                    title: toTitleCase(segment.replace(/[-_]/g, ' ')),
                    children: [],
                    isPage: false,
                    position: position++
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

function renderNavList(nodes: readonly NavNode[], currentPath: string, depth = 0): HTMLOListElement {
    const list = document.createElement('ol');
    list.className = depth === 0 ? 'docs-nav__list' : 'docs-nav__list docs-nav__list--nested';

    const sorted = [...nodes].sort((a, b) => a.position - b.position);
    for (const node of sorted) {
        const item = document.createElement('li');
        item.className = 'docs-nav__item';

        const isActive = node.path === currentPath;
        const isBranch = !isActive && currentPath.startsWith(node.path);
        if (isActive) {
            item.dataset.active = 'true';
        } else if (isBranch) {
            item.dataset.activeBranch = 'true';
        }

        if (node.isPage) {
            const link = document.createElement('a');
            link.className = 'docs-nav__link';
            link.href = withBasePath(node.path);
            link.textContent = node.title;
            if (isActive) {
                link.setAttribute('aria-current', 'page');
            }
            item.appendChild(link);
        } else {
            const label = document.createElement('span');
            label.className = 'docs-nav__label';
            label.textContent = node.title;
            item.appendChild(label);
        }

        if (node.children.length > 0) {
            item.appendChild(renderNavList(node.children, currentPath, depth + 1));
        }

        list.appendChild(item);
    }

    return list;
}

function clearAppMenuDocsNav(): void {
    const appNav = document.querySelector<HTMLElement>(APP_NAV_SELECTOR);
    const existing = appNav?.querySelector<HTMLElement>(APP_NAV_DOCS_SELECTOR);
    existing?.remove();
}

function renderAppMenuDocsNav(tree: NavNode, currentPath: string, config: ContentNavConfig): void {
    const appNav = document.querySelector<HTMLElement>(APP_NAV_SELECTOR);
    if (!appNav) {
        return;
    }

    const section = document.createElement('div');
    section.className = 'app-nav__docs';
    section.dataset.contentNavMenu = 'true';

    const topNodes = tree.children;
    const nodes =
        topNodes.length === 1 && !topNodes[0].isPage && topNodes[0].children.length > 0
            ? topNodes[0].children
            : topNodes;

    const list = renderNavList(nodes, currentPath);
    section.appendChild(list);

    const contentHref = withBasePath(config.basePath);
    const contentHrefNoSlash = contentHref.endsWith('/') ? contentHref.slice(0, -1) : contentHref;
    const contentLink = appNav.querySelector<HTMLAnchorElement>(`a[href="${contentHref}"], a[href="${contentHrefNoSlash}"]`);
    if (contentLink) {
        contentLink.insertAdjacentElement('afterend', section);
    } else {
        appNav.appendChild(section);
    }
}

function renderBreadcrumb(
    root: HTMLElement,
    titleByPath: ReadonlyMap<string, string>,
    currentPath: string,
    config: ContentNavConfig
): boolean {
    if (!isContentPath(currentPath, config)) {
        root.setAttribute('aria-hidden', 'true');
        root.dataset.breadcrumbVisible = 'false';
        root.innerHTML = '';
        return false;
    }

    const list = document.createElement('ol');
    list.className = 'docs-breadcrumb__list';

    const segments =
        currentPath === config.basePath ? [] : currentPath.slice(config.basePath.length).split('/').filter(Boolean);
    const crumbs: Array<{ title: string; href: string }> = [];

    const rootTitle = titleByPath.get(config.basePath) ?? config.label;
    crumbs.push({ title: rootTitle, href: config.basePath });

    let current = config.basePath;
    for (const segment of segments) {
        current = `${current}${segment}/`;
        const title = titleByPath.get(current) ?? toTitleCase(segment.replace(/[-_]/g, ' '));
        crumbs.push({ title, href: current });
    }

    for (let index = 0; index < crumbs.length; index += 1) {
        const crumb = crumbs[index];
        const item = document.createElement('li');
        item.className = 'docs-breadcrumb__item';

        if (index === crumbs.length - 1) {
            const label = document.createElement('span');
            label.textContent = crumb.title;
            label.setAttribute('aria-current', 'page');
            item.appendChild(label);
        } else {
            const link = document.createElement('a');
            link.className = 'docs-breadcrumb__link';
            link.href = withBasePath(crumb.href);
            link.textContent = crumb.title;
            item.appendChild(link);
        }

        list.appendChild(item);
    }

    root.innerHTML = '';
    root.appendChild(list);
    root.removeAttribute('aria-hidden');
    root.dataset.breadcrumbVisible = 'true';
    return true;
}

function toTitleCase(value: string): string {
    return value
        .split(/\s+/)
        .filter((part) => part.length > 0)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

async function initContentNav(): Promise<void> {
    const layouts = Array.from(document.querySelectorAll<HTMLElement>(NAV_LAYOUT_SELECTOR));
    clearAppMenuDocsNav();
    if (layouts.length === 0) {
        return;
    }

    for (const layout of layouts) {
        const config = resolveLayoutConfig(layout);
        const navEntries = await fetchDocsNav(config);
        const titleByPath = new Map<string, string>(
            navEntries.map((entry) => [normalizeContentPath(entry.path, config), entry.title])
        );
        titleByPath.set(config.basePath, titleByPath.get(config.basePath) ?? config.label);

        const tree = buildNavTree(navEntries, config);
        const currentPath = normalizeContentPath(window.location.pathname, config);
        if (navEntries.length > 0) {
            renderAppMenuDocsNav(tree, currentPath, config);
        }

        const sidebar = layout.querySelector<HTMLElement>('[data-docs-sidebar]');
        const navRoot = layout.querySelector<HTMLElement>('[data-docs-nav]');
        const breadcrumb = layout.querySelector<HTMLElement>('[data-docs-breadcrumb]');
        let hasNav = false;
        if (navRoot && sidebar && navEntries.length > 0) {
            const list = renderNavList(tree.children, currentPath);
            navRoot.innerHTML = '';
            navRoot.appendChild(list);
            hasNav = true;
        }

        if (breadcrumb) {
            renderBreadcrumb(breadcrumb, titleByPath, currentPath, config);
        }

        if (hasNav) {
            layout.dataset.contentNavReady = 'true';
        } else {
            layout.dataset.contentNavReady = 'false';
        }
    }
}

void initContentNav();
window.addEventListener('webstir:client-nav', () => {
    void initContentNav();
});
