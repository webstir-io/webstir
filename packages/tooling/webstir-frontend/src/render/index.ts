import path from 'node:path';
import { RENDER_PROGRAM_FILE } from '@webstir-io/module-contract';
import { remove, writeJson } from '../utils/fs.js';
import { SOURCE_STAMP_ATTRIBUTE } from './bindings.js';
import { compilePage, programNeedsRuntime } from './compile.js';

export { mayContainBindings } from './bindings.js';
export { compileRenderProgram, programNeedsRuntime } from './compile.js';
export { RenderTemplateError, formatRenderIssues, type RenderIssue } from './issues.js';
export { prepareTemplateSource, type TemplateSourceOptions } from './source.js';
export { findPageDataModule } from './browser.js';
export { validateRenderProgram, validateRenderPrograms } from './validate.js';

const STAMP_PATTERN = new RegExp(`\\s${SOURCE_STAMP_ATTRIBUTE}="[^"]*"`, 'g');

/**
 * Writes the page's program beside it when the server has something to render. A page that gave
 * names with `data-with-<name>` and leaves nothing to render but a CSRF field is also served as
 * a file when no view renders it, so what it compiled to is returned, to be written as the page
 * in place of its template.
 */
export async function writePageProgram(
  html: string,
  options: { readonly page: string; readonly source: string; readonly targetDir: string },
): Promise<string | undefined> {
  const { program, settled } = compilePage(html, { page: options.page, source: options.source });
  const programPath = path.join(options.targetDir, RENDER_PROGRAM_FILE);
  if (programNeedsRuntime(program)) {
    await writeJson(programPath, program);
  } else {
    await remove(programPath);
  }
  const text = program.nodes.filter((node) => typeof node === 'string' || node.op !== 'csrf');
  return settled && text.every((node) => typeof node === 'string') ? text.join('') : undefined;
}

export function stripSourceStamps(html: string): string {
  return html.replace(STAMP_PATTERN, '');
}
