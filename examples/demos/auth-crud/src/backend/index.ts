import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type IncomingRequest = http.IncomingMessage;
type ServerResponse = http.ServerResponse<IncomingRequest>;

const DEMO_PATH = '/demo/auth-crud';
const SHELL_TARGET = 'backoffice-shell';
const SESSION_COOKIE_NAME = 'webstir_demo_auth_crud';
const SIGN_IN_ACTION = './auth-crud/session/sign-in';
const SIGN_OUT_ACTION = './auth-crud/session/sign-out';
const CREATE_PROJECT_ACTION = './auth-crud/projects/create';
const UPDATE_PROJECT_ACTION = './auth-crud/projects/update';
const DELETE_PROJECT_ACTION = './auth-crud/projects/delete';
const DEV_FRONTEND_ASSETS = {
  cssHref: '/app/app.css',
  scriptSrc: '/app/app.js'
} as const;
const SESSION_MAX_AGE_SECONDS = 60 * 60;
const CSRF_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000;
const GENERATED_CSRF_SECRET = randomBytes(32).toString('base64url');

type ProjectStatus = 'draft' | 'active' | 'archived';
type FlashLevel = 'info' | 'success' | 'warning' | 'error';
type FormIssueCode = 'validation' | 'auth' | 'csrf';

interface RouteMatch {
  readonly name: string;
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly summary: string;
  readonly interaction?: 'navigation' | 'mutation';
  readonly form?: {
    readonly contentType: 'application/x-www-form-urlencoded';
    readonly csrf?: boolean;
  };
  readonly fragment?: {
    readonly target: string;
    readonly selector?: string;
    readonly mode?: 'replace' | 'append' | 'prepend';
  };
}

interface RouteContext {
  readonly request: IncomingRequest;
  readonly reply: ServerResponse;
  readonly query: Record<string, string>;
  readonly body: unknown;
}

interface RouteResult {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
  readonly redirect?: {
    readonly location: string;
  };
  readonly fragment?: {
    readonly target: string;
    readonly selector?: string;
    readonly mode?: 'replace' | 'append' | 'prepend';
    readonly body: unknown;
  };
}

interface DemoRoute {
  readonly definition?: RouteMatch;
  readonly handler?: (context: RouteContext) => Promise<RouteResult> | RouteResult;
}

interface DemoProject {
  readonly id: string;
  title: string;
  notes: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

interface FlashMessage {
  readonly key: string;
  readonly level: FlashLevel;
  readonly text: string;
}

interface FormIssue {
  readonly code: FormIssueCode;
  readonly message: string;
  readonly field?: string;
}

interface FormState {
  readonly values: Record<string, string>;
  readonly issues: readonly FormIssue[];
}

interface DemoSession {
  readonly id: string;
  auth: {
    email: string;
  } | null;
  projects: DemoProject[];
  flash: FlashMessage[];
  formStates: Record<string, FormState>;
}

interface PageState {
  readonly flash: readonly FlashMessage[];
  readonly formStates: Record<string, FormState>;
}

interface SessionAccess {
  readonly session: DemoSession;
  readonly setCookie?: string;
}

type BunCookieMapInstance = {
  get(name: string): string | null;
  set(options: {
    name: string;
    value: string;
    path?: string;
    httpOnly?: boolean;
    sameSite?: 'lax' | 'strict' | 'none';
    maxAge?: number;
    expires?: Date | number | string;
  }): void;
  toSetCookieHeaders(): string[];
};

type BunCookieMapConstructor = new (
  init?: string[][] | Record<string, string> | string
) => BunCookieMapInstance;

type BunCsrfApi = {
  generate(secret?: string, options?: { expiresIn?: number }): string;
  verify(token: string, options?: { secret?: string; maxAge?: number }): boolean;
};

type BunRuntime = {
  CookieMap?: BunCookieMapConstructor;
  CSRF?: BunCsrfApi;
};

const FORM_IDS = {
  signIn: 'sign-in',
  signOut: 'sign-out',
  createProject: 'create-project',
  updateProject: (projectId: string) => `update-project:${projectId}`,
  deleteProject: (projectId: string) => `delete-project:${projectId}`
} as const;

const sessionStore = new Map<string, DemoSession>();

const pageRoute: DemoRoute = {
  definition: {
    name: 'authCrudPage',
    method: 'GET',
    path: DEMO_PATH,
    summary: 'Render the auth and CRUD proof application.',
    interaction: 'navigation'
  },
  handler: (context) => {
    const access = resolveSession(context.request);
    const pageState = consumePageState(access.session);

    return {
      status: 200,
      headers: withSessionCookie(access.setCookie),
      body: renderDemoPage(access.session, pageState)
    };
  }
};

const signInRoute: DemoRoute = {
  definition: {
    name: 'authCrudSignIn',
    method: 'POST',
    path: `${DEMO_PATH}/session/sign-in`,
    summary: 'Create a session for the auth and CRUD proof application.',
    interaction: 'mutation',
    form: {
      contentType: 'application/x-www-form-urlencoded',
      csrf: true
    },
    fragment: {
      target: SHELL_TARGET,
      selector: `#${SHELL_TARGET}`,
      mode: 'replace'
    }
  },
  handler: (context) => {
    const access = resolveSession(context.request);
    const values = normalizeFormValues(context.body);
    const issues = validateCsrf(access.session, FORM_IDS.signIn, values).concat(validateSignIn(values));

    if (issues.length > 0) {
      storeFormState(access.session, FORM_IDS.signIn, values, issues);
      return respondWithShell(context.request, access, statusFromIssues(issues));
    }

    clearFormState(access.session, FORM_IDS.signIn);
    access.session.auth = {
      email: values.email.trim()
    };
    if (access.session.projects.length === 0) {
      access.session.projects = createSeedProjects();
    }
    pushFlash(access.session, {
      key: 'signed-in',
      level: 'success',
      text: `Signed in as ${values.email.trim()}.`
    });

    return respondWithShell(context.request, access, 200);
  }
};

const signOutRoute: DemoRoute = {
  definition: {
    name: 'authCrudSignOut',
    method: 'POST',
    path: `${DEMO_PATH}/session/sign-out`,
    summary: 'Clear the session for the auth and CRUD proof application.',
    interaction: 'mutation',
    form: {
      contentType: 'application/x-www-form-urlencoded',
      csrf: true
    },
    fragment: {
      target: SHELL_TARGET,
      selector: `#${SHELL_TARGET}`,
      mode: 'replace'
    }
  },
  handler: (context) => {
    const access = resolveSession(context.request);
    const values = normalizeFormValues(context.body);
    const issues = validateCsrf(access.session, FORM_IDS.signOut, values);

    if (issues.length > 0) {
      pushFlash(access.session, {
        key: 'sign-out-blocked',
        level: 'error',
        text: issues[0]?.message ?? 'Sign out failed.'
      });
      return respondWithShell(context.request, access, statusFromIssues(issues));
    }

    access.session.auth = null;
    access.session.formStates = {};
    pushFlash(access.session, {
      key: 'signed-out',
      level: 'info',
      text: 'Signed out. Create, edit, and delete actions now require auth again.'
    });

    return respondWithShell(context.request, access, 200);
  }
};

const createProjectRoute: DemoRoute = {
  definition: {
    name: 'authCrudCreateProject',
    method: 'POST',
    path: `${DEMO_PATH}/projects/create`,
    summary: 'Create a project in the auth and CRUD proof application.',
    interaction: 'mutation',
    form: {
      contentType: 'application/x-www-form-urlencoded',
      csrf: true
    },
    fragment: {
      target: SHELL_TARGET,
      selector: `#${SHELL_TARGET}`,
      mode: 'replace'
    }
  },
  handler: (context) => {
    const access = resolveSession(context.request);
    const values = normalizeFormValues(context.body);
    const issues = validateCsrf(access.session, FORM_IDS.createProject, values).concat(
      validateProjectMutation(access.session, values)
    );

    if (issues.length > 0) {
      storeFormState(access.session, FORM_IDS.createProject, values, issues);
      return respondWithShell(context.request, access, statusFromIssues(issues));
    }

    clearFormState(access.session, FORM_IDS.createProject);
    access.session.projects.unshift({
      id: createProjectId(),
      title: values.title.trim(),
      notes: values.notes.trim(),
      status: normalizeProjectStatus(values.status),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    pushFlash(access.session, {
      key: 'project-created',
      level: 'success',
      text: `Created project "${values.title.trim()}".`
    });

    return respondWithShell(context.request, access, 200);
  }
};

const updateProjectRoute: DemoRoute = {
  definition: {
    name: 'authCrudUpdateProject',
    method: 'POST',
    path: `${DEMO_PATH}/projects/update`,
    summary: 'Update a project in the auth and CRUD proof application.',
    interaction: 'mutation',
    form: {
      contentType: 'application/x-www-form-urlencoded',
      csrf: true
    },
    fragment: {
      target: SHELL_TARGET,
      selector: `#${SHELL_TARGET}`,
      mode: 'replace'
    }
  },
  handler: (context) => {
    const access = resolveSession(context.request);
    const values = normalizeFormValues(context.body);
    const projectId = values.projectId.trim();
    const formId = FORM_IDS.updateProject(projectId || 'missing');
    const issues = validateCsrf(access.session, formId, values).concat(
      validateProjectMutation(access.session, values)
    );
    const project = access.session.projects.find((candidate) => candidate.id === projectId);

    if (!projectId || !project) {
      pushFlash(access.session, {
        key: 'project-missing',
        level: 'warning',
        text: 'The requested project could not be found.'
      });
      return respondWithShell(context.request, access, 404);
    }

    if (issues.length > 0) {
      storeFormState(access.session, formId, values, issues);
      return respondWithShell(context.request, access, statusFromIssues(issues));
    }

    clearFormState(access.session, formId);
    project.title = values.title.trim();
    project.notes = values.notes.trim();
    project.status = normalizeProjectStatus(values.status);
    project.updatedAt = new Date().toISOString();
    pushFlash(access.session, {
      key: 'project-updated',
      level: 'success',
      text: `Updated project "${project.title}".`
    });

    return respondWithShell(context.request, access, 200);
  }
};

const deleteProjectRoute: DemoRoute = {
  definition: {
    name: 'authCrudDeleteProject',
    method: 'POST',
    path: `${DEMO_PATH}/projects/delete`,
    summary: 'Delete a project from the auth and CRUD proof application.',
    interaction: 'mutation',
    form: {
      contentType: 'application/x-www-form-urlencoded',
      csrf: true
    },
    fragment: {
      target: SHELL_TARGET,
      selector: `#${SHELL_TARGET}`,
      mode: 'replace'
    }
  },
  handler: (context) => {
    const access = resolveSession(context.request);
    const values = normalizeFormValues(context.body);
    const projectId = values.projectId.trim();
    const formId = FORM_IDS.deleteProject(projectId || 'missing');
    const issues = validateCsrf(access.session, formId, values);
    const projectIndex = access.session.projects.findIndex((candidate) => candidate.id === projectId);

    if (projectIndex < 0) {
      pushFlash(access.session, {
        key: 'project-missing',
        level: 'warning',
        text: 'The requested project could not be found.'
      });
      return respondWithShell(context.request, access, 404);
    }

    if (!access.session.auth) {
      pushFlash(access.session, {
        key: 'auth-required',
        level: 'error',
        text: 'Sign in required to delete projects.'
      });
      return respondWithShell(context.request, access, 401);
    }

    if (issues.length > 0) {
      pushFlash(access.session, {
        key: 'delete-blocked',
        level: 'error',
        text: issues[0]?.message ?? 'Delete failed.'
      });
      return respondWithShell(context.request, access, statusFromIssues(issues));
    }

    const [deleted] = access.session.projects.splice(projectIndex, 1);
    clearFormState(access.session, FORM_IDS.updateProject(projectId));
    clearFormState(access.session, formId);
    pushFlash(access.session, {
      key: 'project-deleted',
      level: 'success',
      text: `Deleted project "${deleted?.title ?? 'Untitled'}".`
    });

    return respondWithShell(context.request, access, 200);
  }
};

const routes: readonly DemoRoute[] = [
  pageRoute,
  signInRoute,
  signOutRoute,
  createProjectRoute,
  updateProjectRoute,
  deleteProjectRoute
];

export const module = {
  manifest: {
    contractVersion: '1.0.0',
    name: '@demo/auth-crud',
    version: '1.0.0',
    kind: 'backend',
    capabilities: ['http'],
    routes: routes.map((route) => route.definition)
  },
  routes
};

const PORT = Number(process.env.PORT || 4321);

const server = http.createServer((request, response) => {
  void handleRequest(request, response);
});

if (isExecutedAsEntrypoint()) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`API server running at http://localhost:${PORT}`);
  });
}

async function handleRequest(request: IncomingRequest, response: ServerResponse): Promise<void> {
  if (!request.url) {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'bad_request' }));
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
  if (url.pathname === '/') {
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end('API server running');
    return;
  }

  const route = findRoute(url.pathname, request.method ?? 'GET');
  if (!route?.handler) {
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  const body = await readBody(request);
  const result = await route.handler({
    request,
    reply: response,
    query: Object.fromEntries(url.searchParams.entries()),
    body
  });

  sendRouteResponse(response, result);
}

function isExecutedAsEntrypoint(): boolean {
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    return false;
  }

  return import.meta.url === pathToFileURL(entrypoint).href;
}

function findRoute(pathname: string, method: string): DemoRoute | undefined {
  const normalizedMethod = method.toUpperCase();
  return routes.find((route) =>
    route.definition?.path === pathname && route.definition?.method === normalizedMethod
  );
}

async function readBody(request: IncomingRequest): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString('utf8');
  if (!rawBody) {
    return undefined;
  }

  const contentType = String(request.headers['content-type'] ?? '').toLowerCase();
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(rawBody).entries());
  }

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(rawBody) as unknown;
    } catch {
      return rawBody;
    }
  }

  return rawBody;
}

function respondWithShell(
  request: IncomingRequest,
  access: SessionAccess,
  status: number
): RouteResult {
  const headers = withSessionCookie(access.setCookie);
  if (isEnhancedRequest(request)) {
    return {
      status,
      headers,
      fragment: {
        target: SHELL_TARGET,
        selector: `#${SHELL_TARGET}`,
        mode: 'replace',
        body: renderBackofficeShell(access.session, peekPageState(access.session))
      }
    };
  }

  return {
    status: 303,
    headers,
    redirect: {
      location: DEMO_PATH
    }
  };
}

function withSessionCookie(setCookie: string | undefined): Record<string, string> | undefined {
  return setCookie ? { 'set-cookie': setCookie } : undefined;
}

function resolveSession(request: IncomingRequest): SessionAccess {
  const existingId = readCookie(request.headers.cookie, SESSION_COOKIE_NAME);
  const existing = existingId ? sessionStore.get(existingId) : undefined;
  if (existing) {
    return { session: existing };
  }

  const session = createSession();
  sessionStore.set(session.id, session);

  return {
    session,
    setCookie: createSessionCookie(session.id)
  };
}

function createSession(): DemoSession {
  return {
    id: randomUUID(),
    auth: null,
    projects: [],
    flash: [],
    formStates: {}
  };
}

function createSessionCookie(sessionId: string): string {
  const cookies = new (requireBunCookieMap())();
  cookies.set({
    name: SESSION_COOKIE_NAME,
    value: sessionId,
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_SECONDS
  });
  const [header] = cookies.toSetCookieHeaders();
  if (!header) {
    throw new Error('Bun.CookieMap did not serialize the auth-crud session cookie.');
  }
  return header;
}

function normalizeFormValues(body: unknown): Record<string, string> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {};
  }

  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    values[key] = typeof value === 'string' ? value : String(value ?? '');
  }
  return values;
}

function validateSignIn(values: Record<string, string>): FormIssue[] {
  const email = values.email?.trim() ?? '';
  if (!email) {
    return [{ code: 'validation', field: 'email', message: 'Email is required.' }];
  }
  if (!email.includes('@')) {
    return [{ code: 'validation', field: 'email', message: 'Enter a valid email address.' }];
  }
  return [];
}

function validateProjectMutation(session: DemoSession, values: Record<string, string>): FormIssue[] {
  const issues: FormIssue[] = [];

  if (!session.auth) {
    issues.push({
      code: 'auth',
      message: 'Sign in required to manage projects.'
    });
  }

  const title = values.title?.trim() ?? '';
  if (!title) {
    issues.push({
      code: 'validation',
      field: 'title',
      message: 'Project title is required.'
    });
  }

  const notes = values.notes?.trim() ?? '';
  if (notes.length > 140) {
    issues.push({
      code: 'validation',
      field: 'notes',
      message: 'Notes must stay under 140 characters.'
    });
  }

  if (!isProjectStatus(values.status)) {
    issues.push({
      code: 'validation',
      field: 'status',
      message: 'Choose draft, active, or archived.'
    });
  }

  return issues;
}

function validateCsrf(
  session: DemoSession,
  formId: string,
  values: Record<string, string>
): FormIssue[] {
  const providedToken = values._csrf?.trim() ?? '';
  const isValid = providedToken.length > 0 && requireBunCsrf().verify(providedToken, {
    secret: createCsrfSecret(session, formId),
    maxAge: CSRF_MAX_AGE_MS
  });
  if (!isValid) {
    return [{
      code: 'csrf',
      message: 'Form session expired. Reload the page and try again.'
    }];
  }
  return [];
}

function createCsrfToken(session: DemoSession, formId: string): string {
  return requireBunCsrf().generate(createCsrfSecret(session, formId), {
    expiresIn: CSRF_MAX_AGE_MS
  });
}

function createCsrfSecret(session: DemoSession, formId: string): string {
  return `${resolveCsrfSecret()}:${session.id}:${formId}`;
}

function resolveCsrfSecret(): string {
  return process.env.CSRF_SECRET?.trim() || GENERATED_CSRF_SECRET;
}

function storeFormState(
  session: DemoSession,
  formId: string,
  values: Record<string, string>,
  issues: readonly FormIssue[]
): void {
  const sanitizedValues = { ...values };
  delete sanitizedValues._csrf;

  session.formStates[formId] = {
    values: sanitizedValues,
    issues: issues.map((issue) => ({ ...issue }))
  };
}

function clearFormState(session: DemoSession, formId: string): void {
  delete session.formStates[formId];
}

function pushFlash(session: DemoSession, message: FlashMessage): void {
  session.flash.push({ ...message });
}

function peekPageState(session: DemoSession): PageState {
  return {
    flash: session.flash.map((message) => ({ ...message })),
    formStates: cloneFormStates(session.formStates)
  };
}

function consumePageState(session: DemoSession): PageState {
  const state = peekPageState(session);
  session.flash = [];
  session.formStates = {};
  return state;
}

function cloneFormStates(formStates: Record<string, FormState>): Record<string, FormState> {
  const cloned: Record<string, FormState> = {};
  for (const [formId, state] of Object.entries(formStates)) {
    cloned[formId] = {
      values: { ...state.values },
      issues: state.issues.map((issue) => ({ ...issue }))
    };
  }
  return cloned;
}

function statusFromIssues(issues: readonly FormIssue[]): number {
  if (issues.some((issue) => issue.code === 'auth')) {
    return 401;
  }
  if (issues.some((issue) => issue.code === 'csrf')) {
    return 403;
  }
  return 422;
}

function isEnhancedRequest(request: IncomingRequest): boolean {
  const header = request.headers['x-webstir-client-nav'];
  return header === '1' || (Array.isArray(header) && header.includes('1'));
}

function renderDemoPage(session: DemoSession, pageState: PageState): string {
  const assets = resolveFrontendAssets();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Auth And CRUD Demo</title>
  <link rel="stylesheet" href="${assets.cssHref}" />
  <style>
    body { background: #f3efe7; color: #1d1f1a; }
    main { max-width: 70rem; margin: 0 auto; padding: 3rem 1.5rem 4rem; }
    .stack { display: grid; gap: 1.25rem; }
    .card { background: #fffdf8; border: 1px solid #d9d1c2; border-radius: 1rem; padding: 1.25rem; box-shadow: 0 1rem 2rem rgba(29, 31, 26, 0.06); }
    .grid { display: grid; gap: 1rem; }
    .status { color: #5d5a50; margin: 0; }
    .chip { width: fit-content; padding: 0.4rem 0.75rem; border: 1px solid #cbbca2; border-radius: 999px; background: #f5e9cf; color: #6f4f12; }
    .flash-list { display: grid; gap: 0.75rem; }
    .flash { margin: 0; padding: 0.85rem 1rem; border-radius: 0.85rem; border: 1px solid transparent; }
    .flash[data-level="success"] { background: #edf7ef; border-color: #b9d8bf; color: #185833; }
    .flash[data-level="info"] { background: #eef5fb; border-color: #bfd2e3; color: #194d7a; }
    .flash[data-level="warning"] { background: #fff6df; border-color: #e7cf88; color: #7a5b00; }
    .flash[data-level="error"] { background: #fdeeee; border-color: #e2b9b9; color: #8a2222; }
    .panel-title { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
    .project-list { display: grid; gap: 1rem; }
    .project-card { border: 1px solid #e5ddcf; border-radius: 0.9rem; padding: 1rem; background: #fffaf1; }
    .project-meta { display: flex; flex-wrap: wrap; gap: 0.75rem; color: #5d5a50; font-size: 0.95rem; }
    .project-grid { display: grid; gap: 0.9rem; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); }
    label { display: grid; gap: 0.45rem; font-weight: 600; }
    input, textarea, select, button { font: inherit; }
    input, textarea, select { width: 100%; box-sizing: border-box; padding: 0.75rem 0.9rem; border: 1px solid #c9c0b2; border-radius: 0.75rem; background: white; }
    textarea { min-height: 5.5rem; resize: vertical; }
    button { width: fit-content; padding: 0.75rem 1rem; border: 0; border-radius: 999px; background: #174c3c; color: white; cursor: pointer; }
    button.secondary { background: #7a2424; }
    .button-row { display: flex; gap: 0.75rem; flex-wrap: wrap; }
    .issues { display: grid; gap: 0.35rem; color: #8a2222; margin: 0; padding-left: 1rem; }
    .gate { padding: 0.85rem 1rem; border-radius: 0.85rem; background: #fff6df; color: #7a5b00; border: 1px solid #e7cf88; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  </style>
  <script type="module" src="${assets.scriptSrc}"></script>
</head>
<body>
  <main class="stack">
    <header class="card stack">
      <p><a href="/">Back to the auth + CRUD demo home page</a></p>
      <div class="stack">
        <h1>Auth and CRUD proof app</h1>
        <p>This backend-served page exercises auth gates, validation, redirect-after-post, and enhanced fragment updates on the same server-handled forms.</p>
        <p class="status">Use it as the canonical Webstir example for HTML-first backoffice flows.</p>
      </div>
    </header>
    ${renderBackofficeShell(session, pageState)}
  </main>
</body>
</html>`;
}

function renderBackofficeShell(session: DemoSession, pageState: PageState): string {
  const signInState = getFormState(pageState, FORM_IDS.signIn);
  const createState = getFormState(pageState, FORM_IDS.createProject);

  return [
    `<section id="${SHELL_TARGET}" data-webstir-fragment-target="${SHELL_TARGET}" class="stack" aria-live="polite">`,
    renderFlashRegion(pageState.flash),
    renderAuthCard(session, signInState),
    renderWorkspaceCard(session, pageState, createState),
    '</section>'
  ].join('\n');
}

function renderFlashRegion(messages: readonly FlashMessage[]): string {
  if (messages.length === 0) {
    return [
      '<section id="flash-region" class="card stack">',
      '  <h2>Form loop status</h2>',
      '  <p class="status">Submit sign-in, create, edit, or delete forms to observe fragment updates and redirect-after-post behavior.</p>',
      '</section>'
    ].join('\n');
  }

  return [
    '<section id="flash-region" class="card stack">',
    '  <h2>Form loop status</h2>',
    '  <div class="flash-list">',
    ...messages.map((message) =>
      `    <p class="flash" data-level="${message.level}" data-flash-key="${escapeHtml(message.key)}">${escapeHtml(message.text)}</p>`
    ),
    '  </div>',
    '</section>'
  ].join('\n');
}

function renderAuthCard(session: DemoSession, signInState: FormState): string {
  const grouped = groupIssuesByField(signInState.issues);
  if (session.auth) {
    return [
      '<section id="auth-panel" class="card stack">',
      '  <div class="panel-title">',
      '    <h2>Session</h2>',
      '    <span class="chip">Auth gate open</span>',
      '  </div>',
      `  <p id="session-user" data-session-user="${escapeHtml(session.auth.email)}">Signed in as <strong>${escapeHtml(session.auth.email)}</strong>.</p>`,
      `  <form id="auth-sign-out-form" method="post" action="${SIGN_OUT_ACTION}" class="button-row">`,
      `    <input type="hidden" name="_csrf" value="${escapeHtml(createCsrfToken(session, FORM_IDS.signOut))}" />`,
      '    <button id="auth-sign-out" type="submit">Sign out</button>',
      '  </form>',
      '</section>'
    ].join('\n');
  }

  return [
    '<section id="auth-panel" class="card stack">',
    '  <div class="panel-title">',
    '    <h2>Sign in</h2>',
    '    <span class="chip">Required for CRUD</span>',
    '  </div>',
    '  <p class="status">The same forms still post without JavaScript, then redirect back into this page.</p>',
    renderIssueList(grouped.form),
    `  <form id="auth-sign-in-form" method="post" action="${SIGN_IN_ACTION}" class="grid">`,
    `    <input type="hidden" name="_csrf" value="${escapeHtml(createCsrfToken(session, FORM_IDS.signIn))}" />`,
    '    <label for="auth-email">',
    '      Email',
    `      <input id="auth-email" name="email" type="email" autocomplete="username" value="${escapeHtml(readFormValue(signInState.values, 'email') ?? '')}" />`,
    '    </label>',
    renderIssueList(grouped.fields.email ?? []),
    '    <div class="button-row">',
    '      <button id="auth-sign-in" type="submit">Sign in</button>',
    '    </div>',
    '  </form>',
    '</section>'
  ].join('\n');
}

function renderWorkspaceCard(session: DemoSession, pageState: PageState, createState: FormState): string {
  const createIssues = groupIssuesByField(createState.issues);
  const showGate = !session.auth;

  return [
    '<section id="workspace-panel" class="card stack">',
    '  <div class="panel-title">',
    '    <h2>Backoffice workspace</h2>',
    '    <span class="chip">Fragment target</span>',
    '  </div>',
    '  <p class="status">Create, edit, and delete all route through the backend and return either a redirect or a fragment update.</p>',
    showGate
      ? '  <p id="auth-required" class="gate">Sign in required to create, edit, or delete projects. Try the create form while signed out to see the auth gate preserve your draft.</p>'
      : '  <p class="status">Reload after any mutation to confirm the session-backed project list persists.</p>',
    renderIssueList(createIssues.form),
    `  <form id="project-create-form" method="post" action="${CREATE_PROJECT_ACTION}" class="grid">`,
    `    <input type="hidden" name="_csrf" value="${escapeHtml(createCsrfToken(session, FORM_IDS.createProject))}" />`,
    '    <div class="project-grid">',
    '      <label for="project-title">',
    '        Project title',
    `        <input id="project-title" name="title" value="${escapeHtml(readFormValue(createState.values, 'title') ?? '')}" />`,
    '      </label>',
    '      <label for="project-status">',
    '        Status',
    renderStatusSelect({
      id: 'project-status',
      name: 'status',
      selected: readFormValue(createState.values, 'status') ?? 'draft'
    }),
    '      </label>',
    '    </div>',
    '    <label for="project-notes">',
    '      Notes',
    `      <textarea id="project-notes" name="notes">${escapeHtml(readFormValue(createState.values, 'notes') ?? '')}</textarea>`,
    '    </label>',
    renderIssueList(createIssues.fields.title ?? []),
    renderIssueList(createIssues.fields.status ?? []),
    renderIssueList(createIssues.fields.notes ?? []),
    '    <div class="button-row">',
    '      <button id="project-create-submit" type="submit">Create project</button>',
    '    </div>',
    '  </form>',
    renderProjectList(session, pageState),
    '</section>'
  ].filter(Boolean).join('\n');
}

function renderProjectList(session: DemoSession, pageState: PageState): string {
  if (!session.auth) {
    return [
      '<section class="stack">',
      '  <h3>Saved projects</h3>',
      '  <p class="status">Projects appear here after sign-in seeds the backoffice with starter records.</p>',
      '</section>'
    ].join('\n');
  }

  if (session.projects.length === 0) {
    return [
      '<section class="stack">',
      '  <h3>Saved projects</h3>',
      '  <p class="status">No projects yet. Use the create form to add the first record.</p>',
      '</section>'
    ].join('\n');
  }

  return [
    '<section class="stack">',
    '  <h3>Saved projects</h3>',
    '  <div class="project-list">',
    ...session.projects.map((project) => renderProjectCard(session, pageState, project)),
    '  </div>',
    '</section>'
  ].join('\n');
}

function renderProjectCard(session: DemoSession, pageState: PageState, project: DemoProject): string {
  const formId = FORM_IDS.updateProject(project.id);
  const deleteFormId = FORM_IDS.deleteProject(project.id);
  const state = getFormState(pageState, formId, {
    title: project.title,
    status: project.status,
    notes: project.notes,
    projectId: project.id
  });
  const grouped = groupIssuesByField(state.issues);

  return [
    `<article class="project-card stack" data-project-row="true" data-project-id="${escapeHtml(project.id)}">`,
    `  <div class="panel-title"><h4 data-project-heading="${escapeHtml(project.id)}">${escapeHtml(project.title)}</h4><span class="chip">${escapeHtml(project.status)}</span></div>`,
    `  <p class="project-meta"><span>Created ${formatIsoDate(project.createdAt)}</span><span>Updated ${formatIsoDate(project.updatedAt)}</span></p>`,
    renderIssueList(grouped.form),
    `  <form id="project-edit-form-${escapeHtml(project.id)}" method="post" action="${UPDATE_PROJECT_ACTION}" class="grid">`,
    `    <input type="hidden" name="_csrf" value="${escapeHtml(createCsrfToken(session, formId))}" />`,
    `    <input type="hidden" name="projectId" value="${escapeHtml(project.id)}" />`,
    '    <div class="project-grid">',
    `      <label for="project-title-${escapeHtml(project.id)}">`,
    '        Title',
    `        <input id="project-title-${escapeHtml(project.id)}" name="title" value="${escapeHtml(readFormValue(state.values, 'title') ?? project.title)}" />`,
    '      </label>',
    `      <label for="project-status-${escapeHtml(project.id)}">`,
    '        Status',
    renderStatusSelect({
      id: `project-status-${project.id}`,
      name: 'status',
      selected: readFormValue(state.values, 'status') ?? project.status
    }),
    '      </label>',
    '    </div>',
    `    <label for="project-notes-${escapeHtml(project.id)}">`,
    '      Notes',
    `      <textarea id="project-notes-${escapeHtml(project.id)}" name="notes">${escapeHtml(readFormValue(state.values, 'notes') ?? project.notes)}</textarea>`,
    '    </label>',
    renderIssueList(grouped.fields.title ?? []),
    renderIssueList(grouped.fields.status ?? []),
    renderIssueList(grouped.fields.notes ?? []),
    '    <div class="button-row">',
    `      <button type="submit" data-project-save="${escapeHtml(project.id)}">Save changes</button>`,
    '    </div>',
    '  </form>',
    `  <form id="project-delete-form-${escapeHtml(project.id)}" method="post" action="${DELETE_PROJECT_ACTION}" class="button-row">`,
    `    <input type="hidden" name="_csrf" value="${escapeHtml(createCsrfToken(session, deleteFormId))}" />`,
    `    <input type="hidden" name="projectId" value="${escapeHtml(project.id)}" />`,
    `    <button class="secondary" type="submit" data-project-delete="${escapeHtml(project.id)}">Delete project</button>`,
    '  </form>',
    '</article>'
  ].join('\n');
}

function renderStatusSelect(options: { id: string; name: string; selected: string }): string {
  return [
    `        <select id="${escapeHtml(options.id)}" name="${escapeHtml(options.name)}">`,
    ...(['draft', 'active', 'archived'] as const).map((status) =>
      `          <option value="${status}"${options.selected === status ? ' selected' : ''}>${capitalize(status)}</option>`
    ),
    '        </select>'
  ].join('\n');
}

function getFormState(
  pageState: PageState,
  formId: string,
  defaults: Record<string, string> = {}
): FormState {
  const state = pageState.formStates[formId];
  if (!state) {
    return {
      values: { ...defaults },
      issues: []
    };
  }

  return {
    values: {
      ...defaults,
      ...state.values
    },
    issues: state.issues.map((issue) => ({ ...issue }))
  };
}

function groupIssuesByField(issues: readonly FormIssue[]): {
  form: string[];
  fields: Record<string, string[]>;
} {
  const grouped = {
    form: [] as string[],
    fields: {} as Record<string, string[]>
  };

  for (const issue of issues) {
    if (issue.field) {
      grouped.fields[issue.field] ??= [];
      grouped.fields[issue.field].push(issue.message);
      continue;
    }
    grouped.form.push(issue.message);
  }

  return grouped;
}

function renderIssueList(issues: readonly string[]): string {
  if (issues.length === 0) {
    return '';
  }

  return [
    '  <ul class="issues">',
    ...issues.map((issue) => `    <li>${escapeHtml(issue)}</li>`),
    '  </ul>'
  ].join('\n');
}

function readFormValue(values: Record<string, string>, key: string): string | undefined {
  const value = values[key];
  return typeof value === 'string' ? value : undefined;
}

function createSeedProjects(): DemoProject[] {
  return [
    {
      id: createProjectId(),
      title: 'Operations cleanup',
      notes: 'Review fragment cache headers before the next release.',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: createProjectId(),
      title: 'Launch checklist',
      notes: 'Confirm no-JS redirect-after-post behavior in publish mode.',
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];
}

function createProjectId(): string {
  return randomUUID().replaceAll('-', '').slice(0, 10);
}

function formatIsoDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function normalizeProjectStatus(value: string | undefined): ProjectStatus {
  return isProjectStatus(value) ? value : 'draft';
}

function isProjectStatus(value: string | undefined): value is ProjectStatus {
  return value === 'draft' || value === 'active' || value === 'archived';
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function readCookie(header: string | string[] | undefined, name: string): string | undefined {
  const cookies = new (requireBunCookieMap())(Array.isArray(header) ? header.join('; ') : (header ?? ''));
  return cookies.get(name) ?? undefined;
}

function requireBunCookieMap(): BunCookieMapConstructor {
  const runtime = (globalThis as typeof globalThis & { Bun?: BunRuntime }).Bun;
  const CookieMap = runtime?.CookieMap;
  if (!CookieMap) {
    throw new Error('This demo requires Bun.CookieMap.');
  }
  return CookieMap;
}

function requireBunCsrf(): BunCsrfApi {
  const runtime = (globalThis as typeof globalThis & { Bun?: BunRuntime }).Bun;
  const csrf = runtime?.CSRF;
  if (!csrf) {
    throw new Error('This demo requires Bun.CSRF.');
  }
  return csrf;
}

function sendRouteResponse(response: ServerResponse, result: RouteResult): void {
  const status = result.redirect ? (result.status ?? 303) : (result.status ?? 200);
  const headers: Record<string, string> = { ...(result.headers ?? {}) };

  if (result.redirect) {
    headers.location = result.redirect.location;
  }

  if (result.fragment) {
    headers['x-webstir-fragment-target'] = result.fragment.target;
    if (result.fragment.selector) {
      headers['x-webstir-fragment-selector'] = result.fragment.selector;
    }
    if (result.fragment.mode) {
      headers['x-webstir-fragment-mode'] = result.fragment.mode;
    }
  }

  const payload = result.fragment?.body ?? result.body;
  if (payload !== undefined && payload !== null && !hasHeader(headers, 'content-type')) {
    headers['content-type'] = typeof payload === 'string'
      ? 'text/html; charset=utf-8'
      : 'application/json';
  }

  response.writeHead(status, headers);

  if (result.redirect || payload === undefined || payload === null) {
    response.end('');
    return;
  }

  if (typeof payload === 'string' || Buffer.isBuffer(payload)) {
    response.end(payload);
    return;
  }

  response.end(JSON.stringify(payload));
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lowerName = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lowerName);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function resolveFrontendAssets(): { cssHref: string; scriptSrc: string } {
  const manifestPath = path.join(process.cwd(), 'dist', 'frontend', 'manifest.json');
  if (!existsSync(manifestPath)) {
    return DEV_FRONTEND_ASSETS;
  }

  try {
    const raw = readFileSync(manifestPath, 'utf8');
    const parsed = JSON.parse(raw) as {
      shared?: {
        css?: string;
        js?: string;
      };
    };

    const sharedCss = parsed.shared?.css;
    const sharedJs = parsed.shared?.js;
    if (!sharedCss || !sharedJs) {
      return DEV_FRONTEND_ASSETS;
    }

    return {
      cssHref: `/app/${sharedCss}`,
      scriptSrc: `/app/${sharedJs}`
    };
  } catch {
    return DEV_FRONTEND_ASSETS;
  }
}

export default server;
