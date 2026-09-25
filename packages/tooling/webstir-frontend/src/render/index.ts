import path from 'node:path';
import { RENDER_PROGRAM_FILE } from '@webstir-io/module-contract';
import { remove, writeJson } from '../utils/fs.js';
import { SOURCE_STAMP_ATTRIBUTE } from './bindings.js';
import { compileRenderProgram, programNeedsRuntime } from './compile.js';

export { mayContainBindings } from './bindings.js';
export { compileRenderProgram, programNeedsRuntime } from './compile.js';
export { RenderTemplateError, formatRenderIssues, type RenderIssue } from './issues.js';
export { prepareTemplateSource, type TemplateSourceOptions } from './source.js';
export { assertNoSpaBindings } from './spa.js';
export { validateRenderProgram, validateRenderPrograms } from './validate.js';

const STAMP_PATTERN = new RegExp(`\\s${SOURCE_STAMP_ATTRIBUTE}="[^"]*"`, 'g');

export async function writePageProgram(
  html: string,
  options: { readonly page: string; readonly source: string; readonly targetDir: string },
): Promise<void> {
  const program = compileRenderProgram(html, { page: options.page, source: options.source });
  const programPath = path.join(options.targetDir, RENDER_PROGRAM_FILE);
  if (programNeedsRuntime(program)) {
    await writeJson(programPath, program);
  } else {
    await remove(programPath);
  }
}

export function stripSourceStamps(html: string): string {
  return html.replace(STAMP_PATTERN, '');
}
