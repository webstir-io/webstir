import path from 'node:path';
import { access } from 'node:fs/promises';

import { requireBunRuntime, textResponse } from './deploy-shared.js';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};
const RESERVED_PREFIXES = ['__webstir', 'api', 'fonts', 'images', 'media', 'pages', 'sse'];
const STATIC_EXTENSIONS = new Set([
  '.css',
  '.js',
  '.mjs',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp3',
  '.m4a',
  '.wav',
  '.ogg',
  '.mp4',
  '.webm',
  '.mov',
  '.json',
  '.txt',
  '.xml',
  '.map',
]);
const CONTENT_HASH_PATTERN =
  /\.[a-f0-9]{8,64}\.(css|js|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|otf|eot|mp3|m4a|wav|ogg|mp4|webm|mov)$/i;

export async function servePublishedStaticFile(
  request: Request,
  frontendRoot: string,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return textResponse(405, 'Method not allowed.');
  }

  const requestUrl = new URL(request.url);
  const candidates = getStaticCandidatePaths(requestUrl.pathname);
  const resolved = await resolveStaticFile(frontendRoot, candidates);
  if (!resolved) {
    return textResponse(404, 'Not found.');
  }

  const lowerRelativePath = resolved.relativePath.toLowerCase();
  const extension = path.extname(lowerRelativePath).toLowerCase();
  const headers = new Headers({
    'Content-Type': MIME_TYPES[extension] ?? 'application/octet-stream',
  });
  setCacheHeaders(headers, lowerRelativePath);

  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers,
    });
  }

  return new Response(requireBunRuntime().file(resolved.absolutePath), {
    status: 200,
    headers,
  });
}

export function getStaticCandidatePaths(pathname: string): readonly string[] {
  const relativePath = normalizeRequestPath(pathname);
  const candidates: string[] = [];

  if (relativePath) {
    candidates.push(...getGenericFileCandidates(relativePath));
  }

  if (relativePath === '') {
    candidates.push('pages/home/index.html');
  } else if (/^index\.(?!html$)[^/]+$/i.test(relativePath)) {
    candidates.push(path.posix.join('pages', 'home', relativePath));
  } else if (/^[^/]+\/index\.(js|css)$/i.test(relativePath)) {
    const [pageName, fileName] = relativePath.split('/');
    candidates.push(path.posix.join('pages', pageName, fileName));
  } else if (!path.posix.extname(relativePath) && !hasReservedPrefix(relativePath)) {
    candidates.push(path.posix.join('pages', relativePath, 'index.html'));
  }

  return Array.from(new Set(candidates.map((candidate) => candidate.replace(/^\/+/, ''))));
}

async function resolveStaticFile(
  buildRoot: string,
  relativePaths: readonly string[],
): Promise<{ absolutePath: string; relativePath: string } | null> {
  for (const relativePath of relativePaths) {
    const absolutePath = path.resolve(buildRoot, relativePath);
    if (!absolutePath.startsWith(buildRoot + path.sep) && absolutePath !== buildRoot) {
      continue;
    }

    try {
      await access(absolutePath);
      return { absolutePath, relativePath };
    } catch (error) {
      if (isMissingStaticCandidate(error)) {
        continue;
      }

      throw error;
    }
  }

  return null;
}

function isMissingStaticCandidate(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return false;
  }

  return error.code === 'ENOENT' || error.code === 'ENOTDIR';
}

function normalizeRequestPath(pathname: string): string {
  const decoded = decodeURIComponent(pathname);
  const normalized = path.posix.normalize(decoded);
  const stripped = normalized.replace(/^(\.\.(\/|\\|$))+/, '').replace(/^\/+/, '');
  return stripped.replace(/\/+$/, '');
}

function getGenericFileCandidates(relativePath: string): readonly string[] {
  const hasExtension = path.posix.extname(relativePath) !== '';
  const candidates = hasExtension
    ? [relativePath]
    : [relativePath, `${relativePath}.html`, path.posix.join(relativePath, 'index.html')];

  return candidates;
}

function hasReservedPrefix(relativePath: string): boolean {
  return RESERVED_PREFIXES.some(
    (prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`),
  );
}

function setCacheHeaders(headers: Headers, relativePath: string): void {
  if (CONTENT_HASH_PATTERN.test(relativePath)) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    return;
  }

  const extension = path.extname(relativePath).toLowerCase();
  if (extension === '.html' || extension === '') {
    setNoCacheHeaders(headers);
    return;
  }

  if (STATIC_EXTENSIONS.has(extension)) {
    headers.set('Cache-Control', 'no-cache, must-revalidate');
  }
}

function setNoCacheHeaders(headers: Headers): void {
  headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  headers.set('Pragma', 'no-cache');
  headers.set('Expires', '0');
}
