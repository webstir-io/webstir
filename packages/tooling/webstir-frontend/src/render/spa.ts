import path from 'node:path';

import type { RenderNode, RenderSourceLocation } from '@webstir-io/module-contract';

import { getPageDirectories } from '../core/pages.js';
import { pathExists, readFile } from '../utils/fs.js';
import { mayContainBindings } from './bindings.js';
import { compileRenderProgram } from './compile.js';
import { RenderTemplateError, type RenderIssue } from './issues.js';
import { prepareTemplateSource } from './source.js';

/**
 * An SPA has no server and no build-time data, so nothing would fill a page's bindings: its
 * placeholders would ship as the page. Templates are checked from source, so watch, build and
 * publish all fail the same way.
 */
export async function assertNoSpaBindings(options: {
  readonly workspaceRoot: string;
  readonly appTemplate: string;
  readonly pagesRoot: string;
  readonly partialsRoot: string;
}): Promise<void> {
  const templates = [
    { label: 'the app template', name: 'app', file: options.appTemplate },
    ...(await getPageDirectories(options.pagesRoot)).map((page) => ({
      label: `page '${page.name}'`,
      name: page.name,
      file: path.join(page.directory, 'index.html'),
    })),
  ];
  const issues: RenderIssue[] = [];
  for (const template of templates) {
    if (!(await pathExists(template.file))) {
      continue;
    }
    const html = await readFile(template.file);
    if (!mayContainBindings(html)) {
      continue;
    }
    const source = path.relative(options.workspaceRoot, template.file).split(path.sep).join('/');
    const prepared = await prepareTemplateSource(html, template.file, options);
    const program = compileRenderProgram(prepared, { page: template.name, source });
    const first = program.bindings > 0 ? firstBinding(program.nodes) : undefined;
    if (first) {
      issues.push({
        loc: first,
        message: `${template.label} has bindings, but an SPA has no server to render them; use full mode, or ssg with a view that renders the page`,
      });
    }
  }
  if (issues.length > 0) {
    throw new RenderTemplateError(issues);
  }
}

function firstBinding(nodes: readonly RenderNode[]): RenderSourceLocation | undefined {
  for (const node of nodes) {
    if (typeof node !== 'string' && node.op !== 'csrf') {
      return node.loc;
    }
  }
  return undefined;
}
