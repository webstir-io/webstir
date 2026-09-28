import path from 'node:path';

import type { RenderNode, RenderSourceLocation } from '@webstir-io/module-contract';

import { getPageDirectories } from '../core/pages.js';
import { pathExists, readFile } from '../utils/fs.js';
import { mayContainBindings } from './bindings.js';
import { findPageDataModule } from './browser.js';
import { compileRenderProgram } from './compile.js';
import { RenderTemplateError, type RenderIssue } from './issues.js';
import { prepareTemplateSource } from './source.js';

/**
 * An SPA has no server and no build-time data, so only a page that renders in the browser (one with
 * a data.ts) can fill its bindings; any other page's placeholders would ship as the page. Templates are checked from source, so watch, build and
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
      directory: page.directory,
    })),
  ];
  const issues: RenderIssue[] = [];
  for (const template of templates) {
    if (!(await pathExists(template.file))) {
      continue;
    }
    // A page with a data.ts renders in the browser, which an SPA can do.
    if ('directory' in template && (await findPageDataModule(template.directory))) {
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
        message: `${template.label} has bindings, but an SPA has no server to render them; add a data.ts beside the page to render it in the browser`,
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
