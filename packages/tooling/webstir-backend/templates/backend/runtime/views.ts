import path from 'node:path';
import { access, readFile } from 'node:fs/promises';

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
  renderMode?: 'ssg' | 'ssr' | 'spa';
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
}

export interface ModuleViewLike {
  readonly definition?: ViewDefinitionLike;
  readonly load?: (context: SSRContextLike) => Promise<unknown> | unknown;
}

export interface CompiledView {
  readonly name: string;
  readonly pathPattern: string;
  readonly definition?: ViewDefinitionLike;
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
      load: view.load,
      match: createPathMatcher(pathPattern)
    });
  }
  return compiled;
}

export function matchView(
  views: readonly CompiledView[],
  pathname: string
): { view: CompiledView; params: Record<string, string> } | undefined {
  for (const view of views) {
    const matched = view.match(pathname);
    if (matched.matched) {
      return {
        view,
        params: matched.params
      };
    }
  }
  return undefined;
}

export async function renderRequestTimeView(options: {
  workspaceRoot: string;
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
}): Promise<string> {
  const { workspaceRoot, url, view, params, cookies, headers, auth, session, env, logger, requestId } = options;
  const now = options.now ?? (() => new Date());
  const documentPath = await resolveFrontendDocumentPath(workspaceRoot, url.pathname);
  const documentHtml = await readFile(documentPath, 'utf8');

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
        now
      })
    : null;

  return injectViewState(documentHtml, {
    name: view.name,
    templatePath: view.pathPattern,
    pathname: normalizePath(url.pathname),
    params,
    data: viewData ?? null,
    requestId
  });
}

export function toHeaderRecord(headers: Record<string, string | string[] | undefined>): Record<string, string> {
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
      '$'
  );

  return (pathname: string) => {
    const pathToTest = normalizePath(pathname);
    const match = regex.exec(pathToTest);
    if (!match) {
      return { matched: false, params: {} };
    }
    return {
      matched: true,
      params: (match.groups ?? {}) as Record<string, string>
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

function firstPathSegment(pathname: string): string | undefined {
  const normalized = normalizePath(pathname);
  if (normalized === '/') {
    return undefined;
  }
  const parts = normalized.split('/').filter(Boolean);
  return parts[0];
}

async function resolveFrontendDocumentPath(workspaceRoot: string, pathname: string): Promise<string> {
  const pageName = firstPathSegment(pathname) ?? 'home';
  const candidates = [
    path.join(workspaceRoot, 'build', 'frontend', 'pages', pageName, 'index.html'),
    pageName === 'home'
      ? path.join(workspaceRoot, 'dist', 'frontend', 'index.html')
      : path.join(workspaceRoot, 'dist', 'frontend', pageName, 'index.html'),
    path.join(workspaceRoot, 'dist', 'frontend', 'pages', pageName, 'index.html')
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Frontend document for ${normalizePath(pathname)} was not found. Checked ${candidates.join(', ')}.`
  );
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
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
  }
): string {
  const payload = serializeJsonForHtml({
    view: {
      name: state.name,
      path: state.templatePath,
      pathname: state.pathname,
      params: state.params
    },
    data: state.data,
    requestId: state.requestId ?? null
  });

  const scriptTag = `<script type="application/json" id="webstir-view-state">${payload}</script>`;
  const htmlWithBodyAttributes = documentHtml.replace(/<body\b([^>]*)>/i, (_match, existingAttributes) => {
    const attrs = [
      `data-webstir-view-name="${escapeHtmlAttribute(state.name)}"`,
      `data-webstir-view-pathname="${escapeHtmlAttribute(state.pathname)}"`,
      `data-webstir-view-template="${escapeHtmlAttribute(state.templatePath)}"`
    ];
    return `<body${existingAttributes} ${attrs.join(' ')}>`;
  });

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
