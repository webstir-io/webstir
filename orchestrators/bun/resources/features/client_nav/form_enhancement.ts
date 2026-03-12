export type FragmentUpdateMode = 'replace' | 'append' | 'prepend';

export interface FragmentResponseMetadata {
    readonly target: string;
    readonly selector?: string;
    readonly mode: FragmentUpdateMode;
}

export type FragmentResponseMetadataIssue = 'target' | 'selector' | 'mode';

export type FragmentResponseMetadataResolution =
    | { readonly kind: 'none' }
    | { readonly kind: 'invalid'; readonly issues: readonly FragmentResponseMetadataIssue[] }
    | { readonly kind: 'fragment'; readonly fragment: FragmentResponseMetadata };

export interface FragmentRootCandidate {
    readonly id?: string | null;
    readonly fragmentTarget?: string | null;
    readonly matchesSelector?: boolean;
}

export interface EnhancedFormRequest {
    readonly url: string;
    readonly init: RequestInit;
}

export type EnhancedFormResponseResolution =
    | { readonly kind: 'fragment'; readonly fragment: FragmentResponseMetadata }
    | { readonly kind: 'document' }
    | {
        readonly kind: 'navigate';
        readonly location: string;
        readonly reason: 'redirect' | 'missing-target' | 'invalid-fragment' | 'non-html';
    };

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

export function resolveFragmentResponseMetadata(headers: Headers): FragmentResponseMetadataResolution {
    const rawTarget = headers.get('x-webstir-fragment-target');
    const rawSelector = headers.get('x-webstir-fragment-selector');
    const rawMode = headers.get('x-webstir-fragment-mode');

    if (rawTarget === null && rawSelector === null && rawMode === null) {
        return { kind: 'none' };
    }

    const issues: FragmentResponseMetadataIssue[] = [];
    const target = rawTarget?.trim() ?? '';
    if (!target) {
        issues.push('target');
    }

    let selector: string | undefined;
    if (rawSelector !== null) {
        const normalizedSelector = rawSelector.trim();
        if (!normalizedSelector) {
            issues.push('selector');
        } else {
            selector = normalizedSelector;
        }
    }

    let mode: FragmentUpdateMode = 'replace';
    if (rawMode !== null) {
        const normalizedMode = rawMode.trim().toLowerCase();
        if (normalizedMode === 'replace' || normalizedMode === 'append' || normalizedMode === 'prepend') {
            mode = normalizedMode;
        } else {
            issues.push('mode');
        }
    }

    if (issues.length > 0) {
        return {
            kind: 'invalid',
            issues
        };
    }

    return {
        kind: 'fragment',
        fragment: {
            target,
            selector,
            mode
        }
    };
}

export function readFragmentResponseMetadata(headers: Headers): FragmentResponseMetadata | null {
    const resolution = resolveFragmentResponseMetadata(headers);
    return resolution.kind === 'fragment' ? resolution.fragment : null;
}

export function resolveEnhancedFormResponse(options: {
    readonly metadata: FragmentResponseMetadataResolution;
    readonly hasFragmentTarget: boolean;
    readonly contentType: string | null;
    readonly redirected: boolean;
    readonly responseUrl?: string | null;
    readonly requestUrl: string;
}): EnhancedFormResponseResolution {
    if (options.metadata.kind === 'fragment') {
        if (options.hasFragmentTarget) {
            return {
                kind: 'fragment',
                fragment: options.metadata.fragment
            };
        }

        if (isHtmlDocumentContentType(options.contentType)) {
            return { kind: 'document' };
        }

        return {
            kind: 'navigate',
            location: options.responseUrl || options.requestUrl,
            reason: 'missing-target'
        };
    }

    if (options.metadata.kind === 'invalid') {
        if (isHtmlDocumentContentType(options.contentType)) {
            return { kind: 'document' };
        }

        return {
            kind: 'navigate',
            location: options.responseUrl || options.requestUrl,
            reason: 'invalid-fragment'
        };
    }

    if (isHtmlDocumentContentType(options.contentType)) {
        return { kind: 'document' };
    }

    if (options.redirected && options.responseUrl) {
        return {
            kind: 'navigate',
            location: options.responseUrl,
            reason: 'redirect'
        };
    }

    return {
        kind: 'navigate',
        location: options.responseUrl || options.requestUrl,
        reason: 'non-html'
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
