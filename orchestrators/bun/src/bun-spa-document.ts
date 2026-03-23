import { existsSync } from 'node:fs';
import path from 'node:path';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';

export interface BunSpaEntryPaths {
  readonly workspaceRoot: string;
  readonly appTemplatePath: string;
  readonly appCssPath: string;
  readonly appScriptPath?: string;
  readonly generatedRoot: string;
}

export interface BunSpaPageDetails {
  readonly name: string;
  readonly routePath: string;
  readonly directory: string;
  readonly htmlPath: string;
  readonly scriptPath?: string;
  readonly cssPath?: string;
}

export interface BunSpaGeneratedPagePaths {
  readonly generatedPageRoot: string;
  readonly generatedEntryPath: string;
  readonly generatedCssPath: string;
}

export interface RegenerateBunSpaEntryOptions {
  readonly paths: BunSpaEntryPaths;
  readonly page: BunSpaPageDetails;
}

const GENERATED_DIR = path.join('.webstir', 'bun-first-spa');
const GENERATED_ENTRY = 'index.html';
const GENERATED_PAGE_CSS = 'page.css';
const PAGE_SCRIPT_NAMES = ['index.ts', 'index.tsx', 'index.js', 'index.jsx'] as const;

export function resolveBunSpaEntryPaths(workspaceRoot: string): BunSpaEntryPaths {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const generatedRoot = path.join(resolvedWorkspaceRoot, GENERATED_DIR);
  const appRoot = path.join(resolvedWorkspaceRoot, 'src', 'frontend', 'app');

  return {
    workspaceRoot: resolvedWorkspaceRoot,
    appTemplatePath: path.join(appRoot, 'app.html'),
    appCssPath: path.join(appRoot, 'app.css'),
    appScriptPath: resolveOptionalExistingFileSync(appRoot, [
      'app.ts',
      'app.tsx',
      'app.js',
      'app.jsx',
    ]),
    generatedRoot,
  };
}

export async function resolveBunSpaPages(
  workspaceRoot: string,
): Promise<readonly BunSpaPageDetails[]> {
  const pagesRoot = path.join(workspaceRoot, 'src', 'frontend', 'pages');
  const directories = await collectSpaPageDirectories(pagesRoot);
  if (directories.length === 0) {
    throw new Error(`No SPA pages found under ${pagesRoot}.`);
  }

  const pages = await Promise.all(
    directories.map(async (directory) => {
      const pageName = normalizeForwardSlashes(path.relative(pagesRoot, directory));
      const htmlPath = path.join(directory, 'index.html');
      const scriptPath = await resolveOptionalFile(directory, PAGE_SCRIPT_NAMES);
      const cssPath = await resolveOptionalFile(directory, ['index.css']);

      return {
        name: pageName,
        routePath: pageName === 'home' ? '/' : `/${pageName}`,
        directory,
        htmlPath,
        scriptPath,
        cssPath,
      } satisfies BunSpaPageDetails;
    }),
  );

  pages.sort((left, right) => comparePageNames(left.name, right.name));
  return pages;
}

export function resolveBunSpaGeneratedPagePaths(
  paths: BunSpaEntryPaths,
  page: BunSpaPageDetails,
): BunSpaGeneratedPagePaths {
  const generatedPageRoot = path.join(paths.generatedRoot, ...page.name.split('/'));
  return {
    generatedPageRoot,
    generatedEntryPath: path.join(generatedPageRoot, GENERATED_ENTRY),
    generatedCssPath: path.join(generatedPageRoot, GENERATED_PAGE_CSS),
  };
}

export async function prepareBunSpaGeneratedEntries(options: {
  readonly paths: BunSpaEntryPaths;
  readonly pages: readonly BunSpaPageDetails[];
}): Promise<void> {
  await mkdir(options.paths.generatedRoot, { recursive: true });

  for (const page of options.pages) {
    await regenerateBunSpaEntry({
      paths: options.paths,
      page,
    });
  }
}

export async function regenerateBunSpaEntry(options: RegenerateBunSpaEntryOptions): Promise<void> {
  const generatedPaths = resolveBunSpaGeneratedPagePaths(options.paths, options.page);
  await mkdir(generatedPaths.generatedPageRoot, { recursive: true });
  const appTemplate = await readFile(options.paths.appTemplatePath, 'utf8');
  const pageHtml = await readFile(options.page.htmlPath, 'utf8');
  const title = extractTitle(pageHtml) ?? extractTitle(appTemplate) ?? 'Webstir SPA';
  const appHead = stripTitle(extractTagContents(appTemplate, 'head') ?? '');
  const pageHead = stripAssetTags(stripTitle(extractTagContents(pageHtml, 'head') ?? ''));
  const mainHtml = extractTagContents(pageHtml, 'main') ?? '';
  const appBodyClass = extractTagAttribute(appTemplate, 'body', 'class');
  const pageBodyClass = extractTagAttribute(pageHtml, 'body', 'class');
  const bodyClass = [appBodyClass, pageBodyClass].filter(Boolean).join(' ').trim();
  const relativeAppScriptPath = options.paths.appScriptPath
    ? toRelativeModulePath(generatedPaths.generatedEntryPath, options.paths.appScriptPath)
    : undefined;
  const relativeScriptPath = options.page.scriptPath
    ? toRelativeModulePath(generatedPaths.generatedEntryPath, options.page.scriptPath)
    : undefined;
  const relativeStylesheetPath = await writeGeneratedPageCss({
    generatedCssPath: generatedPaths.generatedCssPath,
    generatedEntryPath: generatedPaths.generatedEntryPath,
    pageCssPath: options.page.cssPath,
    appCssPath: options.paths.appCssPath,
  });
  const bodyClassAttribute = bodyClass.length > 0 ? ` class="${escapeAttribute(bodyClass)}"` : '';

  const output = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>${escapeHtml(title)}</title>
  ${appHead.trim()}
  ${pageHead.trim()}
  <link rel="stylesheet" href="${relativeStylesheetPath}" />
</head>
<body${bodyClassAttribute}>
  <main>${mainHtml}</main>
  ${relativeAppScriptPath ? `<script type="module" src="${relativeAppScriptPath}"></script>` : ''}
  ${relativeScriptPath ? `<script type="module" src="${relativeScriptPath}"></script>` : ''}
</body>
</html>
`;

  await writeFile(generatedPaths.generatedEntryPath, output, 'utf8');
}

async function resolveOptionalFile(
  directory: string,
  names: readonly string[],
): Promise<string | undefined> {
  for (const name of names) {
    const candidate = path.join(directory, name);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Fall through.
    }
  }

  return undefined;
}

interface WriteGeneratedPageCssOptions {
  readonly generatedCssPath: string;
  readonly generatedEntryPath: string;
  readonly pageCssPath?: string;
  readonly appCssPath: string;
}

async function writeGeneratedPageCss(options: WriteGeneratedPageCssOptions): Promise<string> {
  const appCssImport = `@import "${toRelativeModulePath(options.generatedCssPath, options.appCssPath)}";`;
  let css = appCssImport;

  if (options.pageCssPath) {
    const sourceCss = await readFile(options.pageCssPath, 'utf8');
    const rewritten = sourceCss.replace(/@import\s+["']@app\/app\.css["'];?\s*/gi, '');
    css = `${appCssImport}\n${rewritten.trim()}\n`;
  } else {
    css = `${appCssImport}\n`;
  }

  await writeFile(options.generatedCssPath, css, 'utf8');
  return toRelativeModulePath(options.generatedEntryPath, options.generatedCssPath);
}

function extractTagContents(html: string, tagName: string): string | null {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = html.match(pattern);
  return match?.[1] ?? null;
}

function extractTagAttribute(
  html: string,
  tagName: string,
  attributeName: string,
): string | undefined {
  const tagPattern = new RegExp(`<${tagName}\\b([^>]*)>`, 'i');
  const tagMatch = html.match(tagPattern);
  if (!tagMatch?.[1]) {
    return undefined;
  }

  const attributePattern = new RegExp(`${attributeName}="([^"]*)"`, 'i');
  const attributeMatch = tagMatch[1].match(attributePattern);
  return attributeMatch?.[1];
}

function extractTitle(html: string): string | undefined {
  const title = extractTagContents(html, 'title');
  return title?.trim() || undefined;
}

function stripTitle(html: string): string {
  return html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '').trim();
}

function stripAssetTags(html: string): string {
  return html
    .replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi, '')
    .replace(/<script\b[^>]*src=["'][^"']+["'][^>]*><\/script>/gi, '')
    .trim();
}

function toRelativeModulePath(fromFile: string, targetFile: string): string {
  const relativePath = path.relative(path.dirname(fromFile), targetFile).split(path.sep).join('/');
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', '&quot;');
}

function resolveOptionalExistingFileSync(
  directory: string,
  names: readonly string[],
): string | undefined {
  for (const name of names) {
    const candidate = path.join(directory, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

async function collectSpaPageDirectories(root: string): Promise<string[]> {
  try {
    await access(root);
  } catch {
    return [];
  }

  const directories: string[] = [];
  const stack = [path.resolve(root)];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const entries = await readdir(current, { withFileTypes: true });
    const hasIndexHtml = entries.some((entry) => entry.isFile() && entry.name === 'index.html');
    if (hasIndexHtml) {
      directories.push(current);
      continue;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        stack.push(path.join(current, entry.name));
      }
    }
  }

  return directories;
}

function comparePageNames(left: string, right: string): number {
  if (left === 'home') {
    return -1;
  }

  if (right === 'home') {
    return 1;
  }

  return left.localeCompare(right);
}

function normalizeForwardSlashes(value: string): string {
  return value.split(path.sep).join('/');
}
