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
import { findPageDataModule } from './browser.js';
import { RenderTemplateError, type RenderIssue } from './issues.js';
import {
  checkAttribute,
  checkText,
  declaresKey,
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
  const moduleDefinition = await loadBackendModuleDefinition<{
    views?: readonly ViewLike[];
    shell?: { readonly data?: unknown; readonly load?: unknown };
  }>(options.workspaceRoot);
  const issues: RenderIssue[] = [];
  const moduleShell = moduleDefinition?.shell;
  const shellSchema = moduleShell?.data;
  // A shell binds only with both halves: without its loader, `shell.*` would render empty.
  const shell =
    isSchemaLike(shellSchema) && typeof moduleShell?.load === 'function' ? shellSchema : undefined;
  if (moduleShell && !shell) {
    issues.push({
      loc: { file: 'src/backend/module.ts', line: 1 },
      message:
        'the module exports a `shell` without both a zod `data` schema and a `load` function',
    });
  }
  const claims = new Map<string, ViewLike[]>();
  for (const view of moduleDefinition?.views ?? []) {
    const page = view.definition?.page;
    if (page) {
      claims.set(page, [...(claims.get(page) ?? []), view]);
    }
  }

  const sourcePagesRoot =
    options.sourcePagesRoot ?? path.join(options.workspaceRoot, 'src', 'frontend', 'pages');

  for (const [page, views] of claims) {
    const source = path.join(sourcePagesRoot, page, 'index.html');
    const sourceLabel = path.relative(options.workspaceRoot, source).split(path.sep).join('/');
    const dataModule = await findPageDataModule(path.join(sourcePagesRoot, page));
    if (dataModule) {
      const dataLabel = path.relative(options.workspaceRoot, dataModule).split(path.sep).join('/');
      for (const view of views) {
        issues.push({
          loc: { file: dataLabel, line: 1 },
          message: `page '${page}' renders in the browser (it has ${dataLabel}), and view ${viewName(view)} also renders it; keep one`,
        });
      }
      continue;
    }
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
      if (shell && declaresKey(flattenSchema(view.data), 'shell')) {
        issues.push({
          loc: { file: program.source, line: 1 },
          message: `view ${viewName(view)} has its own \`shell\` data, which the module's shell replaces; rename it`,
        });
        continue;
      }
      issues.push(...validateRenderProgram(program, view.data, `view ${viewName(view)}`, shell));
    }
  }

  for (const page of await getPageDirectories(options.pagesRoot)) {
    if (
      claims.has(page.name) ||
      (await findPageDataModule(path.join(sourcePagesRoot, page.name)))
    ) {
      continue;
    }
    const program = await readProgram(path.join(page.directory, RENDER_PROGRAM_FILE));
    const first = program && program.bindings > 0 ? firstBinding(program.nodes) : undefined;
    if (first) {
      issues.push({
        loc: first,
        message: `page '${page.name}' has bindings, but nothing renders it; add \`page: '${page.name}'\` to a view definition, or a data.ts beside it to render it in the browser`,
      });
    }
  }

  if (issues.length > 0) {
    throw new RenderTemplateError(issues);
  }
}

/** `renderer` names what supplies the data, as issues report it: `view clientsPage`, `page 'items'`. */
export function validateRenderProgram(
  program: RenderProgram,
  dataSchema: SchemaLike,
  renderer: string,
  /** The app's shell data schema: every page a view renders binds it as `shell`. */
  shellSchema?: SchemaLike,
): RenderIssue[] {
  const issues: RenderIssue[] = [];
  const shell = shellSchema ? flattenSchema(shellSchema) : undefined;
  walk(program.nodes, flattenSchema(dataSchema), [], [], renderer, issues, shell);
  return issues;
}

function walk(
  nodes: readonly RenderNode[],
  root: readonly SchemaLike[],
  scopes: readonly (readonly SchemaLike[])[],
  loops: readonly string[],
  view: string,
  issues: RenderIssue[],
  shell?: readonly SchemaLike[],
): void {
  for (const node of nodes) {
    if (typeof node === 'string' || node.op === 'csrf') {
      continue;
    }
    const label = bindingLabel(node);
    const report = (message: string) => {
      issues.push({ loc: node.loc, message: `${label}: ${message} (${view})` });
    };

    const resolved = resolve(node.path, root, scopes, loops, shell);
    if ('error' in resolved) {
      report(resolved.error);
      if (node.op === 'if') {
        walk(node.body, root, scopes, loops, view, issues, shell);
      }
      continue;
    }

    if (node.op === 'text') {
      const problem = checkText(resolved.ok);
      if (problem) {
        report(`\`${node.path.source}\` ${problem}`);
      }
    } else if (node.op === 'attr') {
      // An island's props may be any value that has JSON; a text attribute needs a scalar.
      const problem = node.json ? undefined : checkAttribute(resolved.ok);
      if (problem) {
        report(`\`${node.path.source}\` ${problem}`);
      }
    } else if (node.op === 'if') {
      walk(node.body, root, scopes, loops, view, issues, shell);
    } else {
      const element = elementOf(resolved.ok);
      if ('error' in element) {
        report(`\`${node.path.source}\` ${element.error}`);
        continue;
      }
      walk(node.body, root, [...scopes, element.ok], [...loops, node.as], view, issues, shell);
    }
  }
}

function resolve(
  renderPath: RenderPath,
  root: readonly SchemaLike[],
  scopes: readonly (readonly SchemaLike[])[],
  loops: readonly string[],
  shell?: readonly SchemaLike[],
): { ok: readonly SchemaLike[] } | { error: string } {
  let current = renderPath.scope === -1 ? root : scopes[renderPath.scope];
  if (!current) {
    return { error: `\`${renderPath.source}\` refers to a loop that is not in scope` };
  }
  // Named by what it reads, which is not what was written when `data-with-<name>` gave the name.
  const read = renderPath.scope === -1 ? [] : [loops[renderPath.scope]];

  for (const [index, key] of renderPath.keys.entries()) {
    const result = lookupKey(current, key);
    if ('error' in result) {
      if (renderPath.scope === -1 && index === 0 && key === 'flash') {
        current = FLASH;
        read.push(key);
        continue;
      }
      if (renderPath.scope === -1 && index === 0 && key === 'shell' && shell) {
        current = shell;
        read.push(key);
        continue;
      }
      const owner = read.length === 0 ? 'the view data' : `\`${read.join('.')}\``;
      return { error: `${owner} ${result.error}` };
    }
    current = result.ok;
    read.push(key);
  }
  return { ok: current };
}

function bindingLabel(node: Exclude<RenderNode, string | { op: 'csrf' }>): string {
  switch (node.op) {
    case 'text':
      return `data-text="${node.path.source}"`;
    case 'attr':
      return node.json
        ? `data-props="${node.path.source}"`
        : `data-attr-${node.name}="${node.path.source}"`;
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
