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
  isSameFormSubmission,
  snapshotFormSubmission,
  type FormSubmissionSnapshot,
} from './form-enhancement.js';
import {
  executeScripts,
  focusAutofocus,
  resolveDocumentNavigationResponse,
  resolveRedirectNavigation,
  loadHeadScripts,
  syncHead,
  type HistoryMode,
} from './document-navigation.js';
import { handleFragmentResponse, resolveFragmentTarget } from './fragment-update.js';
import { syncHeadMetadata } from './head-metadata.js';
import { restoreReferrerPolicy, trackReferrerPolicy } from './referrer-policy.js';

export {};

/**
 * Minimal document navigation enhancement: swaps the <main> content, updates
 * title, page metadata and URL, restores scroll/focus, and can consume fragment responses from
 * enhanced POST forms.
 *
 * Opt out per-link with:
 * - data-no-client-nav
 * - data-client-nav="off"
 */
export function enableClientNav(): void {
  if (enabled) return;
  enabled = true;
  trackReferrerPolicy();
  const initial = () => {
    const requestId = activeRequestId;
    void startPage(window.location.href)
      .catch(console.error)
      .finally(() => finishRequest(requestId));
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
    await renderUrl(link.href, { history: 'push' });
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
    await renderUrl(url.href, { history: 'none' });
  });
}

let enabled = false;
let documentUrl = new URL(window.location.href);
const pageLifecycle = createPageLifecycle();
let pageGeneration = 0;
let commitQueue = Promise.resolve();
// Settles once the current page's setup has finished.
let pageSettled: Promise<void> = Promise.resolve();
// Set once this document is being replaced by a full load.
let leaving = false;
// Forms whose submission is still in flight, so a second click sends the same submission.
const pendingSubmissions = new WeakMap<
  HTMLFormElement,
  { readonly id: string; readonly snapshot: FormSubmissionSnapshot }
>();

async function startPage(url: string, prepared?: PreparedPage): Promise<void> {
  const generation = ++pageGeneration;
  // A page without setup is ready as soon as it is on screen.
  pageSettled = Promise.resolve();
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
    pageSettled = pageLifecycle.start(module.setup, root, url, prepared?.data);
}

let activeRequestId = 0;
let activeController: AbortController | null = null;
const DYNAMIC_ATTR = 'data-webstir-dynamic';
const DYNAMIC_VALUE = 'client-nav';
const BYPASS_ATTR = 'data-webstir-client-nav-bypass';
const READY_ATTR = 'data-webstir-ready';
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
  { history, hops = 0 }: { history: HistoryMode; hops?: number },
): Promise<void> {
  const { controller, requestId } = beginRequest();
  try {
    await renderUrlRequest(url, { history, hops }, controller, requestId);
  } finally {
    await finishRequest(requestId);
  }
}

async function renderUrlRequest(
  url: string,
  { history, hops }: { history: HistoryMode; hops: number },
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

    leave(url);
    return;
  }

  if (requestId !== activeRequestId) return;
  const next = response.headers.get(CLIENT_NAV_HEADERS.location);
  if (next) {
    await followLocation(next, url, hops, history);
    return;
  }
  if (response.redirected) {
    leave(response.url);
    return;
  }

  const resolution = resolveDocumentNavigationResponse({
    ok: response.ok,
    contentType: response.headers.get('content-type'),
  });
  if (resolution.kind === 'navigate') {
    leave(url);
    return;
  }

  await renderDocumentResponse(response, requestId, {
    history,
    url,
  });
}

async function submitForm(
  form: HTMLFormElement,
  submitter: HTMLButtonElement | HTMLInputElement | null,
  submission: EnhancedFormSubmission,
): Promise<void> {
  const { controller, requestId } = beginRequest();
  const pending = { id: submission.submissionId ?? '', snapshot: submission.snapshot };
  pendingSubmissions.set(form, pending);
  try {
    await submitFormRequest(form, submitter, submission, controller, requestId);
  } finally {
    if (pendingSubmissions.get(form) === pending) pendingSubmissions.delete(form);
    await finishRequest(requestId);
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

    // The post may have reached the server; if its action redirected, the same submission id
    // lets the server send the resend there instead of running the action again.
    submitFormNatively(form, submitter, submission.submissionId);
    return;
  }

  if (requestId !== activeRequestId) {
    return;
  }

  const next = response.headers.get(CLIENT_NAV_HEADERS.location);
  if (next) {
    await followLocation(next, submission.url, 0, 'push');
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
      history: 'push',
      url: resolveDocumentResponseUrl({
        contentLocation: response.headers.get('content-location'),
        responseUrl: response.url,
        requestUrl: submission.url,
      }),
    });
    return;
  }

  leave(resolution.location);
}

function beginRequest(): { readonly controller: AbortController; readonly requestId: number } {
  // A full load that turned out to be a download left this document in place.
  leaving = false;
  setBusy(true);
  setReady(false);
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
  options: { readonly history: HistoryMode; readonly url: string },
): Promise<void> {
  let html: string;
  try {
    html = await response.text();
  } catch {
    if (requestId === activeRequestId) leave(options.url);
    return;
  }
  if (requestId !== activeRequestId) return;

  const doc = new DOMParser().parseFromString(html, 'text/html');
  restoreReferrerPolicy(doc);
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
      leave(options.url);
      return;
    }
  }
  const referrerPolicy = response.headers.get('referrer-policy');
  const commit = commitQueue.then(async () => {
    if (requestId !== activeRequestId) return;
    await renderDocumentHtml(doc, { ...options, referrerPolicy }, requestId, prepared);
  });
  commitQueue = commit.catch(() => {});
  try {
    await commit;
  } catch (error) {
    console.error(error);
    if (requestId === activeRequestId) leave(options.url);
  }
}

async function renderDocumentHtml(
  doc: Document,
  options: {
    readonly history: HistoryMode;
    readonly url: string;
    readonly referrerPolicy: string | null;
  },
  requestId: number,
  prepared?: PreparedPage,
): Promise<void> {
  if (!doc.querySelector('main') || !document.querySelector('main')) {
    leave(options.url);
    return;
  }
  ++pageGeneration;
  await pageLifecycle.dispose();
  await syncHead(doc, options.url, DOM_RUNTIME, documentUrl.href);
  if (requestId !== activeRequestId) return;

  // The address, then the page's referrer policy, change before its content goes in and in the
  // same task, so its scripts and content request from its address under its policy, as in a full
  // load, and nothing on screen runs under an address or policy that is not its own.
  if (options.history === 'push') {
    window.history.pushState({}, '', options.url);
  } else if (options.history === 'replace') {
    window.history.replaceState({}, '', options.url);
  }
  documentUrl = new URL(options.url);
  syncHeadMetadata(doc, options.url, options.referrerPolicy);
  const newMain = doc.querySelector('main');
  const currentMain = document.querySelector('main');
  if (newMain && currentMain) {
    currentMain.replaceWith(newMain);
  }
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
  // The page's own script may have rendered the #fragment's target, or focused something else.
  fragmentTarget(documentUrl.hash)?.scrollIntoView();
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
  readonly snapshot: FormSubmissionSnapshot;
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
  // A second click while the first is in flight sends the same submission, so the server answers
  // it once; a changed form is a new one.
  const snapshot = snapshotFormSubmission(action, enctype, formData);
  const pending = pendingSubmissions.get(form);
  const request = buildEnhancedFormRequest({
    action,
    method,
    enctype,
    formData,
    submissionId:
      pending && isSameFormSubmission(pending.snapshot, snapshot) ? pending.id : newSubmissionId(),
  });
  return request ? { ...request, snapshot } : null;
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
  leaving = true;
  setBusy(false);
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

/** Goes where the server said a redirect leads, keeping its #fragment. */
async function followLocation(
  location: string,
  base: string,
  hops: number,
  history: HistoryMode,
): Promise<void> {
  const next = resolveRedirectNavigation({
    location,
    base,
    origin: window.location.origin,
    hops,
    history,
  });
  if (next.kind === 'refuse') {
    console.error(`client-nav: refused to follow a redirect to ${next.location}`);
  } else if (next.kind === 'load') {
    leave(next.url);
  } else {
    await renderUrl(next.url, { history: next.history, hops: hops + 1 });
  }
}

/** Replaces this document with a full load. */
function leave(url: string): void {
  leaving = true;
  setBusy(false);
  window.location.href = url;
}

/**
 * Ends a navigation that is still the current one: the page is no longer busy, and once its script
 * has finished setting up it is marked ready. A document being replaced stays unready.
 */
async function finishRequest(requestId: number): Promise<void> {
  if (requestId !== activeRequestId || leaving) return;
  setBusy(false);
  await pageSettled;
  if (requestId === activeRequestId && !leaving) setReady(true);
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

/**
 * `<html data-webstir-ready>` is there once the page's own script has run, on the first load and
 * after every navigation: the one signal for anything (a test, say) that must wait for a page.
 */
function setReady(ready: boolean): void {
  document.documentElement.toggleAttribute(READY_ATTR, ready);
}

function newSubmissionId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

enableClientNav();
