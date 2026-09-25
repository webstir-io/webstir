import { resolveWorkspaceRoot } from '../workspace.js';

export { notFound, redirect } from './view-control.js';
export type { ViewRedirectStatus } from './view-control.js';
import { executeRenderProgram, programUsesCsrf, schemaDeclaresField } from './render.js';
import {
  loadFrontendDocument,
  loadPageArtifact,
  type LoadedDocument,
  type RequestTimeDocumentCacheStatus,
} from './view-documents.js';

export interface EnvAccessorLike {
  get(name: string): string | undefined;
  require(name: string): string;
  entries(): Record<string, string | undefined>;
}

export interface LoggerLike {
  readonly level?: string;
  log?(level: string, message: string, metadata?: Record<string, unknown>): void;
  debug?(message: string, metadata?: Record<string, unknown>): void;
  info?(message: string, metadata?: Record<string, unknown>): void;
  warn?(message: string, metadata?: Record<string, unknown>): void;
  error?(message: string, metadata?: Record<string, unknown>): void;
  with?(bindings: Record<string, unknown>): LoggerLike;
}

export interface ViewDefinitionLike {
  name?: string;
  path?: string;
  page?: string;
  renderMode?: 'ssg' | 'ssr' | 'spa';
}

export interface ViewFlashMessage {
  readonly level: 'info' | 'success' | 'warning' | 'error';
  readonly message: string;
}

interface ViewDataSchemaLike {
  safeParse(value: unknown): { success: true; data: unknown } | { success: false; error: unknown };
}

export type { RequestTimeDocumentCacheStatus };

export interface RequestTimeDocumentCacheMetadata {
  readonly status: RequestTimeDocumentCacheStatus;
  readonly documentPath: string;
}

export interface RenderedRequestTimeView {
  readonly html: string;
  readonly documentCache: RequestTimeDocumentCacheMetadata;
}

export interface FormStateReaderLike {
  read(formId: string): {
    submitted: boolean;
    values: Record<string, string | string[]>;
    issues: { code?: string; field?: string; message: string }[];
    errors: Record<string, string>;
  };
}

export interface SSRContextLike {
  readonly url: URL;
  readonly params: Record<string, string>;
  readonly cookies: Record<string, string>;
  readonly headers: Record<string, string>;
  readonly auth: unknown;
  readonly session: Record<string, unknown> | null;
  readonly env: EnvAccessorLike;
  readonly logger: LoggerLike;
  readonly requestId?: string;
  readonly now: () => Date;
  readonly forms: FormStateReaderLike;
}

export interface ModuleViewLike {
  readonly definition?: ViewDefinitionLike;
  readonly data?: unknown;
  readonly load?: (context: SSRContextLike) => Promise<unknown> | unknown;
}

export interface CompiledView {
  readonly name: string;
  readonly pathPattern: string;
  readonly definition?: ViewDefinitionLike;
  readonly data?: unknown;
  readonly load?: ModuleViewLike['load'];
  readonly match: (pathname: string) => {
    matched: boolean;
    params: Record<string, string>;
  };
}

export function compileViews(views: readonly ModuleViewLike[]): CompiledView[] {
  const compiled: CompiledView[] = [];
  for (const view of views) {
    const pathPattern = normalizePath(view.definition?.path ?? '/');
    compiled.push({
      name: view.definition?.name ?? pathPattern,
      pathPattern,
      definition: view.definition,
      data: view.data,
      load: view.load,
      match: createPathMatcher(pathPattern),
    });
  }
  return compiled;
}

const EMPTY_FORMS: FormStateReaderLike = {
  read: () => ({ submitted: false, values: {}, issues: [], errors: {} }),
};

export function findView(views: readonly CompiledView[], name: string): CompiledView | undefined {
  return views.find((view) => view.name === name);
}

export function matchView(
  views: readonly CompiledView[],
  pathname: string,
): { view: CompiledView; params: Record<string, string> } | undefined {
  for (const view of views) {
    const matched = view.match(pathname);
    if (matched.matched) {
      return {
        view,
        params: matched.params,
      };
    }
  }
  return undefined;
}

export async function renderRequestTimeView(options: {
  workspaceRoot?: string;
  url: URL;
  view: CompiledView;
  params: Record<string, string>;
  cookies: Record<string, string>;
  headers: Record<string, string>;
  auth: unknown;
  session: Record<string, unknown> | null;
  env: EnvAccessorLike;
  logger: LoggerLike;
  requestId?: string;
  now?: () => Date;
  flash?: readonly ViewFlashMessage[];
  csrfToken?: () => string;
  forms?: FormStateReaderLike;
}): Promise<RenderedRequestTimeView> {
  const {
    workspaceRoot,
    url,
    view,
    params,
    cookies,
    headers,
    auth,
    session,
    env,
    logger,
    requestId,
  } = options;
  const now = options.now ?? (() => new Date());
  const root = resolveWorkspaceRoot(workspaceRoot);
  const page = view.definition?.page;
  const document: LoadedDocument = page
    ? await loadPageArtifact(root, page)
    : await loadFrontendDocument(root, url.pathname);

  const viewData = view.load
    ? await view.load({
        url,
        params,
        cookies,
        headers,
        auth,
        session,
        env,
        logger,
        requestId,
        now,
        forms: options.forms ?? EMPTY_FORMS,
      })
    : null;

  if (page) {
    const program = document.program;
    return {
      html: program
        ? executeRenderProgram(program, prepareViewData(view, viewData, options.flash ?? []), {
            csrfToken: programUsesCsrf(program) ? options.csrfToken?.() : undefined,
          })
        : document.html,
      documentCache: {
        status: document.cacheStatus,
        documentPath: document.path,
      },
    };
  }

  return {
    html: injectViewState(document.html, {
      name: view.name,
      templatePath: view.pathPattern,
      pathname: normalizePath(url.pathname),
      params,
      data: viewData ?? null,
      requestId,
    }),
    documentCache: {
      status: document.cacheStatus,
      documentPath: document.path,
    },
  };
}

function prepareViewData(
  view: CompiledView,
  loaded: unknown,
  flash: readonly ViewFlashMessage[],
): unknown {
  const schema = view.data as ViewDataSchemaLike | undefined;
  if (!schema || typeof schema.safeParse !== 'function') {
    return withFlash(loaded, flash);
  }
  // The framework supplies `flash`; it joins the loader's data first only when the schema
  // declares it, so a strict schema without it still accepts what the loader returned.
  const parsed = schema.safeParse(
    schemaDeclaresField(schema, 'flash') ? withFlash(loaded, flash) : loaded,
  );
  if (!parsed.success) {
    throw new Error(
      `View ${view.name} returned data that does not match its schema: ${describeSchemaError(parsed.error)}`,
    );
  }
  return withFlash(parsed.data, flash);
}

function withFlash(value: unknown, flash: readonly ViewFlashMessage[]): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value) || 'flash' in value) {
    return value;
  }
  return { ...value, flash: [...flash] };
}

function describeSchemaError(error: unknown): string {
  const issues = (error as { issues?: { path?: unknown[]; message?: string }[] })?.issues;
  if (!Array.isArray(issues) || issues.length === 0) {
    return error instanceof Error ? error.message : String(error);
  }
  return issues
    .map((issue) => {
      const where =
        Array.isArray(issue.path) && issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${where}: ${issue.message ?? 'invalid'}`;
    })
    .join('; ');
}

export function toHeaderRecord(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      normalized[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      normalized[key] = value.join(', ');
    }
  }
  return normalized;
}

function createPathMatcher(pattern: string) {
  const normalized = normalizePath(pattern);
  const paramRegex = /:([A-Za-z0-9_]+)/g;
  const regex = new RegExp(
    '^' +
      normalized
        .replace(/\//g, '\\/')
        .replace(paramRegex, (_segment, name) => `(?<${name}>[^/]+)`) +
      '$',
  );

  return (pathname: string) => {
    const pathToTest = normalizePath(pathname);
    const match = regex.exec(pathToTest);
    if (!match) {
      return { matched: false, params: {} };
    }
    return {
      matched: true,
      params: (match.groups ?? {}) as Record<string, string>,
    };
  };
}

function normalizePath(value: string | undefined): string {
  if (!value || value === '/') {
    return '/';
  }
  const trimmed = value.endsWith('/') ? value.slice(0, -1) : value;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function injectViewState(
  documentHtml: string,
  state: {
    name: string;
    templatePath: string;
    pathname: string;
    params: Record<string, string>;
    data: unknown;
    requestId?: string;
  },
): string {
  const payload = serializeJsonForHtml({
    view: {
      name: state.name,
      path: state.templatePath,
      pathname: state.pathname,
      params: state.params,
    },
    data: state.data,
    requestId: state.requestId ?? null,
  });

  const scriptTag = `<script type="application/json" id="webstir-view-state">${payload}</script>`;
  const htmlWithBodyAttributes = documentHtml.replace(
    /<body\b([^>]*)>/i,
    (_match, existingAttributes) => {
      const attrs = [
        `data-webstir-view-name="${escapeHtmlAttribute(state.name)}"`,
        `data-webstir-view-pathname="${escapeHtmlAttribute(state.pathname)}"`,
        `data-webstir-view-template="${escapeHtmlAttribute(state.templatePath)}"`,
      ];
      return `<body${existingAttributes} ${attrs.join(' ')}>`;
    },
  );

  if (/<\/body>/i.test(htmlWithBodyAttributes)) {
    return htmlWithBodyAttributes.replace(/<\/body>/i, `${scriptTag}\n</body>`);
  }

  if (/<\/html>/i.test(htmlWithBodyAttributes)) {
    return htmlWithBodyAttributes.replace(/<\/html>/i, `${scriptTag}\n</html>`);
  }

  return `${htmlWithBodyAttributes}\n${scriptTag}`;
}

function serializeJsonForHtml(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
