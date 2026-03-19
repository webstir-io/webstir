import path from 'node:path';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';

export interface BunSpaEntryPaths {
  readonly workspaceRoot: string;
  readonly appTemplatePath: string;
  readonly appCssPath: string;
  readonly generatedRoot: string;
  readonly generatedEntryPath: string;
  readonly generatedCssPath: string;
}

export interface BunSpaPageDetails {
  readonly name: string;
  readonly directory: string;
  readonly htmlPath: string;
  readonly scriptPath: string;
  readonly cssPath?: string;
}

export interface RegenerateBunSpaEntryOptions {
  readonly paths: BunSpaEntryPaths;
  readonly page: BunSpaPageDetails;
}

const GENERATED_DIR = path.join('.webstir', 'bun-first-spa');
const GENERATED_ENTRY = 'index.html';
const GENERATED_PAGE_CSS = 'page.css';

export function resolveBunSpaEntryPaths(workspaceRoot: string): BunSpaEntryPaths {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const generatedRoot = path.join(resolvedWorkspaceRoot, GENERATED_DIR);

  return {
    workspaceRoot: resolvedWorkspaceRoot,
    appTemplatePath: path.join(resolvedWorkspaceRoot, 'src', 'frontend', 'app', 'app.html'),
    appCssPath: path.join(resolvedWorkspaceRoot, 'src', 'frontend', 'app', 'app.css'),
    generatedRoot,
    generatedEntryPath: path.join(generatedRoot, GENERATED_ENTRY),
    generatedCssPath: path.join(generatedRoot, GENERATED_PAGE_CSS),
  };
}

export async function resolvePrimaryBunSpaPage(workspaceRoot: string): Promise<BunSpaPageDetails> {
  const pagesRoot = path.join(workspaceRoot, 'src', 'frontend', 'pages');
  const entries = (await readdir(pagesRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => {
      if (left === 'home') {
        return -1;
      }
      if (right === 'home') {
        return 1;
      }
      return left.localeCompare(right);
    });

  const pageName = entries[0];
  if (!pageName) {
    throw new Error(`No SPA pages found under ${pagesRoot}.`);
  }

  const directory = path.join(pagesRoot, pageName);
  const htmlPath = path.join(directory, 'index.html');
  const scriptPath = await resolveExistingFile(directory, ['index.ts', 'index.tsx', 'index.js', 'index.jsx']);
  const cssPath = await resolveOptionalFile(directory, ['index.css']);

  return {
    name: pageName,
    directory,
    htmlPath,
    scriptPath,
    cssPath,
  };
}

export async function prepareBunSpaGeneratedEntry(options: RegenerateBunSpaEntryOptions): Promise<void> {
  await mkdir(options.paths.generatedRoot, { recursive: true });
  await regenerateBunSpaEntry(options);
}

export async function regenerateBunSpaEntry(options: RegenerateBunSpaEntryOptions): Promise<void> {
  const appTemplate = await readFile(options.paths.appTemplatePath, 'utf8');
  const pageHtml = await readFile(options.page.htmlPath, 'utf8');
  const title = extractTitle(pageHtml) ?? extractTitle(appTemplate) ?? 'Webstir SPA';
  const appHead = stripTitle(extractTagContents(appTemplate, 'head') ?? '');
  const pageHead = stripAssetTags(stripTitle(extractTagContents(pageHtml, 'head') ?? ''));
  const mainHtml = extractTagContents(pageHtml, 'main') ?? '';
  const appBodyClass = extractTagAttribute(appTemplate, 'body', 'class');
  const pageBodyClass = extractTagAttribute(pageHtml, 'body', 'class');
  const bodyClass = [appBodyClass, pageBodyClass].filter(Boolean).join(' ').trim();
  const relativeScriptPath = toRelativeModulePath(options.paths.generatedEntryPath, options.page.scriptPath);
  const relativeStylesheetPath = await writeGeneratedPageCss({
    generatedCssPath: options.paths.generatedCssPath,
    generatedEntryPath: options.paths.generatedEntryPath,
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
  <script type="module" src="${relativeScriptPath}"></script>
</body>
</html>
`;

  await writeFile(options.paths.generatedEntryPath, output, 'utf8');
}

async function resolveExistingFile(directory: string, names: readonly string[]): Promise<string> {
  for (const name of names) {
    const candidate = path.join(directory, name);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Fall through.
    }
  }

  throw new Error(`No entry file found in ${directory}.`);
}

async function resolveOptionalFile(directory: string, names: readonly string[]): Promise<string | undefined> {
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

function extractTagAttribute(html: string, tagName: string, attributeName: string): string | undefined {
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
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', '&quot;');
}
