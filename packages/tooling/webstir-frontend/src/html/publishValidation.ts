import path from 'node:path';
import { load } from 'cheerio';
import { readFile, stat } from '../utils/fs.js';
import { scanGlob } from '../utils/glob.js';

const SOURCE_ENTRY_EXTENSION_PATTERN = /\.(?:ts|tsx|jsx)$/i;
const ASSET_ATTRIBUTES = [
  ['script[src]', 'src'],
  ['img[src]', 'src'],
  ['source[src]', 'src'],
  ['video[src]', 'src'],
  ['video[poster]', 'poster'],
  ['audio[src]', 'src'],
  ['track[src]', 'src'],
  ['input[src]', 'src'],
  ['embed[src]', 'src'],
  ['object[data]', 'data'],
] as const;
const LOCAL_LINK_RELATIONS = new Set([
  'stylesheet',
  'preload',
  'modulepreload',
  'icon',
  'apple-touch-icon',
  'manifest',
]);

export async function validatePublishedHtml(frontendRoot: string): Promise<void> {
  const htmlFiles = await scanGlob('**/*.html', { cwd: frontendRoot });

  for (const relativeHtmlPath of htmlFiles) {
    const htmlPath = path.join(frontendRoot, relativeHtmlPath);
    const document = load(await readFile(htmlPath));

    for (const element of document('script[src]').toArray()) {
      const source = document(element).attr('src');
      if (source && SOURCE_ENTRY_EXTENSION_PATTERN.test(localPathname(source) ?? '')) {
        throw new Error(
          `Published HTML references browser-invalid source entry '${source}' in ${relativeHtmlPath}. Reference index.js from source HTML so Webstir can rewrite it to the production bundle.`,
        );
      }
    }

    const references = collectLocalAssetReferences(document);
    for (const reference of references) {
      const targetPath = resolvePublishedAssetPath(frontendRoot, htmlPath, reference.url);
      const targetInfo = targetPath ? await stat(targetPath).catch(() => null) : null;
      if (targetPath && (!targetInfo || !targetInfo.isFile())) {
        throw new Error(
          `Published HTML references missing local asset '${reference.url}' from ${relativeHtmlPath} (${reference.attribute}).`,
        );
      }
    }
  }
}

function collectLocalAssetReferences(
  document: ReturnType<typeof load>,
): Array<{ url: string; attribute: string }> {
  const references: Array<{ url: string; attribute: string }> = [];

  for (const [selector, attribute] of ASSET_ATTRIBUTES) {
    document(selector).each((_, element) => {
      const value = document(element).attr(attribute);
      if (value) references.push({ url: value, attribute });
    });
  }

  document('link[href]').each((_, element) => {
    const node = document(element);
    const relations = (node.attr('rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!relations.some((relation) => LOCAL_LINK_RELATIONS.has(relation))) return;
    const href = node.attr('href');
    if (href) references.push({ url: href, attribute: 'href' });
  });

  for (const [selector, attribute] of [
    ['img[srcset]', 'srcset'],
    ['source[srcset]', 'srcset'],
  ] as const) {
    document(selector).each((_, element) => {
      const value = document(element).attr(attribute);
      if (!value) return;
      for (const candidate of parseSrcset(value)) {
        references.push({ url: candidate, attribute });
      }
    });
  }

  return references;
}

function resolvePublishedAssetPath(
  frontendRoot: string,
  htmlPath: string,
  reference: string,
): string | null {
  const pathname = localPathname(reference);
  if (!pathname) return null;

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return path.join(frontendRoot, '__invalid_url_encoding__');
  }

  const targetPath = decodedPath.startsWith('/')
    ? path.join(frontendRoot, decodedPath.slice(1))
    : path.resolve(path.dirname(htmlPath), decodedPath);
  const relative = path.relative(frontendRoot, targetPath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return path.join(frontendRoot, '__asset_path_outside_publish_root__');
  }
  return targetPath;
}

function localPathname(reference: string): string | null {
  const trimmed = reference.trim();
  if (
    !trimmed ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('?') ||
    /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  ) {
    return null;
  }
  return trimmed.split(/[?#]/, 1)[0] ?? null;
}

function parseSrcset(value: string): string[] {
  const urls: string[] = [];
  let cursor = 0;

  while (cursor < value.length) {
    while (cursor < value.length && /[\s,]/.test(value[cursor] ?? '')) cursor += 1;
    if (cursor >= value.length) break;

    const start = cursor;
    const isDataUrl = value.slice(cursor, cursor + 5).toLowerCase() === 'data:';
    while (
      cursor < value.length &&
      !/\s/.test(value[cursor] ?? '') &&
      (isDataUrl || value[cursor] !== ',')
    ) {
      cursor += 1;
    }
    urls.push(value.slice(start, cursor));

    while (cursor < value.length && value[cursor] !== ',') cursor += 1;
    if (value[cursor] === ',') cursor += 1;
  }

  return urls;
}
