export interface NavigationDomRuntime {
    readonly dynamicAttr: string;
    readonly dynamicValue: string;
    withBasePath(value: string): string;
    stripBasePath(value: string): string;
}

export type DocumentNavigationResponseResolution =
    | { readonly kind: 'document' }
    | { readonly kind: 'navigate'; readonly reason: 'http-status' | 'non-html' };

export function resolveDocumentNavigationResponse(options: {
    readonly ok: boolean;
    readonly contentType: string | null;
}): DocumentNavigationResponseResolution {
    if (!options.ok) {
        return { kind: 'navigate', reason: 'http-status' };
    }

    if (!isHtmlDocumentContentType(options.contentType)) {
        return { kind: 'navigate', reason: 'non-html' };
    }

    return { kind: 'document' };
}

export async function syncHead(
    doc: Document,
    url: string,
    runtime: NavigationDomRuntime
): Promise<void> {
    const head = document.head;
    const newHead = doc.head;
    if (!head || !newHead) {
        return;
    }

    const preservedClientNav = head.querySelector('script[data-webstir="client-nav"]');
    const preservedAppCss = Array.from(head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
        .find((link) => isAppStylesheetHref(link.getAttribute('href'), runtime.stripBasePath)) ?? null;

    for (const element of Array.from(head.querySelectorAll(`script[${runtime.dynamicAttr}="${runtime.dynamicValue}"]`))) {
        element.remove();
    }

    for (const script of Array.from(head.querySelectorAll('script[src]'))) {
        const src = script.getAttribute('src') ?? '';
        const normalizedSrc = runtime.stripBasePath(src);
        if (script === preservedClientNav) {
            continue;
        }
        if (normalizedSrc === '/hmr.js' || normalizedSrc === '/refresh.js') {
            continue;
        }
        if (normalizedSrc.startsWith('/pages/')) {
            script.remove();
        }
    }

    const desiredStyles = new Map<string, string>();
    for (const link of Array.from(newHead.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))) {
        const href = link.getAttribute('href');
        if (!href) {
            continue;
        }
        const resolved = resolveUrl(href, url, runtime);
        if (!resolved) {
            continue;
        }
        const key = runtime.stripBasePath(stripQueryAndHash(resolved));
        const finalHref = key === '/app/app.css' && preservedAppCss
            ? (preservedAppCss.getAttribute('href') ?? resolved)
            : runtime.withBasePath(resolved);
        desiredStyles.set(key, finalHref);
    }

    if (preservedAppCss) {
        const appHref = preservedAppCss.getAttribute('href') ?? runtime.withBasePath('/app/app.css');
        desiredStyles.set('/app/app.css', appHref);
    }

    const existingStyles = new Map<string, HTMLLinkElement>();
    const staleStyles: HTMLLinkElement[] = [];
    for (const link of Array.from(head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))) {
        const key = normalizeStylesheetKey(link.getAttribute('href'), window.location.href, runtime);
        if (!key) {
            link.remove();
            continue;
        }
        if (desiredStyles.has(key)) {
            if (!existingStyles.has(key)) {
                existingStyles.set(key, link);
            }
            continue;
        }
        staleStyles.push(link);
    }

    const pendingStyles: HTMLLinkElement[] = [];
    for (const [key, href] of desiredStyles.entries()) {
        if (existingStyles.has(key)) {
            continue;
        }
        const next = document.createElement('link');
        next.rel = 'stylesheet';
        next.href = href;
        head.appendChild(next);
        existingStyles.set(key, next);
        pendingStyles.push(next);
    }

    const stylesReady = pendingStyles.length > 0
        ? waitForStylesheets(pendingStyles)
        : Promise.resolve();
    if (staleStyles.length > 0) {
        void stylesReady.then(() => {
            requestAnimationFrame(() => {
                for (const link of staleStyles) {
                    link.remove();
                }
            });
        });
    }

    syncCriticalStyles(head, newHead);

    if (preservedClientNav && !head.contains(preservedClientNav)) {
        head.appendChild(preservedClientNav);
    }

    await stylesReady;
}

/** Load head scripts only after the new main and URL have been committed. */
export async function loadHeadScripts(doc: Document, url: string, runtime: NavigationDomRuntime, signal?: AbortSignal): Promise<void> {
    for (const script of Array.from(doc.head.querySelectorAll<HTMLScriptElement>('script[src]'))) {
        if (signal?.aborted) return;
        const src = resolveUrl(script.getAttribute('src') ?? '', url, runtime);
        if (!src || /\/(?:clientNav|hmr|refresh)\.js$/.test(src)) continue;
        const absolute = new URL(src, url).href;
        if (Array.from(document.head.querySelectorAll<HTMLScriptElement>('script[src]'))
            .some((existing) => existing.src === absolute)) continue;
        const next = document.createElement('script');
        for (const attribute of Array.from(script.attributes)) next.setAttribute(attribute.name, attribute.value);
        next.src = absolute;
        next.setAttribute(runtime.dynamicAttr, runtime.dynamicValue);
        const ready = waitForScript(next, signal);
        document.head.appendChild(next);
        await ready;
    }
}

export function executeScripts(container: Element | null, runtime: NavigationDomRuntime, signal?: AbortSignal): Promise<void> {
    if (!container || signal?.aborted) {
        return Promise.resolve();
    }

    const pending: Promise<void>[] = [];
    const scripts = Array.from(container.querySelectorAll('script'));
    for (const script of scripts) {
        const src = script.getAttribute('src');
        const type = script.getAttribute('type');

        const normalizedSrc = src ? runtime.stripBasePath(src) : '';
        if (normalizedSrc && (normalizedSrc === '/clientNav.js' || normalizedSrc.endsWith('/clientNav.js'))) {
            script.remove();
            continue;
        }
        if (normalizedSrc === '/hmr.js' || normalizedSrc === '/refresh.js') {
            script.remove();
            continue;
        }

        const next = document.createElement('script');
        for (const attribute of Array.from(script.attributes)) next.setAttribute(attribute.name, attribute.value);
        if (type) {
            next.type = type;
        }

        if (src) {
            const resolved = resolveUrl(src, window.location.href, runtime);
            if (resolved) {
                next.src = resolved;
            }
        } else if (script.textContent) {
            next.textContent = script.textContent;
        }

        if (src || type === 'module') {
            pending.push(waitForScript(next, signal));
        }
        script.replaceWith(next);
    }
    return Promise.all(pending).then(() => {});
}

function waitForScript(script: HTMLScriptElement, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const finish = () => {
            script.onload = null;
            script.onerror = null;
            signal?.removeEventListener('abort', abort);
        };
        const abort = () => {
            finish();
            script.remove();
            resolve();
        };
        signal?.addEventListener('abort', abort, { once: true });
        script.onload = () => { finish(); resolve(); };
        script.onerror = () => {
            finish();
            reject(new Error(`Unable to load navigation script: ${script.src || 'inline module'}`));
        };
    });
}

export function focusAutofocus(root: ParentNode): void {
    const focusTarget = root.querySelector('[autofocus]');
    if (focusTarget instanceof HTMLElement) {
        focusTarget.focus();
    }
}

export function cssEscape(value: string): string {
    if (typeof CSS !== 'undefined' && typeof (CSS as { escape?: (input: string) => string }).escape === 'function') {
        return (CSS as { escape: (input: string) => string }).escape(value);
    }
    return value.replace(/[\"\\\\]/g, '\\\\$&');
}

function resolveUrl(value: string, baseUrl: string, runtime: NavigationDomRuntime): string | null {
    try {
        const trimmed = String(value ?? '').trim();
        const [path, suffix] = splitPathSuffix(trimmed);
        if (path && !path.startsWith('/') && !path.startsWith('http:') && !path.startsWith('https:')) {
            if (path === 'index.js' || path === 'index.css') {
                const pageName = getPageNameFromUrl(baseUrl, runtime.stripBasePath);
                return runtime.withBasePath(`/pages/${pageName}/${path}${suffix}`);
            }
        }

        const resolved = new URL(value, baseUrl);
        return resolved.origin === window.location.origin
            ? runtime.withBasePath(resolved.pathname + resolved.search + resolved.hash)
            : resolved.href;
    } catch {
        return null;
    }
}

function normalizeStylesheetKey(href: string | null, baseUrl: string, runtime: NavigationDomRuntime): string | null {
    const resolved = resolveUrl(href ?? '', baseUrl, runtime);
    if (!resolved) {
        return null;
    }
    return runtime.stripBasePath(stripQueryAndHash(resolved));
}

function stripQueryAndHash(value: string): string {
    return value.split(/[?#]/)[0] ?? value;
}

function waitForStylesheets(links: HTMLLinkElement[], timeoutMs = 2000): Promise<void> {
    if (links.length === 0) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        let remaining = links.length;
        let done = false;
        const finish = () => {
            if (done) {
                return;
            }
            done = true;
            resolve();
        };

        const timer = window.setTimeout(finish, timeoutMs);
        const handle = () => {
            if (done) {
                return;
            }
            remaining -= 1;
            if (remaining <= 0) {
                window.clearTimeout(timer);
                finish();
            }
        };

        for (const link of links) {
            if (link.sheet) {
                handle();
                continue;
            }
            link.addEventListener('load', handle, { once: true });
            link.addEventListener('error', handle, { once: true });
        }
    });
}

function syncCriticalStyles(head: HTMLHeadElement, newHead: HTMLHeadElement): void {
    for (const style of Array.from(head.querySelectorAll<HTMLStyleElement>('style[data-critical]'))) {
        style.remove();
    }

    for (const style of Array.from(newHead.querySelectorAll<HTMLStyleElement>('style[data-critical]'))) {
        const next = document.createElement('style');
        for (const attribute of Array.from(style.attributes)) {
            next.setAttribute(attribute.name, attribute.value);
        }
        if (style.textContent) {
            next.textContent = style.textContent;
        }
        head.appendChild(next);
    }
}

function splitPathSuffix(value: string): [string, string] {
    const [path, suffix = ''] = value.split(/(?=[?#])/);
    return [path ?? '', suffix ?? ''];
}

function isAppStylesheetHref(href: string | null, stripBasePath: (value: string) => string): boolean {
    if (!href) {
        return false;
    }

    try {
        const normalized = stripBasePath(new URL(href, window.location.origin).pathname);
        return normalized === '/app/app.css';
    } catch {
        const trimmed = href.trim();
        if (!trimmed) {
            return false;
        }
        const [path] = trimmed.split(/[?#]/);
        return stripBasePath(path) === '/app/app.css';
    }
}

function isHtmlDocumentContentType(value: string | null): boolean {
    if (!value) {
        return false;
    }

    const normalized = value.toLowerCase();
    return normalized.includes('text/html') || normalized.includes('application/xhtml+xml');
}

function getPageNameFromUrl(url: string, stripBasePath: (value: string) => string): string {
    try {
        const pathname = stripBasePath(new URL(url, window.location.href).pathname);
        const trimmed = pathname.replace(/^\/+|\/+$/g, '');
        if (!trimmed) {
            return 'home';
        }

        const firstSegment = trimmed.split('/')[0];
        return firstSegment || 'home';
    } catch {
        return 'home';
    }
}
