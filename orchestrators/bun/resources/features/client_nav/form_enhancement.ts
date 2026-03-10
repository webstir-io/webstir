export type FragmentUpdateMode = 'replace' | 'append' | 'prepend';

export interface FragmentResponseMetadata {
    readonly target: string;
    readonly selector?: string;
    readonly mode: FragmentUpdateMode;
}

export interface FragmentRootCandidate {
    readonly id?: string | null;
    readonly fragmentTarget?: string | null;
    readonly matchesSelector?: boolean;
}

export interface EnhancedFormRequest {
    readonly url: string;
    readonly init: RequestInit;
}

const CLIENT_NAV_HEADER = 'X-Webstir-Client-Nav';
const DEFAULT_FORM_ENCODING = 'application/x-www-form-urlencoded';

export function normalizeFormMethod(value: string | null | undefined): string {
    const normalized = String(value ?? 'GET').trim().toUpperCase();
    return normalized || 'GET';
}

export function normalizeFormEnctype(value: string | null | undefined): string {
    const normalized = String(value ?? DEFAULT_FORM_ENCODING).trim().toLowerCase();
    return normalized || DEFAULT_FORM_ENCODING;
}

export function buildEnhancedFormRequest(options: {
    readonly action: string;
    readonly method: string;
    readonly enctype?: string | null;
    readonly formData: FormData;
}): EnhancedFormRequest | null {
    const method = normalizeFormMethod(options.method);
    if (method !== 'POST') {
        return null;
    }

    const enctype = normalizeFormEnctype(options.enctype);
    const headers = new Headers({ [CLIENT_NAV_HEADER]: '1' });

    if (enctype === DEFAULT_FORM_ENCODING) {
        const body = toUrlEncodedBody(options.formData);
        if (body === null) {
            return null;
        }
        headers.set('content-type', DEFAULT_FORM_ENCODING);
        return {
            url: options.action,
            init: {
                method,
                headers,
                body
            }
        };
    }

    if (enctype === 'multipart/form-data') {
        return {
            url: options.action,
            init: {
                method,
                headers,
                body: options.formData
            }
        };
    }

    return null;
}

export function readFragmentResponseMetadata(headers: Headers): FragmentResponseMetadata | null {
    const target = headers.get('x-webstir-fragment-target')?.trim();
    if (!target) {
        return null;
    }

    const selector = headers.get('x-webstir-fragment-selector')?.trim() || undefined;
    const rawMode = headers.get('x-webstir-fragment-mode')?.trim().toLowerCase();
    const mode = rawMode === 'append' || rawMode === 'prepend' ? rawMode : 'replace';

    return {
        target,
        selector,
        mode
    };
}

export function isHtmlDocumentContentType(value: string | null): boolean {
    if (!value) {
        return false;
    }

    const normalized = value.toLowerCase();
    return normalized.includes('text/html') || normalized.includes('application/xhtml+xml');
}

export function shouldReplaceFragmentTarget(options: {
    readonly mode: FragmentUpdateMode;
    readonly target: string;
    readonly roots: readonly FragmentRootCandidate[];
}): boolean {
    if (options.mode !== 'replace' || options.roots.length !== 1) {
        return false;
    }

    const [root] = options.roots;
    return root.matchesSelector === true
        || matchesFragmentTarget(root.id, options.target)
        || matchesFragmentTarget(root.fragmentTarget, options.target);
}

function toUrlEncodedBody(formData: FormData): URLSearchParams | null {
    const params = new URLSearchParams();
    let hasBinaryValue = false;
    formData.forEach((value, key) => {
        if (typeof value !== 'string') {
            hasBinaryValue = true;
            return;
        }
        params.append(key, value);
    });
    return hasBinaryValue ? null : params;
}

function matchesFragmentTarget(value: string | null | undefined, target: string): boolean {
    return typeof value === 'string' && value.trim() === target;
}
