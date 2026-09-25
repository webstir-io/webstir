import path from 'node:path';
import { access, stat } from 'node:fs/promises';

import type { RenderProgram } from '@webstir-io/module-contract';

import { readTextFile } from '../utils/bun.js';
import { readRenderProgram } from './render.js';

export type RequestTimeDocumentCacheStatus = 'miss' | 'hit' | 'stale';

export interface LoadedDocument {
  readonly path: string;
  readonly html: string;
  readonly program?: RenderProgram;
  readonly cacheStatus: RequestTimeDocumentCacheStatus;
}

function firstPathSegment(pathname: string): string | undefined {
  const normalized = normalizePath(pathname);
  if (normalized === '/') {
    return undefined;
  }
  const parts = normalized.split('/').filter(Boolean);
  return parts[0];
}

const documentTemplateCache = new Map<
  string,
  {
    html: string;
    ctimeMs: number;
    mtimeMs: number;
    size: number;
  }
>();

export async function loadFrontendDocument(
  workspaceRoot: string,
  pathname: string,
): Promise<LoadedDocument> {
  return await loadDocumentAt(await resolveFrontendDocumentPath(workspaceRoot, pathname));
}

async function loadDocumentAt(documentPath: string): Promise<LoadedDocument> {
  const documentStats = await stat(documentPath);
  const cached = documentTemplateCache.get(documentPath);

  if (
    cached &&
    cached.ctimeMs === documentStats.ctimeMs &&
    cached.mtimeMs === documentStats.mtimeMs &&
    cached.size === documentStats.size
  ) {
    return {
      path: documentPath,
      html: cached.html,
      cacheStatus: 'hit',
    };
  }

  const html = await readTextFile(documentPath);
  documentTemplateCache.set(documentPath, {
    html,
    ctimeMs: documentStats.ctimeMs,
    mtimeMs: documentStats.mtimeMs,
    size: documentStats.size,
  });

  return {
    path: documentPath,
    html,
    cacheStatus: cached ? 'stale' : 'miss',
  };
}

const programCache = new Map<string, { program: RenderProgram; mtimeMs: number; size: number }>();

export async function loadNotFoundDocument(workspaceRoot: string): Promise<string | undefined> {
  for (const candidate of getPageDocumentCandidates(workspaceRoot, '404')) {
    if (await fileExists(candidate)) {
      return (await loadDocumentAt(candidate)).html;
    }
  }
  return undefined;
}

export async function loadPageArtifact(
  workspaceRoot: string,
  page: string,
): Promise<LoadedDocument> {
  for (const htmlPath of getPageDocumentCandidates(workspaceRoot, page)) {
    const programPath = path.join(path.dirname(htmlPath), 'index.program.json');
    if (await fileExists(programPath)) {
      const stats = await stat(programPath);
      const cached = programCache.get(programPath);
      if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
        return { path: programPath, html: '', program: cached.program, cacheStatus: 'hit' };
      }
      const program = readRenderProgram(JSON.parse(await readTextFile(programPath)), programPath);
      programCache.set(programPath, { program, mtimeMs: stats.mtimeMs, size: stats.size });
      return { path: programPath, html: '', program, cacheStatus: cached ? 'stale' : 'miss' };
    }
    if (await fileExists(htmlPath)) {
      return await loadDocumentAt(htmlPath);
    }
  }
  throw new Error(`Page '${page}' was not found in build/frontend or dist/frontend.`);
}

async function resolveFrontendDocumentPath(
  workspaceRoot: string,
  pathname: string,
): Promise<string> {
  const candidates = getFrontendDocumentCandidates(workspaceRoot, pathname);

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Frontend document for ${normalizePath(pathname)} was not found. Checked ${candidates.join(', ')}.`,
  );
}

function getFrontendDocumentCandidates(workspaceRoot: string, pathname: string): string[] {
  return getPageDocumentCandidates(workspaceRoot, firstPathSegment(pathname) ?? 'home');
}

function getPageDocumentCandidates(workspaceRoot: string, pageName: string): string[] {
  const relativeCandidates =
    pageName === 'home'
      ? [
          path.join('pages', 'home', 'index.html'),
          path.join('home', 'index.html'),
          'home.html',
          'index.html',
        ]
      : [
          path.join('pages', pageName, 'index.html'),
          path.join(pageName, 'index.html'),
          `${pageName}.html`,
        ];

  const pinnedRoot = process.env.WEBSTIR_FRONTEND_ROOT?.trim();
  const roots = pinnedRoot
    ? [path.resolve(pinnedRoot)]
    : [path.join(workspaceRoot, 'build', 'frontend'), path.join(workspaceRoot, 'dist', 'frontend')];
  const candidates = roots.flatMap((root) =>
    relativeCandidates.map((relativePath) => path.join(root, relativePath)),
  );

  return Array.from(new Set(candidates));
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function normalizePath(value: string | undefined): string {
  if (!value || value === '/') {
    return '/';
  }
  const trimmed = value.endsWith('/') ? value.slice(0, -1) : value;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}
