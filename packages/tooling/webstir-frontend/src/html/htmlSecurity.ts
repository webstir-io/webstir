import { createHash } from 'node:crypto';
import type { CheerioAPI } from 'cheerio';

const HTTP_TIMEOUT_MS = 5000;

export interface SubresourceIntegrityOptions {
    readonly allowExternalFetch?: boolean;
    readonly fetcher?: typeof fetch;
}

export interface SubresourceIntegrityResult {
    readonly failures: string[];
    readonly skippedExternalResources: string[];
}

export async function addSubresourceIntegrity(
    document: CheerioAPI,
    options: SubresourceIntegrityOptions = {}
): Promise<SubresourceIntegrityResult> {
    const failures: string[] = [];
    const skippedExternalResources: string[] = [];
    await Promise.all([
        processScripts(document, failures, skippedExternalResources, options),
        processStylesheets(document, failures, skippedExternalResources, options)
    ]);
    return { failures, skippedExternalResources };
}

async function processScripts(
    document: CheerioAPI,
    failures: string[],
    skippedExternalResources: string[],
    options: SubresourceIntegrityOptions
): Promise<void> {
    const scripts = document('script[src]').toArray();
    await Promise.all(scripts.map(async (element) => {
        const script = document(element);
        const src = script.attr('src');
        if (!src || script.attr('integrity')) {
            return;
        }

        if (!isExternal(src)) {
            return;
        }

        if (!options.allowExternalFetch) {
            skippedExternalResources.push(src);
            return;
        }

        const sri = await fetchIntegrity(src, options.fetcher ?? fetch);
        if (!sri) {
            failures.push(src);
            return;
        }

        script.attr('integrity', sri);
        if (!script.attr('crossorigin')) {
            script.attr('crossorigin', 'anonymous');
        }
    }));
}

async function processStylesheets(
    document: CheerioAPI,
    failures: string[],
    skippedExternalResources: string[],
    options: SubresourceIntegrityOptions
): Promise<void> {
    const links = document('link[rel="stylesheet"][href]').toArray();
    await Promise.all(links.map(async (element) => {
        const link = document(element);
        const href = link.attr('href');
        if (!href || link.attr('integrity')) {
            return;
        }

        if (!isExternal(href)) {
            return;
        }

        if (!options.allowExternalFetch) {
            skippedExternalResources.push(href);
            return;
        }

        const sri = await fetchIntegrity(href, options.fetcher ?? fetch);
        if (!sri) {
            failures.push(href);
            return;
        }

        link.attr('integrity', sri);
        if (!link.attr('crossorigin')) {
            link.attr('crossorigin', 'anonymous');
        }
    }));
}

function isExternal(url: string): boolean {
    return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//');
}

async function fetchIntegrity(url: string, fetcher: typeof fetch): Promise<string | null> {
    try {
        const normalizedUrl = url.startsWith('//') ? `https:${url}` : url;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
        try {
            const response = await fetcher(normalizedUrl, { signal: controller.signal });
            if (!response.ok) {
                return null;
            }
            const arrayBuffer = await response.arrayBuffer();
            const hash = createHash('sha384').update(Buffer.from(arrayBuffer)).digest('base64');
            return `sha384-${hash}`;
        } finally {
            clearTimeout(timeout);
        }
    } catch {
        return null;
    }
}
