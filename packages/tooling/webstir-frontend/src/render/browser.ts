import path from 'node:path';
import { load } from 'cheerio';
import { build as esbuild } from 'esbuild';
import {
  executeRenderProgram,
  programUsesCsrf,
  type RenderProgram,
} from '@webstir-io/module-contract';
import { BROWSER_PROGRAM_EXPORT } from '../runtime/browser-render.js';
import { importCurrent } from '../utils/backendModule.js';
import { ensureDir, pathExists, readFile, remove, writeFile } from '../utils/fs.js';
import { hasBindingAttribute } from './bindings.js';
import { compileRenderProgram } from './compile.js';
import { RenderTemplateError, type RenderIssue } from './issues.js';
import { isSchemaLike, type SchemaLike } from './schema.js';
import { prepareTemplateSource } from './source.js';
import { validateRenderProgram } from './validate.js';

/**
 * A page renders in the browser when a `data.ts` sits beside its `index.html`: the page script's
 * `load` supplies the data, and the same render program the server would run renders it there.
 * `data.ts` is read by the build only, so its schema never reaches the browser.
 */
const DATA_MODULES = ['data.ts', 'data.js'];

export interface BrowserPageData {
  readonly schema: SchemaLike;
  /** What the first load shows before `load` has run. */
  readonly initial: unknown;
}

export async function findPageDataModule(pageDirectory: string): Promise<string | undefined> {
  for (const name of DATA_MODULES) {
    const candidate = path.join(pageDirectory, name);
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/** Imports a page's `data.ts` as the build sees it now, resolving packages from the workspace. */
let dataLoads = 0;

export async function loadPageDataModule(
  dataModule: string,
  options: { readonly workspaceRoot: string; readonly page: string },
): Promise<BrowserPageData> {
  // Its own directory each time: Bun's module resolver caches directory listings, so a file added
  // to a directory it has already read (say, a second page's data.ts) would not be found.
  const loadDir = path.join(
    scratchRoot(options.workspaceRoot),
    'data',
    `${options.page.replaceAll('/', '__')}-${process.pid}-${++dataLoads}`,
  );
  const outfile = path.join(loadDir, 'data.mjs');
  await ensureDir(loadDir);
  await esbuild({
    entryPoints: [dataModule],
    bundle: true,
    packages: 'external',
    format: 'esm',
    platform: 'node',
    outfile,
    logLevel: 'silent',
  });
  const exports = await importCurrent(outfile).finally(() => remove(loadDir).catch(() => {}));
  const label = relativeLabel(options.workspaceRoot, dataModule);
  const fail = (message: string) =>
    new RenderTemplateError([{ loc: { file: label, line: 1 }, message: `${label} ${message}` }]);
  if (!isSchemaLike(exports.data)) {
    throw fail("must export `data`, a zod schema for the page's data");
  }
  if (!('initial' in exports)) {
    throw fail('must export `initial`, the data the page shows before `load` has run');
  }
  const parsed = (exports.data as ParsingSchema).safeParse?.(exports.initial);
  if (parsed && !parsed.success) {
    throw fail(`exports \`initial\` that does not match \`data\`: ${describeError(parsed.error)}`);
  }
  return { schema: exports.data, initial: parsed?.success ? parsed.data : exports.initial };
}

interface ParsingSchema {
  safeParse?(value: unknown): { success: true; data: unknown } | { success: false; error: unknown };
}

function describeError(error: unknown): string {
  const issues = (error as { issues?: { path?: unknown[]; message?: string }[] })?.issues;
  if (!Array.isArray(issues) || issues.length === 0) return String(error);
  return issues
    .map((issue) => `${issue.path?.length ? `${issue.path.join('.')}: ` : ''}${issue.message}`)
    .join('; ');
}

/**
 * Compiles a browser page's template and checks it the way a view's page is checked, every
 * binding against the page's schema, plus what a browser render can't do: it replaces the
 * page's `<main>` and `<title>`, so bindings live there, and it has no session to carry a
 * CSRF token, so it has no POST form.
 */
export async function compileBrowserPage(options: {
  readonly workspaceRoot: string;
  readonly partialsRoot: string;
  readonly page: string;
  readonly pageDirectory: string;
  readonly schema: SchemaLike;
}): Promise<RenderProgram> {
  const htmlPath = path.join(options.pageDirectory, 'index.html');
  const source = relativeLabel(options.workspaceRoot, htmlPath);
  const html = await readFile(htmlPath);
  const prepared = await prepareTemplateSource(html, htmlPath, options);
  const program = compileRenderProgram(prepared, { page: options.page, source });
  const issues = [
    ...bindingsOutsideMain(html, source, options.page),
    ...validateRenderProgram(program, options.schema, `page '${options.page}'`),
  ];
  if (programUsesCsrf(program)) {
    issues.push({
      loc: { file: source, line: 1 },
      message: `page '${options.page}' renders in the browser, so it can't have a POST form; render it on the server with a view, or post from its script`,
    });
  }
  if (issues.length > 0) {
    throw new RenderTemplateError(issues);
  }
  return program;
}

/**
 * An entry that is the page's own script plus its render program, so both bundlers ship them as
 * one module, and that starts the page's first load when client-nav is not there to. It is named
 * `index.ts` so the bundle keeps the page's `index.js` name.
 */
export async function writeBrowserPageEntry(options: {
  readonly workspaceRoot: string;
  readonly page: string;
  readonly entryPoint: string;
  readonly program: RenderProgram;
}): Promise<string> {
  const entry = path.join(scratchRoot(options.workspaceRoot), 'pages', options.page, 'index.ts');
  await ensureDir(path.dirname(entry));
  await writeFile(
    entry,
    [
      `import * as page from ${JSON.stringify(options.entryPoint)};`,
      "import { bootBrowserPage } from '@webstir-io/webstir-frontend/runtime';",
      `export * from ${JSON.stringify(options.entryPoint)};`,
      `export const ${BROWSER_PROGRAM_EXPORT} = ${JSON.stringify(options.program)};`,
      `bootBrowserPage({ ...page, ${BROWSER_PROGRAM_EXPORT} });`,
      '',
    ].join('\n'),
  );
  return entry;
}

/**
 * The page as its first load shows it: the built document rendered with the page's `initial`
 * data, so no binding reaches the browser.
 */
export function renderInitialDocument(
  html: string,
  options: { readonly page: string; readonly source: string; readonly initial: unknown },
): string {
  const program = compileRenderProgram(html, { page: options.page, source: options.source });
  return executeRenderProgram(program, options.initial, { csrfToken: false });
}

function bindingsOutsideMain(html: string, source: string, page: string): RenderIssue[] {
  const $ = load(html, { sourceCodeLocationInfo: true });
  const issues: RenderIssue[] = [];
  $('*').each((_, element) => {
    if (element.type !== 'tag' || !hasBindingAttribute(element.attribs)) return;
    if (element.tagName === 'title' || $(element).parents('main').length > 0) return;
    issues.push({
      loc: { file: source, line: element.sourceCodeLocation?.startLine ?? 1 },
      message:
        element.tagName === 'main'
          ? `page '${page}' renders in the browser, which replaces what is inside <main>, not <main> itself; move this binding inside it`
          : `page '${page}' renders in the browser, which replaces only its <main> and <title>; move this binding inside them`,
    });
  });
  return issues;
}

const PAGE_SCRIPTS = ['index.ts', 'index.tsx', 'index.js'];

/** A browser-rendered page needs a script: its `load` is where the data comes from. */
export async function assertBrowserPageScript(options: {
  readonly workspaceRoot: string;
  readonly page: string;
  readonly pageDirectory: string;
  readonly dataModule: string;
}): Promise<void> {
  for (const name of PAGE_SCRIPTS) {
    if (await pathExists(path.join(options.pageDirectory, name))) return;
  }
  const label = relativeLabel(options.workspaceRoot, options.dataModule);
  throw new RenderTemplateError([
    {
      loc: { file: label, line: 1 },
      message: `page '${options.page}' has ${label}, so it renders in the browser, but it has no index.ts to export load`,
    },
  ]);
}

/**
 * A browser render replaces only a page's `<main>` and `<title>`, so the app shell around them
 * can't have bindings or POST forms while any page renders in the browser: nothing would update
 * them, and nothing could supply a CSRF token.
 */
export async function assertShellRendersAnywhere(options: {
  readonly workspaceRoot: string;
  readonly appTemplate: string;
  readonly partialsRoot: string;
  readonly page: string;
}): Promise<void> {
  if (!(await pathExists(options.appTemplate))) return;
  const html = await readFile(options.appTemplate);
  const source = relativeLabel(options.workspaceRoot, options.appTemplate);
  const prepared = await prepareTemplateSource(html, options.appTemplate, options);
  const program = compileRenderProgram(prepared, { page: 'app', source });
  const first = program.bindings > 0 ? firstBindingLocation(program.nodes) : undefined;
  const issues: RenderIssue[] = [];
  if (first) {
    issues.push({
      loc: first,
      message: `page '${options.page}' renders in the browser, so the app shell can't have bindings; only the page's <main> and <title> are rendered`,
    });
  }
  if (programUsesCsrf(program)) {
    issues.push({
      loc: { file: source, line: 1 },
      message: `page '${options.page}' renders in the browser, so the app shell can't have a POST form`,
    });
  }
  if (issues.length > 0) throw new RenderTemplateError(issues);
}

function firstBindingLocation(
  nodes: RenderProgram['nodes'],
): { file: string; line: number } | undefined {
  for (const node of nodes) {
    if (typeof node !== 'string' && node.op !== 'csrf') return node.loc;
  }
  return undefined;
}

/** Build-only files; nothing under here is served. */
function scratchRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, 'build', '.webstir', 'browser-pages');
}

function relativeLabel(workspaceRoot: string, filePath: string): string {
  return path.relative(workspaceRoot, filePath).split(path.sep).join('/');
}
