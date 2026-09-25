import path from 'node:path';
import {
  RENDER_PROGRAM_FILE,
  renderFlashSchema,
  renderProgramSchema,
  type RenderNode,
  type RenderPath,
  type RenderProgram,
  type RenderSourceLocation,
} from '@webstir-io/module-contract';
import { getPageDirectories } from '../core/pages.js';
import { loadBackendModuleDefinition } from '../utils/backendModule.js';
import { pathExists, readJson } from '../utils/fs.js';
import { RenderTemplateError, type RenderIssue } from './issues.js';
import {
  checkAttribute,
  checkText,
  elementOf,
  flattenSchema,
  isSchemaLike,
  lookupKey,
  type SchemaLike,
} from './schema.js';

export interface ValidateRenderProgramsOptions {
  readonly workspaceRoot: string;
  readonly pagesRoot: string;
  readonly sourcePagesRoot?: string;
}

interface ViewLike {
  readonly definition?: { readonly name?: string; readonly path?: string; readonly page?: string };
  readonly data?: unknown;
}

const FLASH = flattenSchema(renderFlashSchema as unknown as SchemaLike);

export async function validateRenderPrograms(
  options: ValidateRenderProgramsOptions,
): Promise<void> {
  const moduleDefinition = await loadBackendModuleDefinition<{ views?: readonly ViewLike[] }>(
    options.workspaceRoot,
  );
  const claims = new Map<string, ViewLike[]>();
  for (const view of moduleDefinition?.views ?? []) {
    const page = view.definition?.page;
    if (page) {
      claims.set(page, [...(claims.get(page) ?? []), view]);
    }
  }

  const issues: RenderIssue[] = [];
  const sourcePagesRoot =
    options.sourcePagesRoot ?? path.join(options.workspaceRoot, 'src', 'frontend', 'pages');

  for (const [page, views] of claims) {
    const source = path.join(sourcePagesRoot, page, 'index.html');
    const sourceLabel = path.relative(options.workspaceRoot, source).split(path.sep).join('/');
    if (!(await pathExists(source))) {
      for (const view of views) {
        issues.push({
          loc: { file: sourceLabel, line: 1 },
          message: `view ${viewName(view)} renders page '${page}', but ${sourceLabel} does not exist`,
        });
      }
      continue;
    }

    const program = await readProgram(path.join(options.pagesRoot, page, RENDER_PROGRAM_FILE));
    if (!program) {
      continue;
    }
    for (const view of views) {
      if (!isSchemaLike(view.data)) {
        issues.push({
          loc: { file: program.source, line: 1 },
          message: `view ${viewName(view)} renders page '${page}' but has no zod \`data\` schema`,
        });
        continue;
      }
      issues.push(...validateRenderProgram(program, view.data, viewName(view)));
    }
  }

  for (const page of await getPageDirectories(options.pagesRoot)) {
    if (claims.has(page.name)) {
      continue;
    }
    const program = await readProgram(path.join(page.directory, RENDER_PROGRAM_FILE));
    const first = program && program.bindings > 0 ? firstBinding(program.nodes) : undefined;
    if (first) {
      issues.push({
        loc: first,
        message: `page '${page.name}' has bindings, but no view renders it; add \`page: '${page.name}'\` to a view definition`,
      });
    }
  }

  if (issues.length > 0) {
    throw new RenderTemplateError(issues);
  }
}

export function validateRenderProgram(
  program: RenderProgram,
  dataSchema: SchemaLike,
  view: string,
): RenderIssue[] {
  const issues: RenderIssue[] = [];
  walk(program.nodes, flattenSchema(dataSchema), [], view, issues);
  return issues;
}

function walk(
  nodes: readonly RenderNode[],
  root: readonly SchemaLike[],
  scopes: readonly (readonly SchemaLike[])[],
  view: string,
  issues: RenderIssue[],
): void {
  for (const node of nodes) {
    if (typeof node === 'string' || node.op === 'csrf') {
      continue;
    }
    const label = bindingLabel(node);
    const report = (message: string) => {
      issues.push({ loc: node.loc, message: `${label}: ${message} (view ${view})` });
    };

    const resolved = resolve(node.path, root, scopes);
    if ('error' in resolved) {
      report(resolved.error);
      if (node.op === 'if') {
        walk(node.body, root, scopes, view, issues);
      }
      continue;
    }

    if (node.op === 'text') {
      const problem = checkText(resolved.ok);
      if (problem) {
        report(`\`${node.path.source}\` ${problem}`);
      }
    } else if (node.op === 'attr') {
      const problem = checkAttribute(resolved.ok);
      if (problem) {
        report(`\`${node.path.source}\` ${problem}`);
      }
    } else if (node.op === 'if') {
      walk(node.body, root, scopes, view, issues);
    } else {
      const element = elementOf(resolved.ok);
      if ('error' in element) {
        report(`\`${node.path.source}\` ${element.error}`);
        continue;
      }
      walk(node.body, root, [...scopes, element.ok], view, issues);
    }
  }
}

function resolve(
  renderPath: RenderPath,
  root: readonly SchemaLike[],
  scopes: readonly (readonly SchemaLike[])[],
): { ok: readonly SchemaLike[] } | { error: string } {
  let current = renderPath.scope === -1 ? root : scopes[renderPath.scope];
  if (!current) {
    return { error: `\`${renderPath.source}\` refers to a loop that is not in scope` };
  }
  const segments = renderPath.source.split('.');
  let consumed = renderPath.scope === -1 ? 0 : 1;

  for (const [index, key] of renderPath.keys.entries()) {
    const result = lookupKey(current, key);
    if ('error' in result) {
      if (renderPath.scope === -1 && index === 0 && key === 'flash') {
        current = FLASH;
        consumed += 1;
        continue;
      }
      const owner =
        consumed === 0 ? 'the view data' : `\`${segments.slice(0, consumed).join('.')}\``;
      return { error: `${owner} ${result.error}` };
    }
    current = result.ok;
    consumed += 1;
  }
  return { ok: current };
}

function bindingLabel(node: Exclude<RenderNode, string | { op: 'csrf' }>): string {
  switch (node.op) {
    case 'text':
      return `data-text="${node.path.source}"`;
    case 'attr':
      return `data-attr-${node.name}="${node.path.source}"`;
    case 'if':
      return `data-if="${node.negate ? '!' : ''}${node.path.source}"`;
    case 'each':
      return `data-each="${node.path.source} as ${node.as}"`;
  }
}

function firstBinding(nodes: readonly RenderNode[]): RenderSourceLocation | undefined {
  for (const node of nodes) {
    if (typeof node === 'string' || node.op === 'csrf') {
      continue;
    }
    return node.loc;
  }
  return undefined;
}

async function readProgram(programPath: string): Promise<RenderProgram | undefined> {
  if (!(await pathExists(programPath))) {
    return undefined;
  }
  const parsed = renderProgramSchema.safeParse(await readJson(programPath));
  if (!parsed.success) {
    throw new Error(`Render program ${programPath} is not valid: ${parsed.error.message}`);
  }
  return parsed.data;
}

function viewName(view: ViewLike): string {
  return view.definition?.name ?? view.definition?.path ?? 'unnamed';
}
