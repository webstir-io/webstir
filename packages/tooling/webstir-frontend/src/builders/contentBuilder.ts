import path from 'node:path';
import { marked } from 'marked';
import { load } from 'cheerio';
import type { Cheerio } from 'cheerio';
import type { AnyNode } from 'domhandler';
import hljs from 'highlight.js/lib/common';
import { FOLDERS, FILES, FILE_NAMES, EXTENSIONS } from '../core/constants.js';
import { ensureDir, pathExists, readFile, readJson, remove, writeFile } from '../utils/fs.js';
import { scanGlob } from '../utils/glob.js';
import type { Builder, BuilderContext } from './types.js';
import { shouldProcess } from '../utils/changedFile.js';
import { getPageDirectories } from '../core/pages.js';
import { readPageManifest, readSharedAssets } from '../assets/assetManifest.js';
import { resolvePageAssetUrl, resolvePagesUrlPrefix } from '../utils/pagePaths.js';
import { ensureDocsShellCriticalCss } from '../html/criticalCss.js';
import type { FrontendContentConfig } from '../types.js';

interface ContentFrontmatter {
  title?: string;
  description?: string;
  order?: number;
}

interface ContentNavEntry {
  readonly path: string;
  readonly title: string;
  readonly section?: string;
  readonly order?: number;
}

interface SidebarOverrideEntry {
  readonly path: string;
  readonly title?: string;
  readonly section?: string;
  readonly order?: number;
  readonly hidden?: boolean;
}

type SidebarOverrideFile =
  | { readonly pages?: readonly SidebarOverrideEntry[] }
  | readonly SidebarOverrideEntry[]
  | Record<string, Omit<SidebarOverrideEntry, 'path'> & { readonly path?: string }>;

interface SearchEntry {
  readonly path: string;
  readonly title: string;
  readonly description?: string;
  readonly headings: readonly string[];
  readonly excerpt: string;
  readonly kind: 'content' | 'page';
}

interface RenderedContentPage {
  readonly href: string;
  readonly outputDir: string;
  readonly outputPath: string;
  readonly html: string;
  readonly headingIds: ReadonlySet<string>;
  readonly sourcePath: string;
}

type MarkdownRenderer = InstanceType<typeof marked.Renderer>;

export function createContentBuilder(context: BuilderContext): Builder {
  return {
    name: 'content',
    async build(): Promise<void> {
      await buildContentPages(context);
      await buildContentManifests(context);
    },
    async publish(): Promise<void> {
      await publishContentPages(context);
      await publishContentManifests(context);
    },
  };
}

async function buildContentPages(context: BuilderContext): Promise<void> {
  const { config } = context;
  const contentRoot = config.paths.src.content;

  if (!(await pathExists(contentRoot))) {
    return;
  }

  if (
    !isSidebarOverrideChange(context, contentRoot) &&
    !shouldProcess(context, [{ directory: contentRoot, extensions: ['.md'] }])
  ) {
    return;
  }

  const files = await scanGlob('**/*.md', { cwd: contentRoot });

  if (files.length === 0) {
    return;
  }

  const appTemplatePath = path.join(config.paths.src.app, FILE_NAMES.htmlAppTemplate);
  if (!(await pathExists(appTemplatePath))) {
    throw new Error(`Base application HTML file not found for content pages: ${appTemplatePath}`);
  }

  const templateHtml = await readFile(appTemplatePath);
  validateAppTemplate(templateHtml, appTemplatePath);

  const buildPagesUrlPrefix = resolvePagesUrlPrefix(
    config.paths.build.frontend,
    config.paths.build.pages,
  );
  const navEntries =
    context.enable?.contentNav === true ? await collectContentManifests(context) : [];
  await removeStaleContentOutputs(context, files, buildPagesUrlPrefix);

  for (const relative of files) {
    const sourcePath = path.join(contentRoot, relative);
    const markdown = await readFile(sourcePath);
    const { frontmatter, content } = extractFrontmatter(markdown);
    const htmlBody = (await renderMarkdownDoc(content, relative, config.content)).html;

    const segments = resolveContentSegments(relative, config.content);
    const pagePath = path.join(...segments);
    const href = `/${segments.join('/')}/`;
    const pageTitle = resolveTitle(frontmatter, content, segments);

    const mergedHtml = mergeContentIntoTemplate(
      templateHtml,
      pageTitle,
      htmlBody,
      frontmatter.description,
      context.enable?.contentNav === true,
      buildPagesUrlPrefix,
      navEntries,
      href,
      config.content,
    );
    const mergedWithOptIn = injectGlobalOptInScripts(mergedHtml, context.enable);

    // Write to build (folder index)
    const targetDir = path.join(config.paths.build.pages, pagePath);
    await ensureDir(targetDir);
    const targetPath = path.join(targetDir, FILES.indexHtml);
    await writeFile(targetPath, mergedWithOptIn);
  }
}

async function publishContentPages(context: BuilderContext): Promise<void> {
  const { config } = context;
  const contentRoot = config.paths.src.content;

  if (!(await pathExists(contentRoot))) {
    return;
  }

  const files = await scanGlob('**/*.md', { cwd: contentRoot });

  if (files.length === 0) {
    return;
  }

  const appTemplatePath = path.join(config.paths.src.app, FILE_NAMES.htmlAppTemplate);
  if (!(await pathExists(appTemplatePath))) {
    throw new Error(`Base application HTML file not found for content pages: ${appTemplatePath}`);
  }

  const templateHtml = await readFile(appTemplatePath);
  validateAppTemplate(templateHtml, appTemplatePath);

  const pagesUrlPrefix = resolvePagesUrlPrefix(config.paths.dist.frontend, config.paths.dist.pages);
  const buildPagesUrlPrefix = resolvePagesUrlPrefix(
    config.paths.build.frontend,
    config.paths.build.pages,
  );
  await removeStaleContentOutputsForRoot(
    config.paths.dist.content,
    files,
    pagesUrlPrefix,
    config.content,
  );

  const shared = await readSharedAssets(config.paths.dist.frontend);
  const navEntries =
    context.enable?.contentNav === true ? await collectContentManifests(context) : [];
  const contentManifestRoot = path.join(config.paths.dist.pages, config.content.pageName);
  const contentManifest = await readPageManifest(contentManifestRoot, config.content.pageName);

  if (!contentManifest.css || !contentManifest.js) {
    throw new Error(
      `Content pages require the content hub assets. Ensure 'src/frontend/pages/${config.content.pageName}/index.css' and 'src/frontend/pages/${config.content.pageName}/index.(ts|js)' exist, then re-run publish.`,
    );
  }

  const renderedPages: RenderedContentPage[] = [];

  for (const relative of files) {
    const sourcePath = path.join(contentRoot, relative);
    const markdown = await readFile(sourcePath);
    const { frontmatter, content } = extractFrontmatter(markdown);

    const segments = resolveContentSegments(relative, config.content);
    const pagePath = path.join(...segments);
    const href = `/${segments.join('/')}/`;
    const pageTitle = resolveTitle(frontmatter, content, segments);

    const rendered = await renderMarkdownDoc(content, relative, config.content);
    const htmlBody = rendered.html;

    const mergedHtml = mergeContentIntoTemplate(
      templateHtml,
      pageTitle,
      htmlBody,
      frontmatter.description,
      context.enable?.contentNav === true,
      pagesUrlPrefix,
      navEntries,
      href,
      config.content,
    );
    const mergedWithOptIn = injectGlobalOptInScripts(mergedHtml, context.enable);
    const rewritten = await rewriteContentForPublish(mergedWithOptIn, shared, contentManifest, {
      pagesUrlPrefix,
      buildPagesUrlPrefix,
      content: config.content,
    });

    const distDir = path.join(config.paths.dist.pages, pagePath);
    const distPath = path.join(distDir, FILES.indexHtml);

    renderedPages.push({
      href,
      outputDir: distDir,
      outputPath: distPath,
      html: rewritten,
      headingIds: rendered.headingIds,
      sourcePath,
    });
  }

  validateRenderedContentPages(renderedPages, config.content);

  for (const page of renderedPages) {
    await ensureDir(page.outputDir);
    await writeFile(page.outputPath, page.html);
  }
}

async function removeStaleContentOutputs(
  context: BuilderContext,
  contentFiles: readonly string[],
  pagesUrlPrefix: string,
): Promise<void> {
  await removeStaleContentOutputsForRoot(
    context.config.paths.build.content,
    contentFiles,
    pagesUrlPrefix,
    context.config.content,
  );
}

async function removeStaleContentOutputsForRoot(
  outputRoot: string,
  contentFiles: readonly string[],
  pagesUrlPrefix: string,
  contentConfig: FrontendContentConfig,
): Promise<void> {
  if (!(await pathExists(outputRoot))) {
    return;
  }

  const expected = new Set<string>();
  for (const relative of contentFiles) {
    const segments = resolveContentSegments(relative, contentConfig);
    expected.add(path.join(...segments.slice(1)));
  }

  const candidateIndexes = await scanGlob('**/index.html', { cwd: outputRoot });

  const contentPrefix = resolvePageAssetUrl(pagesUrlPrefix, contentConfig.pageName, '');
  const contentAssetToken = contentPrefix.endsWith('/') ? contentPrefix : `${contentPrefix}/`;

  for (const relativeIndex of candidateIndexes) {
    // Keep the content hub page at the configured content base.
    if (relativeIndex === FILES.indexHtml) {
      continue;
    }

    const pageDir = path.dirname(relativeIndex);
    if (!pageDir || pageDir === '.' || expected.has(pageDir)) {
      continue;
    }

    const absoluteIndex = path.join(outputRoot, relativeIndex);
    const html = await readFile(absoluteIndex);

    // Only remove pages that were generated by the content pipeline.
    const looksLikeContentOutput =
      html.includes('class="docs-article"') && html.includes(contentAssetToken);
    if (!looksLikeContentOutput) {
      continue;
    }

    await remove(path.join(outputRoot, pageDir));
  }
}

async function buildContentManifests(context: BuilderContext): Promise<void> {
  const { config } = context;
  const contentRoot = config.paths.src.content;

  if (!(await pathExists(contentRoot))) {
    // Still allow search.json to be created from regular pages.
    if (context.enable?.search === true) {
      const pageEntries = await collectPageSearchEntries(context);
      if (pageEntries.length > 0) {
        await writeSearchManifest([config.paths.build.frontend], pageEntries);
      }
    }
    return;
  }

  if (
    !isSidebarOverrideChange(context, contentRoot) &&
    !shouldProcess(context, [
      { directory: contentRoot, extensions: ['.md'] },
      // `webstir enable search` updates package.json and should emit the index immediately.
      { directory: config.paths.workspace, extensions: ['.json'] },
    ])
  ) {
    return;
  }

  const navEntries = await collectContentManifests(context);
  if (navEntries.length === 0) {
    return;
  }

  await writeContentNavManifest([config.paths.build.frontend], navEntries, config.content);

  if (context.enable?.search === true) {
    const [docEntries, pageEntries] = await Promise.all([
      collectContentSearchEntries(context),
      collectPageSearchEntries(context),
    ]);
    const searchEntries = [...docEntries, ...pageEntries];
    if (searchEntries.length > 0) {
      await writeSearchManifest([config.paths.build.frontend], searchEntries);
    }
  }
}

async function publishContentManifests(context: BuilderContext): Promise<void> {
  const { config } = context;
  const contentRoot = config.paths.src.content;

  const hasContent = await pathExists(contentRoot);

  const navEntries = hasContent ? await collectContentManifests(context) : [];

  if (navEntries.length > 0) {
    await writeContentNavManifest([config.paths.dist.frontend], navEntries, config.content);
  }

  if (context.enable?.search === true) {
    const [docEntries, pageEntries] = await Promise.all([
      hasContent ? collectContentSearchEntries(context) : Promise.resolve([]),
      collectPageSearchEntries(context),
    ]);
    const searchEntries = [...docEntries, ...pageEntries];
    if (searchEntries.length > 0) {
      await writeSearchManifest([config.paths.dist.frontend], searchEntries);
    }
  }
}

async function collectContentManifests(context: BuilderContext): Promise<ContentNavEntry[]> {
  const { config } = context;
  const contentRoot = config.paths.src.content;
  const overrides = await loadSidebarOverrides(contentRoot, config.content);

  const files = await scanGlob('**/*.md', { cwd: contentRoot });

  if (files.length === 0) {
    return [];
  }

  const navEntries: ContentNavEntry[] = [];

  for (const relative of files) {
    const sourcePath = path.join(contentRoot, relative);
    const markdown = await readFile(sourcePath);
    const { frontmatter, content } = extractFrontmatter(markdown);

    const segments = resolveContentSegments(relative, config.content);
    const parsed = path.parse(relative);
    const section =
      parsed.dir && parsed.dir.trim().length > 0 ? parsed.dir.split(path.sep)[0] : undefined;

    const href = `/${segments.join('/')}/`;
    const title = resolveTitle(frontmatter, content, segments);
    const order = frontmatter.order;

    const baseEntry: ContentNavEntry = {
      path: href,
      title,
      section,
      order,
    };

    const merged = applySidebarOverride(baseEntry, overrides, config.content);
    if (merged) {
      navEntries.push(merged);
    }
  }

  navEntries.sort((a, b) => {
    const aHasOrder = typeof a.order === 'number';
    const bHasOrder = typeof b.order === 'number';
    if (aHasOrder && bHasOrder && a.order !== b.order) {
      return a.order - b.order;
    }
    if (aHasOrder !== bHasOrder) {
      return aHasOrder ? -1 : 1;
    }

    const aSection = a.section ?? '';
    const bSection = b.section ?? '';
    if (aSection !== bSection) {
      return aSection.localeCompare(bSection);
    }

    return a.path.localeCompare(b.path);
  });

  return navEntries;
}

async function writeContentNavManifest(
  outputRoots: readonly string[],
  navEntries: readonly ContentNavEntry[],
  contentConfig: FrontendContentConfig,
): Promise<void> {
  for (const outputRoot of outputRoots) {
    await removeStaleContentNavManifests(outputRoot, contentConfig);

    const navOutputPath = path.join(outputRoot, contentConfig.navManifest);

    await ensureDir(path.dirname(navOutputPath));
    await writeFile(navOutputPath, JSON.stringify(navEntries, undefined, 2));
  }
}

async function removeStaleContentNavManifests(
  outputRoot: string,
  contentConfig: FrontendContentConfig,
): Promise<void> {
  if (!(await pathExists(outputRoot))) {
    return;
  }

  const manifests = await scanGlob('*-nav.json', { cwd: outputRoot });
  for (const relative of manifests) {
    if (relative === contentConfig.navManifest) {
      continue;
    }

    const absolutePath = path.join(outputRoot, relative);
    const generatedBase = resolveGeneratedNavBasePath(relative);

    const raw = await readFile(absolutePath);
    const entries = parseContentNavManifest(raw, absolutePath);

    if (entries.length === 0 || entries.every((entry) => entry.path.startsWith(generatedBase))) {
      await remove(absolutePath);
    }
  }
}

function resolveGeneratedNavBasePath(relative: string): string {
  const filename = path.basename(relative);
  const suffix = '-nav.json';
  if (!filename.endsWith(suffix)) {
    throw new Error(`Unexpected content nav manifest path: ${relative}`);
  }

  const pageName = filename.slice(0, -suffix.length);
  if (!pageName) {
    throw new Error(`Expected content nav manifest to include a page name: ${relative}`);
  }

  return `/${pageName}/`;
}

function parseContentNavManifest(
  raw: string,
  manifestPath: string,
): readonly Pick<ContentNavEntry, 'path'>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read content nav manifest ${manifestPath}: ${message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Expected content nav manifest to be an array: ${manifestPath}`);
  }

  const entries: Pick<ContentNavEntry, 'path'>[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Expected content nav manifest entries to be objects: ${manifestPath}`);
    }

    const pathValue = (entry as Record<string, unknown>).path;
    if (typeof pathValue !== 'string') {
      throw new Error(`Expected content nav manifest entries to include path: ${manifestPath}`);
    }

    entries.push({ path: pathValue });
  }

  return entries;
}

async function collectContentSearchEntries(context: BuilderContext): Promise<SearchEntry[]> {
  const { config } = context;
  const contentRoot = config.paths.src.content;
  const overrides = await loadSidebarOverrides(contentRoot, config.content);

  const files = await scanGlob('**/*.md', { cwd: contentRoot });

  if (files.length === 0) {
    return [];
  }

  const entries: SearchEntry[] = [];

  for (const relative of files) {
    const sourcePath = path.join(contentRoot, relative);
    const markdown = await readFile(sourcePath);
    const { frontmatter, content } = extractFrontmatter(markdown);

    const segments = resolveContentSegments(relative, config.content);
    const href = `/${segments.join('/')}/`;
    const rawTitle = resolveTitle(frontmatter, content, segments);
    const title = applySidebarTitleOverride(href, rawTitle, overrides, config.content);
    if (!title) {
      continue;
    }

    const html = (await renderMarkdownDoc(content, relative, config.content)).html;
    const document = load(html);
    const headings = document('h2, h3')
      .toArray()
      .map((element) => document(element).text().trim())
      .filter((text) => text.length > 0);

    const plainText = document.text().replace(/\s+/g, ' ').trim();
    const excerpt = plainText.length > 240 ? `${plainText.slice(0, 240).trim()}…` : plainText;

    entries.push({
      path: href,
      title,
      description: frontmatter.description?.trim() ? frontmatter.description.trim() : undefined,
      headings,
      excerpt,
      kind: 'content',
    });
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}

async function loadSidebarOverrides(
  contentRoot: string,
  contentConfig: FrontendContentConfig,
): Promise<Map<string, SidebarOverrideEntry>> {
  const overridesPath = path.join(contentRoot, '_sidebar.json');
  if (!(await pathExists(overridesPath))) {
    return new Map();
  }

  const parsed = await readJson<SidebarOverrideFile>(overridesPath);
  const map = new Map<string, SidebarOverrideEntry>();

  if (!parsed) {
    return map;
  }

  const pages = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { pages?: unknown }).pages)
      ? ((parsed as { pages: unknown }).pages as readonly SidebarOverrideEntry[])
      : null;

  if (pages) {
    for (let index = 0; index < pages.length; index += 1) {
      const entry = pages[index];
      if (!entry || typeof entry !== 'object') {
        continue;
      }

      const normalized = normalizeContentOverrideHref(
        (entry as SidebarOverrideEntry).path,
        contentConfig,
      );
      if (!normalized) {
        continue;
      }

      const defaultOrder =
        typeof (entry as SidebarOverrideEntry).order === 'number'
          ? (entry as SidebarOverrideEntry).order
          : index + 1;

      map.set(normalized, {
        ...entry,
        path: normalized,
        order: defaultOrder,
      });
    }

    return map;
  }

  if (typeof parsed === 'object') {
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') {
        continue;
      }

      const rawPath =
        typeof (value as { path?: unknown }).path === 'string'
          ? String((value as { path?: unknown }).path)
          : key;
      const normalized = normalizeContentOverrideHref(rawPath, contentConfig);
      if (!normalized) {
        continue;
      }

      const title =
        typeof (value as { title?: unknown }).title === 'string'
          ? String((value as { title?: unknown }).title)
          : undefined;
      const section =
        typeof (value as { section?: unknown }).section === 'string'
          ? String((value as { section?: unknown }).section)
          : undefined;
      const hidden =
        typeof (value as { hidden?: unknown }).hidden === 'boolean'
          ? Boolean((value as { hidden?: unknown }).hidden)
          : undefined;
      const orderValue = (value as { order?: unknown }).order;
      const order =
        typeof orderValue === 'number' && Number.isFinite(orderValue) ? orderValue : undefined;

      map.set(normalized, { path: normalized, title, section, hidden, order });
    }
  }

  return map;
}

function isSidebarOverrideChange(context: BuilderContext, contentRoot: string): boolean {
  if (!context.changedFile) {
    return false;
  }

  return (
    path.resolve(context.changedFile) === path.join(path.resolve(contentRoot), '_sidebar.json')
  );
}

function applySidebarOverride(
  entry: ContentNavEntry,
  overrides: ReadonlyMap<string, SidebarOverrideEntry>,
  contentConfig: FrontendContentConfig,
): ContentNavEntry | null {
  const key = normalizeContentOverrideHref(entry.path, contentConfig);
  const override = key ? overrides.get(key) : undefined;
  if (!override) {
    return entry;
  }

  if (override.hidden === true) {
    return null;
  }

  const title =
    typeof override.title === 'string' && override.title.trim().length > 0
      ? override.title.trim()
      : entry.title;
  const section =
    typeof override.section === 'string' && override.section.trim().length > 0
      ? override.section.trim()
      : entry.section;
  const order =
    typeof override.order === 'number' && Number.isFinite(override.order)
      ? override.order
      : entry.order;

  return {
    path: entry.path,
    title,
    section,
    order,
  };
}

function applySidebarTitleOverride(
  href: string,
  fallbackTitle: string,
  overrides: ReadonlyMap<string, SidebarOverrideEntry>,
  contentConfig: FrontendContentConfig,
): string | null {
  const key = normalizeContentOverrideHref(href, contentConfig);
  const override = key ? overrides.get(key) : undefined;
  if (!override) {
    return fallbackTitle;
  }

  if (override.hidden === true) {
    return null;
  }

  const title =
    typeof override.title === 'string' && override.title.trim().length > 0
      ? override.title.trim()
      : fallbackTitle;
  return title;
}

function normalizeContentOverrideHref(
  value: string,
  contentConfig: FrontendContentConfig,
): string | null {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return null;
  }

  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  if (!isContentPath(withSlash, contentConfig)) {
    return null;
  }

  if (withSlash.endsWith('/')) {
    return withSlash;
  }

  return `${withSlash}/`;
}

async function collectPageSearchEntries(context: BuilderContext): Promise<SearchEntry[]> {
  const { config } = context;
  const pages = await getPageDirectories(config.paths.src.pages);
  if (pages.length === 0) {
    return [];
  }

  const entries: SearchEntry[] = [];

  for (const page of pages) {
    const sourceIndex = path.join(page.directory, FILES.indexHtml);
    if (!(await pathExists(sourceIndex))) {
      continue;
    }

    const html = await readFile(sourceIndex);
    const document = load(html);

    const titleFromTag = document('title').first().text().trim();
    const titleFromH1 = document('h1').first().text().trim();
    const title = titleFromTag || titleFromH1 || toTitleCase(page.name);

    const description =
      document('meta[name="description"]').first().attr('content')?.trim() || undefined;

    const headings = document('h2, h3')
      .toArray()
      .map((element) => document(element).text().trim())
      .filter((text) => text.length > 0);

    const mainText = (document('main').first().text() || document.text())
      .replace(/\s+/g, ' ')
      .trim();
    const excerpt = mainText.length > 240 ? `${mainText.slice(0, 240).trim()}…` : mainText;

    entries.push({
      path: resolvePageHref(page.name),
      title,
      description,
      headings,
      excerpt,
      kind: 'page',
    });
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}

function resolvePageHref(pageName: string): string {
  if (pageName === FOLDERS.home) {
    return '/';
  }
  return `/${pageName}/`;
}

async function writeSearchManifest(
  outputRoots: readonly string[],
  entries: readonly SearchEntry[],
): Promise<void> {
  for (const outputRoot of outputRoots) {
    const outputPath = path.join(outputRoot, 'search.json');
    await ensureDir(path.dirname(outputPath));
    await writeFile(outputPath, JSON.stringify(entries, undefined, 2));
  }
}

function resolveContentSegments(relative: string, contentConfig: FrontendContentConfig): string[] {
  const parsed = path.parse(relative);
  const segments = contentBaseSegments(contentConfig);

  if (parsed.dir) {
    segments.push(...parsed.dir.split(path.sep));
  }

  const isReadme = parsed.name.toLowerCase() === 'readme';
  const isFolderIndex = parsed.name === 'index' || isReadme;

  // Reserve the content base for a hub page; root content files become `/<base>/<name>/`.
  if (!isFolderIndex || !parsed.dir) {
    segments.push(parsed.name);
  }

  return segments;
}

function contentBaseSegments(contentConfig: FrontendContentConfig): string[] {
  return contentConfig.basePath.split('/').filter(Boolean);
}

function extractFrontmatter(markdown: string): {
  frontmatter: ContentFrontmatter;
  content: string;
} {
  const lines = markdown.split(/\r?\n/);
  if (lines.length === 0 || lines[0].trim() !== '---') {
    return { frontmatter: {}, content: markdown };
  }

  const frontmatterLines: string[] = [];
  let closingIndex = -1;

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '---') {
      closingIndex = index;
      break;
    }
    frontmatterLines.push(line);
  }

  if (closingIndex === -1) {
    return { frontmatter: {}, content: markdown };
  }

  const frontmatter: ContentFrontmatter = {};

  for (const line of frontmatterLines) {
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.+)$/);
    if (!match) {
      continue;
    }

    const key = match[1].trim();
    const rawValue = match[2].trim();

    if (key === 'title') {
      frontmatter.title = rawValue;
    } else if (key === 'description') {
      frontmatter.description = rawValue;
    } else if (key === 'order') {
      const parsed = Number.parseInt(rawValue, 10);
      if (!Number.isNaN(parsed)) {
        frontmatter.order = parsed;
      }
    }
  }

  const content = lines.slice(closingIndex + 1).join('\n');
  return { frontmatter, content };
}

function resolveTitle(
  frontmatter: ContentFrontmatter,
  content: string,
  segments: string[],
): string {
  if (frontmatter.title?.trim()) {
    return frontmatter.title.trim();
  }

  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch) {
    return headingMatch[1].trim();
  }

  const fallbackSegment = segments[segments.length - 1] ?? 'docs';
  const normalized = fallbackSegment.replace(/[-_]/g, ' ');
  return toTitleCase(normalized);
}

function toTitleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function validateAppTemplate(html: string, filePath: string): void {
  const doc = load(html);
  if (doc('main').length === 0) {
    throw new Error(`Base template missing <main> container (${filePath}).`);
  }
  if (doc('head').length === 0) {
    throw new Error(`Base template missing <head> section (${filePath}).`);
  }
}

function mergeContentIntoTemplate(
  appHtml: string,
  pageName: string,
  bodyHtml: string,
  description: string | undefined,
  enableContentNav: boolean,
  pagesUrlPrefix: string,
  navEntries: readonly ContentNavEntry[],
  currentPath: string,
  contentConfig: FrontendContentConfig,
): string {
  const document = load(appHtml);

  const main = document('main').first();
  const head = document('head').first();
  if (main.length === 0 || head.length === 0) {
    throw new Error(
      'Base application template for content pages must include <head> and <main> elements.',
    );
  }

  if (description?.trim()) {
    const meta = head.find('meta[name="description"]').first();
    if (meta.length > 0) {
      meta.attr('content', description.trim());
    } else {
      head.append(`<meta name="description" content="${escapeHtml(description.trim())}" />`);
    }
  }
  const defaultDescription =
    head.find('meta[name="description"]').first().attr('content')?.trim() ?? '';
  const effectiveDescription = (description ?? '').trim() || defaultDescription;

  // Ensure content pages load the shared app styles.
  const cssHref = `/${FOLDERS.app}/app.css`;
  const existingStylesheet =
    head.find(`link[rel="stylesheet"][href="${cssHref}"]`).first().length > 0 ||
    head
      .find('link[rel="stylesheet"]')
      .toArray()
      .some((element) => {
        const href = document(element).attr('href');
        return typeof href === 'string' && href.includes('/app/app.css');
      });
  if (!existingStylesheet) {
    head.append(`<link rel="stylesheet" href="${cssHref}" />`);
  }

  // Ensure content pages load the content layout styles.
  const contentCssHref = resolvePageAssetUrl(
    pagesUrlPrefix,
    contentConfig.pageName,
    `${FILES.index}${EXTENSIONS.css}`,
  );
  const existingContentStylesheet =
    head.find(`link[rel="stylesheet"][href="${contentCssHref}"]`).first().length > 0 ||
    head
      .find('link[rel="stylesheet"]')
      .toArray()
      .some((element) => {
        const href = document(element).attr('href');
        return typeof href === 'string' && href.includes(`/${contentConfig.pageName}/index.css`);
      });
  if (!existingContentStylesheet) {
    head.append(`<link rel="stylesheet" href="${contentCssHref}" />`);
  }

  // Best-effort: ensure the document has a sensible title for the content page.
  const title = head.find('title').first();
  if (title.length === 0) {
    head.append(`<title>${escapeHtml(pageName)}</title>`);
  } else if (!title.text().trim()) {
    title.text(pageName);
  } else {
    const baseTitle = title.text().trim();
    if (!baseTitle.includes(pageName)) {
      title.text(`${pageName} – ${baseTitle}`);
    }
  }
  const effectiveTitle = head.find('title').first().text().trim() || pageName;

  ensureMetaProperty(head, 'og:title', effectiveTitle);
  if (effectiveDescription) {
    ensureMetaProperty(head, 'og:description', effectiveDescription);
  }
  ensureMetaProperty(head, 'og:type', 'website');
  ensureMetaName(head, 'twitter:card', 'summary');
  ensureMetaName(head, 'twitter:title', effectiveTitle);
  if (effectiveDescription) {
    ensureMetaName(head, 'twitter:description', effectiveDescription);
  }

  const contentNav =
    enableContentNav && navEntries.length > 0
      ? buildContentNavHtml(navEntries, currentPath, contentConfig)
      : { navHtml: '', breadcrumbHtml: '', ready: false };

  const layoutData = [
    'data-scope="docs"',
    'data-content-nav="true"',
    `data-content-base="${escapeHtml(contentConfig.basePath)}"`,
    `data-content-label="${escapeHtml(contentConfig.label)}"`,
    `data-content-nav-url="/${escapeHtml(contentConfig.navManifest)}"`,
    `data-content-nav-ready="${contentNav.ready ? 'true' : 'false'}"`,
  ].join(' ');

  const docsLayoutHtml = enableContentNav
    ? [
        `<section class="docs-layout" ${layoutData}>`,
        '  <div class="ws-container docs-layout__inner">',
        '    <aside class="docs-sidebar" id="docs-sidebar" data-docs-sidebar>',
        '      <div class="docs-panel__header">',
        `        <a class="docs-panel__link" href="${contentConfig.basePath}">${escapeHtml(contentConfig.label)}</a>`,
        '      </div>',
        `      <nav class="docs-nav" data-docs-nav aria-label="${escapeHtml(contentConfig.label)} navigation">${contentNav.navHtml}</nav>`,
        '    </aside>',
        '    <div class="docs-main">',
        '      <div class="docs-toolbar" data-docs-toolbar>',
        `        <nav class="docs-breadcrumb" data-docs-breadcrumb aria-label="Breadcrumb">${contentNav.breadcrumbHtml}</nav>`,
        '      </div>',
        '      <div class="docs-main__content ws-flow">',
        `        <article class="docs-article ws-markdown" data-docs-article>${bodyHtml}</article>`,
        '      </div>',
        '    </div>',
        '  </div>',
        '</section>',
      ].join('\n')
    : [
        '<section class="docs-layout" data-scope="docs">',
        '  <div class="ws-container docs-layout__inner">',
        '    <div class="docs-main ws-flow">',
        `      <article class="docs-article ws-markdown">${bodyHtml}</article>`,
        '    </div>',
        '  </div>',
        '</section>',
      ].join('\n');

  main.html(docsLayoutHtml);

  return document.root().html() ?? '';
}

type ContentNavNode = {
  segment: string;
  path: string;
  title: string;
  children: ContentNavNode[];
  isPage: boolean;
  position: number;
};

function buildContentNavHtml(
  navEntries: readonly ContentNavEntry[],
  currentPath: string,
  contentConfig: FrontendContentConfig,
): { navHtml: string; breadcrumbHtml: string; ready: boolean } {
  if (navEntries.length === 0) {
    return { navHtml: '', breadcrumbHtml: '', ready: false };
  }

  const normalizedPath = normalizeContentPath(currentPath, contentConfig);
  const tree = buildContentNavTree(navEntries, contentConfig);
  const titleByPath = new Map<string, string>(
    navEntries.map((entry) => [normalizeContentPath(entry.path, contentConfig), entry.title]),
  );
  titleByPath.set(
    contentConfig.basePath,
    titleByPath.get(contentConfig.basePath) ?? contentConfig.label,
  );

  const navHtml = renderContentNavList(tree.children, normalizedPath);
  const breadcrumbHtml = renderContentBreadcrumb(titleByPath, normalizedPath, contentConfig);
  return { navHtml, breadcrumbHtml, ready: navHtml.length > 0 };
}

function normalizeContentPath(pathname: string, contentConfig: FrontendContentConfig): string {
  if (!isContentPath(pathname, contentConfig)) {
    return pathname;
  }
  if (pathname === contentConfig.basePath.slice(0, -1)) {
    return contentConfig.basePath;
  }
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

function isContentPath(pathname: string, contentConfig: FrontendContentConfig): boolean {
  const baseWithoutSlash = contentConfig.basePath.slice(0, -1);
  return (
    pathname === baseWithoutSlash ||
    pathname === contentConfig.basePath ||
    pathname.startsWith(contentConfig.basePath)
  );
}

function stripContentBase(pathname: string, contentConfig: FrontendContentConfig): string[] {
  const normalized = normalizeContentPath(pathname, contentConfig);
  if (normalized === contentConfig.basePath) {
    return [];
  }

  return normalized.slice(contentConfig.basePath.length).split('/').filter(Boolean);
}

function buildContentNavTree(
  entries: readonly ContentNavEntry[],
  contentConfig: FrontendContentConfig,
): ContentNavNode {
  let position = 0;
  const [rootSegment] = contentBaseSegments(contentConfig);
  const root: ContentNavNode = {
    segment: rootSegment ?? contentConfig.pageName,
    path: contentConfig.basePath,
    title: contentConfig.label,
    children: [],
    isPage: false,
    position: position++,
  };

  for (const entry of entries) {
    const normalizedPath = normalizeContentPath(entry.path, contentConfig);
    const segments = normalizedPath.split('/').filter(Boolean);
    const rootLength = contentBaseSegments(contentConfig).length;
    if (segments.length <= rootLength) {
      continue;
    }

    let current = root;
    for (let index = rootLength; index < segments.length; index += 1) {
      const segment = segments[index];
      const nodePath = `/${segments.slice(0, index + 1).join('/')}/`;
      let child = current.children.find((node) => node.segment === segment);
      if (!child) {
        child = {
          segment,
          path: nodePath,
          title: toTitleCase(segment.replace(/[-_]/g, ' ')),
          children: [],
          isPage: false,
          position: position++,
        };
        current.children.push(child);
      }
      current = child;
    }

    current.title = entry.title;
    current.isPage = true;
  }

  return root;
}

function renderContentNavList(
  nodes: readonly ContentNavNode[],
  currentPath: string,
  depth = 0,
): string {
  const listClass = depth === 0 ? 'docs-nav__list' : 'docs-nav__list docs-nav__list--nested';
  const sorted = [...nodes].sort((a, b) => a.position - b.position);

  const items = sorted.map((node) => {
    const isActive = node.path === currentPath;
    const isBranch = !isActive && currentPath.startsWith(node.path);
    const activeAttr = isActive
      ? ' data-active="true"'
      : isBranch
        ? ' data-active-branch="true"'
        : '';

    const label = node.isPage
      ? `<a class="docs-nav__link" href="${node.path}"${isActive ? ' aria-current="page"' : ''}>${escapeHtml(node.title)}</a>`
      : `<span class="docs-nav__label">${escapeHtml(node.title)}</span>`;
    const nested =
      node.children.length > 0 ? renderContentNavList(node.children, currentPath, depth + 1) : '';

    return `<li class="docs-nav__item"${activeAttr}>${label}${nested}</li>`;
  });

  return `<ol class="${listClass}">${items.join('')}</ol>`;
}

function renderContentBreadcrumb(
  titleByPath: ReadonlyMap<string, string>,
  currentPath: string,
  contentConfig: FrontendContentConfig,
): string {
  if (!isContentPath(currentPath, contentConfig)) {
    return '';
  }

  const crumbs: Array<{ title: string; href: string }> = [];
  const rootTitle = titleByPath.get(contentConfig.basePath) ?? contentConfig.label;
  crumbs.push({ title: rootTitle, href: contentConfig.basePath });

  const segments = stripContentBase(currentPath, contentConfig);
  let href = contentConfig.basePath;
  for (const segment of segments) {
    href = `${href}${segment}/`;
    const title = titleByPath.get(href) ?? toTitleCase(segment.replace(/[-_]/g, ' '));
    crumbs.push({ title, href });
  }

  const items = crumbs.map((crumb, index) => {
    if (index === crumbs.length - 1) {
      return `<li class="docs-breadcrumb__item"><span aria-current="page">${escapeHtml(crumb.title)}</span></li>`;
    }
    return `<li class="docs-breadcrumb__item"><a class="docs-breadcrumb__link" href="${crumb.href}">${escapeHtml(crumb.title)}</a></li>`;
  });

  return `<ol class="docs-breadcrumb__list">${items.join('')}</ol>`;
}

function ensureMetaProperty(head: Cheerio<AnyNode>, property: string, content: string): void {
  const escaped = escapeHtml(content);
  const meta = head.find(`meta[property="${property}"]`).first();
  if (meta.length > 0) {
    meta.attr('content', escaped);
    return;
  }
  head.append(`<meta property="${property}" content="${escaped}" />`);
}

function ensureMetaName(head: Cheerio<AnyNode>, name: string, content: string): void {
  const escaped = escapeHtml(content);
  const meta = head.find(`meta[name="${name}"]`).first();
  if (meta.length > 0) {
    meta.attr('content', escaped);
    return;
  }
  head.append(`<meta name="${name}" content="${escaped}" />`);
}

async function renderMarkdownDoc(
  markdown: string,
  sourceRelative: string | undefined,
  contentConfig: FrontendContentConfig,
): Promise<{ html: string; headingIds: ReadonlySet<string> }> {
  const renderer = getMarkdownRenderer();
  const expanded = await expandAdmonitions(markdown, renderer);
  const rawHtml = await marked.parse(expanded, { renderer });
  const linked = rewriteMarkdownLinks(rawHtml, sourceRelative, contentConfig);
  const { html, headingIds } = ensureHeadingIds(linked);
  return { html, headingIds };
}

function getMarkdownRenderer(): MarkdownRenderer {
  const w = globalThis as unknown as Record<string, unknown>;
  const key = '__webstirMarkedRendererV1';
  const existing = w[key] as MarkdownRenderer | undefined;
  if (existing) {
    return existing;
  }

  const renderer = new marked.Renderer();

  // Marked v12 renderer signature is not stable in TS types; keep it permissive.
  (renderer as unknown as { code: (code: string, infostring?: string) => string }).code = (
    code: string,
    infostring?: string,
  ): string => {
    const rawLang = typeof infostring === 'string' ? infostring.trim().split(/\s+/)[0] : '';
    const lang = rawLang ? rawLang.toLowerCase() : '';

    try {
      if (lang && hljs.getLanguage(lang)) {
        const highlighted = hljs.highlight(code, { language: lang }).value;
        return `<pre><code class="hljs language-${escapeHtml(lang)}">${highlighted}</code></pre>`;
      }

      const highlighted = hljs.highlightAuto(code).value;
      return `<pre><code class="hljs">${highlighted}</code></pre>`;
    } catch {
      return `<pre><code>${escapeHtml(code)}</code></pre>`;
    }
  };

  w[key] = renderer;
  return renderer;
}

type AdmonitionKind = 'note' | 'tip' | 'info' | 'warning' | 'danger';

const ADMONITION_TITLES: Record<AdmonitionKind, string> = {
  note: 'Note',
  tip: 'Tip',
  info: 'Info',
  warning: 'Warning',
  danger: 'Danger',
};

async function expandAdmonitions(markdown: string, renderer: MarkdownRenderer): Promise<string> {
  const lines = markdown.split(/\r?\n/);
  const out: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const match = line.match(/^:::\s*([A-Za-z]+)(?:\s+(.*))?\s*$/);
    if (!match) {
      out.push(line);
      continue;
    }

    const kindRaw = match[1]?.toLowerCase() ?? '';
    if (!isAdmonitionKind(kindRaw)) {
      out.push(line);
      continue;
    }

    const title = (match[2] ?? '').trim() || ADMONITION_TITLES[kindRaw];

    const inner: string[] = [];
    let closed = false;
    for (index = index + 1; index < lines.length; index += 1) {
      const innerLine = lines[index] ?? '';
      if (innerLine.trim() === ':::') {
        closed = true;
        break;
      }
      inner.push(innerLine);
    }

    if (!closed) {
      // Unterminated block; treat it as literal markdown.
      out.push(line);
      out.push(...inner);
      break;
    }

    const bodyMarkdown = inner.join('\n').trim();
    const bodyHtml = bodyMarkdown.length > 0 ? await marked.parse(bodyMarkdown, { renderer }) : '';

    out.push(
      [
        `<aside class="docs-callout docs-callout--${kindRaw}">`,
        `  <div class="docs-callout__title">${escapeHtml(title)}</div>`,
        `  <div class="docs-callout__body">${bodyHtml}</div>`,
        `</aside>`,
      ].join('\n'),
    );
  }

  return out.join('\n');
}

function isAdmonitionKind(value: string): value is AdmonitionKind {
  return (
    value === 'note' ||
    value === 'tip' ||
    value === 'info' ||
    value === 'warning' ||
    value === 'danger'
  );
}

function ensureHeadingIds(html: string): { html: string; headingIds: ReadonlySet<string> } {
  const document = load(html);
  const used = new Set<string>();
  const ids = new Set<string>();

  const headings = document('h1, h2, h3, h4').toArray();
  for (const element of headings) {
    const heading = document(element);
    const existing = heading.attr('id')?.trim();
    if (existing) {
      used.add(existing);
      ids.add(existing);
      continue;
    }

    const text = heading.text().trim();
    const base = slugifyHeading(text) || 'section';
    let candidate = base;
    let counter = 2;
    while (used.has(candidate)) {
      candidate = `${base}-${counter}`;
      counter += 1;
    }

    used.add(candidate);
    ids.add(candidate);
    heading.attr('id', candidate);
  }

  return { html: document.root().html() ?? html, headingIds: ids };
}

function slugifyHeading(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function validateRenderedContentPages(
  pages: readonly RenderedContentPage[],
  contentConfig: FrontendContentConfig,
): void {
  if (pages.length === 0) {
    return;
  }

  const headingsByHref = new Map<string, ReadonlySet<string>>(
    pages.map((page) => [page.href, page.headingIds]),
  );
  const knownHrefs = new Set<string>(pages.map((page) => page.href));
  knownHrefs.add(contentConfig.basePath);

  const errors: string[] = [];

  for (const page of pages) {
    const document = load(page.html);
    const anchors = document('.docs-article a[href]').toArray();

    for (const element of anchors) {
      const href = document(element).attr('href') ?? '';
      if (!href) {
        continue;
      }

      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) {
        continue;
      }

      const resolved = resolveHref(page.href, href);
      if (!resolved) {
        continue;
      }

      if (!isContentPath(resolved.pathname, contentConfig)) {
        continue;
      }

      const targetHref = normalizeContentHref(resolved.pathname, contentConfig);
      if (!knownHrefs.has(targetHref)) {
        errors.push(`${page.sourcePath}: broken content link '${href}' → '${targetHref}'`);
        continue;
      }

      const hash = resolved.hash.startsWith('#') ? resolved.hash.slice(1) : resolved.hash;
      if (!hash) {
        continue;
      }

      const targetHeadings = headingsByHref.get(targetHref);
      if (!targetHeadings) {
        continue;
      }

      if (!targetHeadings.has(hash)) {
        errors.push(
          `${page.sourcePath}: broken anchor '${href}' (missing '#${hash}' on ${targetHref})`,
        );
      }
    }
  }

  if (errors.length === 0) {
    return;
  }

  const preview = errors.slice(0, 12).join('\n');
  const suffix = errors.length > 12 ? `\n… and ${errors.length - 12} more.` : '';
  throw new Error(`Markdown content contains broken internal links/anchors:\n${preview}${suffix}`);
}

function resolveHref(baseHref: string, href: string): URL | null {
  try {
    const base = baseHref.endsWith('/') ? baseHref : `${baseHref}/`;
    return new URL(href, `http://webstir.local${base}`);
  } catch {
    return null;
  }
}

function normalizeContentHref(pathname: string, contentConfig: FrontendContentConfig): string {
  const contentIndexPath = `${contentConfig.basePath}index.html`;
  if (
    pathname === contentConfig.basePath.slice(0, -1) ||
    pathname === contentConfig.basePath ||
    pathname === contentIndexPath
  ) {
    return contentConfig.basePath;
  }

  if (pathname.endsWith('/index.html')) {
    return pathname.slice(0, -'index.html'.length);
  }

  if (isContentPath(pathname, contentConfig) && !pathname.endsWith('/')) {
    return `${pathname}/`;
  }

  return pathname;
}

function injectGlobalOptInScripts(html: string, enable: BuilderContext['enable']): string {
  if (!enable) {
    return html;
  }
  return html;
}

async function rewriteContentForPublish(
  html: string,
  shared: { css?: string; js?: string } | null,
  contentManifest: { js?: string; css?: string },
  options: {
    readonly pagesUrlPrefix: string;
    readonly buildPagesUrlPrefix: string;
    readonly content: FrontendContentConfig;
  },
): Promise<string> {
  const document = load(html);
  const { content, pagesUrlPrefix, buildPagesUrlPrefix } = options;

  document('script[src="/hmr.js"]').remove();
  document('script[src="/refresh.js"]').remove();

  if (shared?.css) {
    document(`link[href="/app/app.css"]`).attr('href', `/app/${shared.css}`);
  }
  if (shared?.js) {
    document(`script[src="/app/app.js"]`).attr('src', `/app/${shared.js}`).attr('type', 'module');
  }

  if (contentManifest.css) {
    const selector = [
      `link[href="${resolvePageAssetUrl(pagesUrlPrefix, content.pageName, `${FILES.index}${EXTENSIONS.css}`)}"]`,
      `link[href="${resolvePageAssetUrl(buildPagesUrlPrefix, content.pageName, `${FILES.index}${EXTENSIONS.css}`)}"]`,
    ].join(', ');
    document(selector).attr(
      'href',
      resolvePageAssetUrl(pagesUrlPrefix, content.pageName, contentManifest.css),
    );
  }

  if (contentManifest.js) {
    const selector = [
      `script[src="${resolvePageAssetUrl(pagesUrlPrefix, content.pageName, `${FILES.index}${EXTENSIONS.js}`)}"]`,
      `script[src="${resolvePageAssetUrl(buildPagesUrlPrefix, content.pageName, `${FILES.index}${EXTENSIONS.js}`)}"]`,
    ].join(', ');
    document(selector)
      .attr('src', resolvePageAssetUrl(pagesUrlPrefix, content.pageName, contentManifest.js))
      .attr('type', 'module');
  }

  if (document('[data-scope="docs"]').length > 0) {
    ensureDocsShellCriticalCss(document);
  }

  return document.root().html() ?? html;
}

function rewriteMarkdownLinks(
  html: string,
  sourceRelative: string | undefined,
  contentConfig: FrontendContentConfig,
): string {
  const document = load(html);
  document('a[href]').each((_, element) => {
    const anchor = document(element);
    const href = anchor.attr('href');
    if (!href) return;

    if (href.startsWith('#') || href.startsWith('/') || href.startsWith('//')) {
      return;
    }

    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      return;
    }

    const rewritten = rewriteRelativeContentHref(href, sourceRelative, contentConfig);
    if (rewritten) {
      anchor.attr('href', rewritten);
    }
  });

  return document.root().html() ?? html;
}

function rewriteRelativeContentHref(
  href: string,
  sourceRelative: string | undefined,
  contentConfig: FrontendContentConfig,
): string | null {
  const [rawTarget, rawHash = ''] = href.split('#', 2);
  if (!rawTarget) {
    return null;
  }

  const queryIndex = rawTarget.indexOf('?');
  const targetWithoutQuery = queryIndex === -1 ? rawTarget : rawTarget.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : rawTarget.slice(queryIndex);
  if (/\.[a-z0-9]+$/i.test(targetWithoutQuery) && !targetWithoutQuery.endsWith('.md')) {
    return null;
  }

  const normalizedTarget = targetWithoutQuery.replace(/\.md$/i, '').replace(/\/+$/, '');
  const sourceDir = sourceRelative
    ? path.posix.dirname(sourceRelative.split(path.sep).join('/'))
    : '.';
  const joined = path.posix.normalize(
    path.posix.join('/', sourceDir === '.' ? '' : sourceDir, normalizedTarget),
  );
  const segments = joined
    .split('/')
    .filter(Boolean)
    .filter((segment, index, all) => {
      const isLast = index === all.length - 1;
      return !(isLast && /^(readme|index)$/i.test(segment));
    });
  const route =
    segments.length === 0
      ? contentConfig.basePath
      : `${contentConfig.basePath}${segments.join('/')}/`;
  const hash = rawHash ? `#${rawHash}` : '';
  return `${route}${query}${hash}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
