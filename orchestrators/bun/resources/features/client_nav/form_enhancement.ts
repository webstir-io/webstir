export type FragmentUpdateMode = 'replace' | 'append' | 'prepend';

export interface FragmentResponseMetadata {
    readonly target: string;
    readonly selector?: string;
    readonly mode: FragmentUpdateMode;
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

function toUrlEncodedBody(formData: FormData): URLSearchParams | null {
    const params = new URLSearchParams();
    for (const [key, value] of formData.entries()) {
        if (typeof value !== 'string') {
            return null;
        }
        params.append(key, value);
    }
    return params;
}
