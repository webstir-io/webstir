import path from 'node:path';
import { readFile } from 'node:fs/promises';

/** A view that routes a dynamic path pattern to a built frontend page. */
export interface PageRoute {
  readonly page: string;
  readonly pattern: string;
  readonly name?: string;
}

export interface PageRouteMatch {
  readonly route: PageRoute;
  readonly params: Record<string, string>;
}

interface WorkspaceViewLike {
  readonly name?: unknown;
  readonly path?: unknown;
  readonly page?: unknown;
  readonly renderMode?: unknown;
}

const PARAM_SEGMENT = /^:([A-Za-z0-9_]+)$/;
const STATIC_SEGMENT = /^[A-Za-z0-9._~-]+$/;

/**
 * Reads the page views declared in `package.json` under `webstir.moduleManifest.views`.
 * A view routes to a frontend page when it names a `page` and its `renderMode` is `spa`
 * or omitted. Views without a `page` are left to the backend runtime.
 */
export async function readWorkspacePageRoutes(
  workspaceRoot: string,
): Promise<readonly PageRoute[]> {
  const source = await readFile(path.join(workspaceRoot, 'package.json'), 'utf8');
  const packageJson = JSON.parse(source) as {
    webstir?: { moduleManifest?: { views?: unknown } };
  };
  const views = packageJson.webstir?.moduleManifest?.views;
  return normalizePageRoutes(Array.isArray(views) ? views : []);
}

/**
 * Validates view declarations and orders them the way Bun's router ranks overlapping
 * patterns: segment by segment from the left, a static segment beats a parameter at the
 * first position where two patterns differ. Declaration order breaks exact ties.
 */
export function normalizePageRoutes(views: readonly unknown[]): readonly PageRoute[] {
  const routes: PageRoute[] = [];
  const owners = new Map<string, string>();

  for (const view of views) {
    if (!view || typeof view !== 'object') {
      continue;
    }

    const { name, path: pattern, page, renderMode } = view as WorkspaceViewLike;
    if (page === undefined) {
      continue;
    }
    if (typeof page !== 'string' || page.length === 0) {
      throw new Error('[webstir] a view "page" must be a non-empty page name.');
    }
    if (renderMode !== undefined && renderMode !== 'spa') {
      continue;
    }
    if (typeof pattern !== 'string') {
      throw new Error(`[webstir] the view for page "${page}" needs a "path" pattern.`);
    }

    const normalized = normalizePagePattern(pattern);
    const shape = patternShape(normalized);
    const owner = owners.get(shape);
    if (owner && owner !== page) {
      throw new Error(
        `[webstir] view path ${normalized} is declared by both "${owner}" and "${page}".`,
      );
    }
    owners.set(shape, page);
    routes.push({
      page,
      pattern: normalized,
      ...(typeof name === 'string' && name.length > 0 ? { name } : {}),
    });
  }

  return sortBySpecificity(routes);
}

export function normalizePagePattern(pattern: string): string {
  const trimmed = pattern.trim();
  if (!trimmed.startsWith('/')) {
    throw new Error(`[webstir] view path "${pattern}" must start with "/".`);
  }

  const segments = trimmed.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    throw new Error('[webstir] view path "/" cannot route to a page; use the home page instead.');
  }

  const lastSegment = segments[segments.length - 1];
  if (!PARAM_SEGMENT.test(lastSegment) && path.posix.extname(lastSegment) !== '') {
    throw new Error(
      `[webstir] view path "${pattern}" ends in a file name ("${lastSegment}"). Page views serve HTML documents; use a static file or a route for files.`,
    );
  }

  const params = new Set<string>();
  for (const segment of segments) {
    const param = PARAM_SEGMENT.exec(segment);
    if (param) {
      if (params.has(param[1])) {
        throw new Error(`[webstir] view path "${pattern}" repeats the parameter ":${param[1]}".`);
      }
      params.add(param[1]);
      continue;
    }
    if (!STATIC_SEGMENT.test(segment)) {
      throw new Error(
        `[webstir] view path "${pattern}" has an invalid segment "${segment}". Use static segments or ":param".`,
      );
    }
  }

  return `/${segments.join('/')}`;
}

/**
 * A `:param` matches any single path segment, including one containing a dot, exactly as
 * Bun's router does in watch. Static files are always resolved before patterns are tried.
 */
export function matchPageRoute(
  routes: readonly PageRoute[],
  pathname: string,
): PageRouteMatch | undefined {
  const segments = splitRequestPath(pathname);
  if (!segments) {
    return undefined;
  }

  for (const route of routes) {
    const params = matchPattern(route.pattern, segments);
    if (params) {
      return { route, params };
    }
  }

  return undefined;
}

function matchPattern(
  pattern: string,
  segments: readonly string[],
): Record<string, string> | undefined {
  const expectedSegments = pattern.split('/').filter((segment) => segment.length > 0);
  if (expectedSegments.length !== segments.length) {
    return undefined;
  }

  const params: Record<string, string> = {};
  for (let index = 0; index < expectedSegments.length; index += 1) {
    const expected = expectedSegments[index];
    const actual = segments[index];
    const param = PARAM_SEGMENT.exec(expected);
    if (param) {
      params[param[1]] = actual;
      continue;
    }
    if (expected !== actual) {
      return undefined;
    }
  }

  return params;
}

function splitRequestPath(pathname: string): readonly string[] | undefined {
  const segments: string[] = [];
  for (const raw of pathname.split('/')) {
    if (raw.length === 0) {
      continue;
    }

    let decoded: string;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      return undefined;
    }
    if (decoded === '.' || decoded === '..' || decoded.includes('/')) {
      return undefined;
    }
    segments.push(decoded);
  }

  return segments.length > 0 ? segments : undefined;
}

function sortBySpecificity(routes: readonly PageRoute[]): readonly PageRoute[] {
  return routes
    .map((route, index) => ({ route, index }))
    .sort(
      (left, right) =>
        compareSpecificity(left.route.pattern, right.route.pattern) || left.index - right.index,
    )
    .map((entry) => entry.route);
}

/** Negative when `left` should be tried before `right`. Mirrors Bun.serve route ranking. */
export function compareSpecificity(left: string, right: string): number {
  const leftSegments = left.split('/').filter((segment) => segment.length > 0);
  const rightSegments = right.split('/').filter((segment) => segment.length > 0);
  if (leftSegments.length !== rightSegments.length) {
    return leftSegments.length - rightSegments.length;
  }

  for (let index = 0; index < leftSegments.length; index += 1) {
    const leftIsParam = PARAM_SEGMENT.test(leftSegments[index]);
    const rightIsParam = PARAM_SEGMENT.test(rightSegments[index]);
    if (leftIsParam !== rightIsParam) {
      return leftIsParam ? 1 : -1;
    }
  }

  return 0;
}

/** Two patterns that differ only in parameter names match the same paths. */
function patternShape(pattern: string): string {
  return pattern
    .split('/')
    .map((segment) => (PARAM_SEGMENT.test(segment) ? ':' : segment))
    .join('/');
}
