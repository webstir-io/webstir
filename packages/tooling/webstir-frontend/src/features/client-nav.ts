import {
  createPageLifecycle,
  preparePage,
  type LoadablePage,
  type PreparedPage,
  type PageSetup,
} from '../runtime/index.js';
import {
  CLIENT_NAV_HEADERS,
  CLIENT_NAV_SUBMISSION_FIELD,
} from '@webstir-io/module-contract/client-nav';
import {
  buildEnhancedFormRequest,
  normalizeFormEnctype,
  normalizeFormMethod,
  resolveDocumentResponseUrl,
  resolveEnhancedFormResponse,
  resolveFragmentResponseMetadata,
  resolveFragmentInsertionBehavior,
} from './form-enhancement.js';
import {
  cssEscape,
  executeScripts,
  focusAutofocus,
  resolveDocumentNavigationResponse,
  loadHeadScripts,
  syncHead,
} from './document-navigation.js';
import { handleFragmentResponse, resolveFragmentTarget } from './fragment-update.js';

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
  if (enabled) return;
  enabled = true;
  // The page is busy until its own script has run, on the first load and after every navigation:
  // the one signal for anything (a test, say) that must wait for a page to be ready.
  setBusy(true);
  const initial = () => {
    const requestId = activeRequestId;
    void startPage(window.location.href)
      .catch(console.error)
      .finally(() => {
        if (requestId === activeRequestId) setBusy(false);
      });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initial, { once: true });
  } else {
    initial();
  }
  document.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (
      event.button !== 0 ||
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
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
    const targetName = link.getAttribute('target') || document.querySelector('base')?.target;
    const opensInNewTab = Boolean(targetName && targetName !== '_self');
    const isDownload = link.hasAttribute('download');
    if (
      !link.hasAttribute('href') ||
      !['http:', 'https:'].includes(link.protocol) ||
      isExternal ||
      opensInNewTab ||
      isDownload
    ) {
      return;
    }

    const isSameDocumentAnchor =
      link.hash &&
      link.pathname === window.location.pathname &&
      link.search === window.location.search;
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
    const url = new URL(window.location.href);
    if (url.pathname + url.search === documentUrl.pathname + documentUrl.search) return;
    await renderUrl(url.href, { pushHistory: false });
  });
}

let enabled = false;
let documentUrl = new URL(window.location.href);
const pageLifecycle = createPageLifecycle();
let pageGeneration = 0;
let commitQueue = Promise.resolve();

async function startPage(url: string, prepared?: PreparedPage): Promise<void> {
  const generation = ++pageGeneration;
  const script = document.querySelector<HTMLScriptElement>('script[data-webstir-page][src]');
  const root = document.querySelector('main');
  if (!root || (!prepared && !script)) return;
  if (!prepared && script?.hasAttribute('data-webstir-load')) {
    activeController ??= new AbortController();
    const controller = activeController;
    try {
      prepared = await preparePage(
        import(script.src) as Promise<LoadablePage>,
        url,
        controller.signal,
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      throw error;
    }
  }
  const module = prepared?.module ?? ((await import(script!.src)) as { setup?: PageSetup });
  if (generation !== pageGeneration || !root.isConnected) return;
  if (typeof module.setup === 'function')
    pageLifecycle.start(module.setup, root, url, prepared?.data);
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
  stripBasePath,
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
  if (
    value === BASE_PATH ||
    value.startsWith(`${BASE_PATH}/`) ||
    value.startsWith(`${BASE_PATH}?`) ||
    value.startsWith(`${BASE_PATH}#`)
  ) {
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
  if (
    value.startsWith(`${BASE_PATH}/`) ||
    value.startsWith(`${BASE_PATH}?`) ||
    value.startsWith(`${BASE_PATH}#`)
  ) {
    return value.slice(BASE_PATH.length);
  }
  return value;
}

async function renderUrl(
  url: string,
  { pushHistory, hops = 0 }: { pushHistory: boolean; hops?: number },
): Promise<void> {
  const { controller, requestId } = beginRequest();
  try {
    await renderUrlRequest(url, { pushHistory, hops }, controller, requestId);
  } finally {
    if (requestId === activeRequestId) setBusy(false);
  }
}

async function renderUrlRequest(
  url: string,
  { pushHistory, hops }: { pushHistory: boolean; hops: number },
  controller: AbortController,
  requestId: number,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { [CLIENT_NAV_HEADERS.request]: '1', [CLIENT_NAV_HEADERS.acceptLocation]: '1' },
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) {
      return;
    }

    window.location.href = url;
    return;
  }

  if (requestId !== activeRequestId) return;
  const next = response.headers.get(CLIENT_NAV_HEADERS.location);
  if (next) {
    await followLocation(next, url, hops);
    return;
  }
  if (response.redirected) {
    window.location.href = response.url;
    return;
  }

  const resolution = resolveDocumentNavigationResponse({
    ok: response.ok,
    contentType: response.headers.get('content-type'),
  });
  if (resolution.kind === 'navigate') {
    window.location.href = url;
    return;
  }

  await renderDocumentResponse(response, requestId, {
    pushHistory,
    url,
  });
}

async function submitForm(
  form: HTMLFormElement,
  submitter: HTMLButtonElement | HTMLInputElement | null,
  submission: EnhancedFormSubmission,
): Promise<void> {
  const { controller, requestId } = beginRequest();
  try {
    await submitFormRequest(form, submitter, submission, controller, requestId);
  } finally {
    if (requestId === activeRequestId) setBusy(false);
  }
}

async function submitFormRequest(
  form: HTMLFormElement,
  submitter: HTMLButtonElement | HTMLInputElement | null,
  submission: EnhancedFormSubmission,
  controller: AbortController,
  requestId: number,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(submission.url, {
      ...submission.init,
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) {
      return;
    }

    // The post may have reached the server; the same submission id lets it answer the resend
    // with the first result instead of running the action again.
    submitFormNatively(form, submitter, submission.submissionId);
    return;
  }

  if (requestId !== activeRequestId) {
    return;
  }

  const next = response.headers.get(CLIENT_NAV_HEADERS.location);
  if (next) {
    await followLocation(next, submission.url, 0);
    return;
  }

  const metadata = resolveFragmentResponseMetadata(response.headers);
  const fragmentTarget =
    metadata.kind === 'fragment'
      ? resolveFragmentTarget(metadata.fragment.target, metadata.fragment.selector)
      : null;
  const resolution = resolveEnhancedFormResponse({
    metadata,
    hasFragmentTarget: fragmentTarget !== null,
    contentType: response.headers.get('content-type'),
    redirected: response.redirected,
    responseUrl: response.url,
    requestUrl: submission.url,
  });

  if (resolution.kind === 'fragment') {
    await handleFragmentResponse(
      response,
      resolution.fragment,
      fragmentTarget,
      () => requestId === activeRequestId,
      DOM_RUNTIME,
    );
    return;
  }

  if (resolution.kind === 'document') {
    await renderDocumentResponse(response, requestId, {
      pushHistory: true,
      url: resolveDocumentResponseUrl({
        contentLocation: response.headers.get('content-location'),
        responseUrl: response.url,
        requestUrl: submission.url,
      }),
    });
    return;
  }

  window.location.href = resolution.location;
}

function beginRequest(): { readonly controller: AbortController; readonly requestId: number } {
  setBusy(true);
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
  options: { readonly pushHistory: boolean; readonly url: string },
): Promise<void> {
  let html: string;
  try {
    html = await response.text();
  } catch {
    if (requestId === activeRequestId) window.location.href = options.url;
    return;
  }
  if (requestId !== activeRequestId) return;

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const script = doc.querySelector<HTMLScriptElement>(
    'script[data-webstir-page][data-webstir-load][src]',
  );
  let prepared: PreparedPage | undefined;
  if (script) {
    const signal = activeController!.signal;
    try {
      const src = new URL(script.getAttribute('src')!, options.url).href;
      prepared = await preparePage(import(src) as Promise<LoadablePage>, options.url, signal);
    } catch (error) {
      if (signal.aborted || requestId !== activeRequestId) return;
      console.error(error);
      window.location.href = options.url;
      return;
    }
  }
  const commit = commitQueue.then(async () => {
    if (requestId !== activeRequestId) return;
    await renderDocumentHtml(doc, options, requestId, prepared);
  });
  commitQueue = commit.catch(() => {});
  try {
    await commit;
  } catch (error) {
    console.error(error);
    if (requestId === activeRequestId) window.location.href = options.url;
  }
}

async function renderDocumentHtml(
  doc: Document,
  options: { readonly pushHistory: boolean; readonly url: string },
  requestId: number,
  prepared?: PreparedPage,
): Promise<void> {
  if (!doc.querySelector('main') || !document.querySelector('main')) {
    window.location.href = options.url;
    return;
  }
  ++pageGeneration;
  await pageLifecycle.dispose();
  await syncHead(doc, options.url, DOM_RUNTIME);
  if (requestId !== activeRequestId) return;

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
  documentUrl = new URL(options.url);
  const anchor = fragmentTarget(documentUrl.hash);
  if (anchor) {
    anchor.scrollIntoView();
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  focusAutofocus(document);

  // Opted-in pages render prepared data before yielding to additional document scripts.
  if (prepared) await startPage(options.url, prepared);
  await loadHeadScripts(doc, options.url, DOM_RUNTIME, activeController?.signal);
  if (requestId !== activeRequestId) return;
  await executeScripts(document.querySelector('main'), DOM_RUNTIME, activeController?.signal);
  if (requestId !== activeRequestId) return;
  if (!prepared) await startPage(options.url);
  if (requestId !== activeRequestId) return;
  window.dispatchEvent(new CustomEvent('webstir:client-nav', { detail: { url: options.url } }));
}

function getSubmitter(event: SubmitEvent): HTMLButtonElement | HTMLInputElement | null {
  const candidate = event.submitter;
  if (candidate instanceof HTMLButtonElement || candidate instanceof HTMLInputElement) {
    return candidate;
  }
  return null;
}

type EnhancedFormSubmission = {
  readonly url: string;
  readonly init: RequestInit;
  readonly submissionId?: string;
};

function createEnhancedFormSubmission(
  form: HTMLFormElement,
  submitter: HTMLButtonElement | HTMLInputElement | null,
): EnhancedFormSubmission | null {
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
    formData,
    submissionId: newSubmissionId(),
  });
}

function hasClientNavOptOut(element: Element | null): boolean {
  if (!element) {
    return false;
  }

  const setting = element.getAttribute('data-client-nav');
  return element.hasAttribute('data-no-client-nav') || setting === 'off' || setting === 'false';
}

function resolveFormAction(
  form: HTMLFormElement,
  submitter: HTMLButtonElement | HTMLInputElement | null,
): string {
  const override = submitter?.getAttribute('formaction')?.trim();
  const action = override || form.getAttribute('action')?.trim() || window.location.href;
  return new URL(action, window.location.href).href;
}

function resolveFormMethod(
  form: HTMLFormElement,
  submitter: HTMLButtonElement | HTMLInputElement | null,
): string {
  return (
    submitter?.getAttribute('formmethod') || form.getAttribute('method') || form.method || 'GET'
  );
}

function resolveFormEnctype(
  form: HTMLFormElement,
  submitter: HTMLButtonElement | HTMLInputElement | null,
): string {
  const override = submitter?.getAttribute('formenctype');
  return normalizeFormEnctype(override || form.getAttribute('enctype') || form.enctype);
}

function resolveFormTarget(
  form: HTMLFormElement,
  submitter: HTMLButtonElement | HTMLInputElement | null,
): string {
  return submitter?.getAttribute('formtarget') || form.getAttribute('target') || form.target || '';
}

function createFormData(
  form: HTMLFormElement,
  submitter: HTMLButtonElement | HTMLInputElement | null,
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

function submitFormNatively(
  form: HTMLFormElement,
  submitter: HTMLButtonElement | HTMLInputElement | null,
  submissionId?: string,
): void {
  form.setAttribute(BYPASS_ATTR, 'true');
  if (submissionId) {
    const field = document.createElement('input');
    field.type = 'hidden';
    field.name = CLIENT_NAV_SUBMISSION_FIELD;
    field.value = submissionId;
    form.append(field);
    window.setTimeout(() => field.remove(), 0);
  }
  if (submitter && typeof form.requestSubmit === 'function') {
    form.requestSubmit(submitter);
    return;
  }
  window.setTimeout(() => {
    form.removeAttribute(BYPASS_ATTR);
  }, 0);
  form.submit();
}

/** Goes where the server said a redirect leads, keeping its #fragment; another origin loads in full. */
async function followLocation(location: string, base: string, hops: number): Promise<void> {
  const target = new URL(location, base);
  if (target.origin !== window.location.origin || hops >= 10) {
    window.location.href = target.href;
    return;
  }
  await renderUrl(target.href, { pushHistory: true, hops: hops + 1 });
}

function fragmentTarget(hash: string): Element | null {
  if (hash.length <= 1) return null;
  try {
    return document.getElementById(decodeURIComponent(hash.slice(1)));
  } catch {
    return null;
  }
}

function setBusy(busy: boolean): void {
  if (busy) {
    document.documentElement.setAttribute('aria-busy', 'true');
  } else {
    document.documentElement.removeAttribute('aria-busy');
  }
}

function newSubmissionId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

enableClientNav();
