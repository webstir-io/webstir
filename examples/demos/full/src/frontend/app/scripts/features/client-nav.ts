import {
    buildEnhancedFormRequest,
    isHtmlDocumentContentType,
    normalizeFormEnctype,
    normalizeFormMethod,
    readFragmentResponseMetadata
} from './form-enhancement.js';
import {
    cssEscape,
    executeScripts,
    focusAutofocus,
    syncHead
} from './document-navigation.js';

export {};

/**
 * Minimal document navigation enhancement: swaps the <main> content, updates
 * title/URL, restores scroll/focus, and can consume fragment responses from
 * enhanced POST forms.
 *
 * Opt out per-link with:
 * - data-no-client-nav
 * - data-client-nav="off"
 */
export function enableClientNav(): void {
    document.addEventListener('click', async (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            return;
        }

        const link = target.closest('a');
        if (!link || !(link instanceof HTMLAnchorElement)) {
            return;
        }

        if (hasClientNavOptOut(link)) {
            return;
        }

        const isExternal = link.origin !== window.location.origin;
        const opensInNewTab = link.getAttribute('target') === '_blank';
        const isDownload = link.hasAttribute('download');
        if (isExternal || opensInNewTab || isDownload) {
            return;
        }

        const isSameDocumentAnchor = link.hash
            && link.pathname === window.location.pathname
            && link.search === window.location.search;
        if (isSameDocumentAnchor) {
            return;
        }

        event.preventDefault();
        await renderUrl(link.href, { pushHistory: true });
    });

    document.addEventListener('submit', async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLFormElement)) {
            return;
        }

        if (target.hasAttribute(BYPASS_ATTR)) {
            target.removeAttribute(BYPASS_ATTR);
            return;
        }

        const submitEvent = event as SubmitEvent;
        const submitter = getSubmitter(submitEvent);
        const submission = createEnhancedFormSubmission(target, submitter);
        if (!submission) {
            return;
        }

        event.preventDefault();
        await submitForm(target, submitter, submission);
    });

    window.addEventListener('popstate', async () => {
        await renderUrl(window.location.href, { pushHistory: false });
    });
}

let activeRequestId = 0;
let activeController: AbortController | null = null;
const DYNAMIC_ATTR = 'data-webstir-dynamic';
const DYNAMIC_VALUE = 'client-nav';
const BYPASS_ATTR = 'data-webstir-client-nav-bypass';
const BASE_PATH = resolveBasePath();
const DOM_RUNTIME = {
    dynamicAttr: DYNAMIC_ATTR,
    dynamicValue: DYNAMIC_VALUE,
    withBasePath,
    stripBasePath
} as const;

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

async function renderUrl(url: string, { pushHistory }: { pushHistory: boolean }): Promise<void> {
    const { controller, requestId } = beginRequest();

    let response: Response;
    try {
        response = await fetch(url, {
            headers: { 'X-Webstir-Client-Nav': '1' },
            signal: controller.signal
        });
    } catch {
        if (controller.signal.aborted) {
            return;
        }

        window.location.href = url;
        return;
    }

    if (!response.ok) {
        window.location.href = url;
        return;
    }

    await renderDocumentResponse(response, requestId, {
        pushHistory,
        url
    });
}

async function submitForm(
    form: HTMLFormElement,
    submitter: HTMLButtonElement | HTMLInputElement | null,
    submission: { readonly url: string; readonly init: RequestInit }
): Promise<void> {
    const { controller, requestId } = beginRequest();

    let response: Response;
    try {
        response = await fetch(submission.url, {
            ...submission.init,
            signal: controller.signal
        });
    } catch {
        if (controller.signal.aborted) {
            return;
        }

        submitFormNatively(form, submitter);
        return;
    }

    if (requestId !== activeRequestId) {
        return;
    }

    const fragmentHandled = await handleFragmentResponse(response, requestId);
    if (fragmentHandled) {
        return;
    }

    if (isHtmlDocumentContentType(response.headers.get('content-type'))) {
        await renderDocumentResponse(response, requestId, {
            pushHistory: true,
            url: response.url || submission.url
        });
        return;
    }

    if (response.redirected && response.url) {
        window.location.href = response.url;
        return;
    }

    window.location.href = submission.url;
}

function beginRequest(): { readonly controller: AbortController; readonly requestId: number } {
    activeRequestId += 1;
    const requestId = activeRequestId;

    if (activeController) {
        activeController.abort();
    }

    const controller = new AbortController();
    activeController = controller;

    return { controller, requestId };
}

async function renderDocumentResponse(
    response: Response,
    requestId: number,
    options: { readonly pushHistory: boolean; readonly url: string }
): Promise<void> {
    const html = await response.text();
    if (requestId !== activeRequestId) {
        return;
    }

    await renderDocumentHtml(html, options);
}

async function renderDocumentHtml(
    html: string,
    options: { readonly pushHistory: boolean; readonly url: string }
): Promise<void> {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    await syncHead(doc, options.url, DOM_RUNTIME);

    const newMain = doc.querySelector('main');
    const currentMain = document.querySelector('main');
    if (newMain && currentMain) {
        currentMain.replaceWith(newMain);
    }

    const newTitle = doc.querySelector('title');
    if (newTitle && newTitle.textContent) {
        document.title = newTitle.textContent;
    }

    if (options.pushHistory) {
        window.history.pushState({}, '', options.url);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    focusAutofocus(document);

    executeScripts(document.querySelector('main'), DOM_RUNTIME);
    window.dispatchEvent(new CustomEvent('webstir:client-nav', { detail: { url: options.url } }));
}

function getSubmitter(event: SubmitEvent): HTMLButtonElement | HTMLInputElement | null {
    const candidate = event.submitter;
    if (candidate instanceof HTMLButtonElement || candidate instanceof HTMLInputElement) {
        return candidate;
    }
    return null;
}

function createEnhancedFormSubmission(
    form: HTMLFormElement,
    submitter: HTMLButtonElement | HTMLInputElement | null
): { readonly url: string; readonly init: RequestInit } | null {
    if (hasClientNavOptOut(form) || hasClientNavOptOut(submitter)) {
        return null;
    }

    const target = resolveFormTarget(form, submitter);
    if (target && target !== '_self') {
        return null;
    }

    const method = resolveFormMethod(form, submitter);
    if (normalizeFormMethod(method) !== 'POST') {
        return null;
    }

    const enctype = resolveFormEnctype(form, submitter);
    const action = resolveFormAction(form, submitter);
    if (new URL(action).origin !== window.location.origin) {
        return null;
    }
    const formData = createFormData(form, submitter);

    return buildEnhancedFormRequest({
        action,
        method,
        enctype,
        formData
    });
}

function hasClientNavOptOut(element: Element | null): boolean {
    if (!element) {
        return false;
    }

    const setting = element.getAttribute('data-client-nav');
    return element.hasAttribute('data-no-client-nav')
        || setting === 'off'
        || setting === 'false';
}

function resolveFormAction(form: HTMLFormElement, submitter: HTMLButtonElement | HTMLInputElement | null): string {
    const override = submitter?.getAttribute('formaction')?.trim();
    const action = override || form.getAttribute('action')?.trim() || window.location.href;
    return new URL(action, window.location.href).href;
}

function resolveFormMethod(form: HTMLFormElement, submitter: HTMLButtonElement | HTMLInputElement | null): string {
    return submitter?.getAttribute('formmethod') || form.getAttribute('method') || form.method || 'GET';
}

function resolveFormEnctype(form: HTMLFormElement, submitter: HTMLButtonElement | HTMLInputElement | null): string {
    const override = submitter?.getAttribute('formenctype');
    return normalizeFormEnctype(override || form.getAttribute('enctype') || form.enctype);
}

function resolveFormTarget(form: HTMLFormElement, submitter: HTMLButtonElement | HTMLInputElement | null): string {
    return submitter?.getAttribute('formtarget') || form.getAttribute('target') || form.target || '';
}

function createFormData(
    form: HTMLFormElement,
    submitter: HTMLButtonElement | HTMLInputElement | null
): FormData {
    try {
        if (submitter) {
            return new FormData(form, submitter);
        }
    } catch {
        // Fall through to the broader FormData constructor.
    }

    const formData = new FormData(form);
    if (submitter?.name && !formData.has(submitter.name)) {
        formData.append(submitter.name, submitter.value);
    }
    return formData;
}

async function handleFragmentResponse(response: Response, requestId: number): Promise<boolean> {
    const fragment = readFragmentResponseMetadata(response.headers);
    if (!fragment) {
        return false;
    }

    const target = resolveFragmentTarget(fragment.target, fragment.selector);
    if (!target) {
        return false;
    }

    const html = await response.text();
    if (requestId !== activeRequestId) {
        return true;
    }

    applyFragmentHtml(target, html, fragment.mode);
    focusAutofocus(target);
    window.dispatchEvent(new CustomEvent('webstir:fragment-update', {
        detail: {
            target: fragment.target,
            selector: fragment.selector,
            mode: fragment.mode
        }
    }));
    return true;
}

function resolveFragmentTarget(target: string, selector?: string): Element | null {
    if (selector) {
        return document.querySelector(selector);
    }

    const byId = document.getElementById(target);
    if (byId) {
        return byId;
    }

    return document.querySelector(`[data-webstir-fragment-target="${cssEscape(target)}"]`);
}

function applyFragmentHtml(target: Element, html: string, mode: 'replace' | 'append' | 'prepend'): void {
    const template = document.createElement('template');
    template.innerHTML = html;
    const insertedRoots = Array.from(template.content.children);

    if (mode === 'append') {
        target.append(template.content);
    } else if (mode === 'prepend') {
        target.prepend(template.content);
    } else {
        target.replaceChildren(template.content);
        executeScripts(target, DOM_RUNTIME);
        return;
    }

    for (const root of insertedRoots) {
        executeScripts(root, DOM_RUNTIME);
    }
}

function submitFormNatively(
    form: HTMLFormElement,
    submitter: HTMLButtonElement | HTMLInputElement | null
): void {
    form.setAttribute(BYPASS_ATTR, 'true');
    if (submitter && typeof form.requestSubmit === 'function') {
        form.requestSubmit(submitter);
        return;
    }
    window.setTimeout(() => {
        form.removeAttribute(BYPASS_ATTR);
    }, 0);
    form.submit();
}

enableClientNav();
