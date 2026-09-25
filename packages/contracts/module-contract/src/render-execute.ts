import {
  RENDER_PROGRAM_VERSION,
  type RenderNode,
  type RenderPath,
  type RenderProgram,
  type RenderSourceLocation,
} from './render-program.js';

export const RENDER_CSRF_FIELD = '_csrf';

const SAFE_URL_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);
const BLOCKED_URL = 'about:invalid';

export class RenderProgramError extends Error {
  readonly loc: RenderSourceLocation;

  constructor(loc: RenderSourceLocation, message: string) {
    super(`${loc.file}:${loc.line}: ${message}`);
    this.name = 'RenderProgramError';
    this.loc = loc;
  }
}

export interface ExecuteRenderProgramOptions {
  /**
   * The session's token for POST forms. `false` renders static output, which has no session:
   * POST forms render without a token field.
   */
  readonly csrfToken?: string | false;
}

export function readRenderProgram(value: unknown, source: string): RenderProgram {
  if (
    !value ||
    typeof value !== 'object' ||
    (value as { version?: unknown }).version !== RENDER_PROGRAM_VERSION ||
    !Array.isArray((value as { nodes?: unknown }).nodes)
  ) {
    throw new Error(
      `Render program ${source} is not a version ${RENDER_PROGRAM_VERSION} program. Rebuild the frontend.`,
    );
  }
  return value as RenderProgram;
}

export function programUsesCsrf(program: RenderProgram): boolean {
  return nodesUseCsrf(program.nodes);
}

export function executeRenderProgram(
  program: RenderProgram,
  data: unknown,
  options: ExecuteRenderProgramOptions = {},
): string {
  const out: string[] = [];
  run(program.nodes, data, [], options, out);
  return out.join('');
}

function run(
  nodes: readonly RenderNode[],
  data: unknown,
  scopes: readonly unknown[],
  options: ExecuteRenderProgramOptions,
  out: string[],
): void {
  for (const node of nodes) {
    if (typeof node === 'string') {
      out.push(node);
      continue;
    }
    switch (node.op) {
      case 'csrf':
        if (options.csrfToken === false) {
          break;
        }
        if (!options.csrfToken) {
          throw new Error('A POST form needs a CSRF token, but none was supplied.');
        }
        out.push(
          `<input type="hidden" name="${RENDER_CSRF_FIELD}" value="${escapeAttribute(options.csrfToken)}">`,
        );
        break;
      case 'text': {
        const value = read(node.path, data, scopes);
        if (value !== null && value !== undefined) {
          out.push(escapeText(toText(value, node.loc, `data-text="${node.path.source}"`)));
        }
        break;
      }
      case 'attr': {
        const value = read(node.path, data, scopes);
        if (value === true) {
          out.push(` ${node.name}`);
        } else if (value !== false && value !== null && value !== undefined) {
          const label = `data-attr-${node.name}="${node.path.source}"`;
          const text = toText(value, node.loc, label);
          out.push(
            ` ${node.name}="${escapeAttribute(node.url ? safeAttributeUrl(node.name, text) : text)}"`,
          );
        }
        break;
      }
      case 'if':
        if (isTruthy(read(node.path, data, scopes)) !== node.negate) {
          run(node.body, data, scopes, options, out);
        }
        break;
      case 'each': {
        const items = read(node.path, data, scopes);
        if (items === null || items === undefined) {
          break;
        }
        if (!Array.isArray(items)) {
          throw new RenderProgramError(
            node.loc,
            `data-each="${node.path.source} as ${node.as}" needs an array, got ${describe(items)}`,
          );
        }
        for (const item of items) {
          run(node.body, data, [...scopes, item], options, out);
        }
        break;
      }
    }
  }
}

function read(path: RenderPath, data: unknown, scopes: readonly unknown[]): unknown {
  let current = path.scope === -1 ? data : scopes[path.scope];
  for (const key of path.keys) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, key)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function isTruthy(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return Boolean(value);
}

function toText(value: unknown, loc: RenderSourceLocation, label: string): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  throw new RenderProgramError(loc, `${label} needs a string or number, got ${describe(value)}`);
}

/** Every URL in the value is checked: `srcset` lists candidates, `ping` lists URLs. */
function safeAttributeUrl(name: string, value: string): string {
  if (name === 'srcset' || name === 'imagesrcset') {
    return value
      .split(',')
      .map((candidate) => {
        const [url = '', ...descriptors] = candidate.trim().split(/\s+/);
        return [safeUrl(url), ...descriptors].join(' ');
      })
      .join(', ');
  }
  if (name === 'ping') {
    return value.split(/\s+/).filter(Boolean).map(safeUrl).join(' ');
  }
  return safeUrl(value);
}

/**
 * Whether a zod-style schema's underlying object declares `field`, looking through wrappers
 * such as optional, default, refine and transform, and into unions and intersections. A schema
 * with no object inside declares nothing.
 */
export function schemaDeclaresField(schema: unknown, field: string): boolean {
  return declares(schema, field, new Set());
}

function declares(schema: unknown, field: string, seen: Set<unknown>): boolean {
  if (!schema || typeof schema !== 'object' || seen.has(schema)) {
    return false;
  }
  seen.add(schema);
  const shape = (schema as { shape?: unknown }).shape;
  if (shape && typeof shape === 'object') {
    return field in shape;
  }
  const def = (schema as { _def?: Record<string, unknown> })._def;
  if (!def) {
    return false;
  }
  const inner: unknown[] = [def.innerType, def.schema, def.in, def.type, def.left, def.right];
  if (typeof def.getter === 'function') {
    inner.push((def.getter as () => unknown)());
  }
  if (Array.isArray(def.options)) {
    inner.push(...def.options);
  }
  return inner.some((candidate) => declares(candidate, field, seen));
}

function safeUrl(value: string): string {
  const normalized = Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 0x20 && code !== 0x7f;
    })
    .join('')
    .toLowerCase();
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(normalized);
  if (scheme && !SAFE_URL_SCHEMES.has(scheme[1])) {
    return BLOCKED_URL;
  }
  return value;
}

function nodesUseCsrf(nodes: readonly RenderNode[]): boolean {
  return nodes.some(
    (node) =>
      typeof node !== 'string' &&
      (node.op === 'csrf' || ((node.op === 'if' || node.op === 'each') && nodesUseCsrf(node.body))),
  );
}

function describe(value: unknown): string {
  if (Array.isArray(value)) {
    return 'an array';
  }
  if (value === null) {
    return 'null';
  }
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
