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
 * Writes the page's program beside it when the server has something to render. A page whose
 * bindings were all settled by the build, text given with `data-with-<name>`, needs none: what
 * it compiled to is returned, to be written as the page in place of its template.
 */
export async function writePageProgram(
  html: string,
  options: { readonly page: string; readonly source: string; readonly targetDir: string },
): Promise<string | undefined> {
  const { program, settled } = compilePage(html, { page: options.page, source: options.source });
  const programPath = path.join(options.targetDir, RENDER_PROGRAM_FILE);
  if (programNeedsRuntime(program)) {
    await writeJson(programPath, program);
    return undefined;
  }
  await remove(programPath);
  return settled ? program.nodes.join('') : undefined;
}

export function stripSourceStamps(html: string): string {
  return html.replace(STAMP_PATTERN, '');
}
