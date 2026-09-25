import path from 'node:path';

import {
  executeRenderProgram,
  prepareViewData,
  readRenderProgram,
} from '@webstir-io/module-contract';

import type { WorkspacePackageJson } from '../../config/workspaceManifest.js';
import { loadBackendModuleDefinition } from '../../utils/backendModule.js';
import { pathExists, readFile, readJson } from '../../utils/fs.js';
import {
  createMinimalSsrContext,
  deriveRouteParams,
  findViewMetadata,
  getEffectiveStaticPaths,
  normalizePath,
  type ViewDefinitionLike,
} from './views.js';

export interface SsgRenderedPage {
  /** The address the page is published at, such as `/blog/hello`. */
  readonly path: string;
  readonly page: string;
  readonly view: string;
  readonly html: string;
}

interface PageViewLike {
  readonly definition?: ViewDefinitionLike;
  readonly data?: unknown;
  readonly load?: (context: unknown) => unknown | Promise<unknown>;
}

/**
 * Renders every SSG view that names a page: runs its loader for each static path, checks what
 * it returns against the view's data schema, and runs the page's program over it. Static output
 * has no session, so POST forms render without a CSRF field.
 */
export async function renderSsgViews(options: {
  readonly workspaceRoot: string;
  /** Where the page's published document lives; its program sits beside it. */
  readonly pageDirectory: (page: string) => string;
}): Promise<SsgRenderedPage[]> {
  const pkg = await readJson<WorkspacePackageJson>(
    path.join(options.workspaceRoot, 'package.json'),
  );
  const isSsgWorkspace = pkg?.webstir?.mode?.toLowerCase() === 'ssg';
  const metadata = pkg?.webstir?.moduleManifest?.views ?? [];
  const moduleDefinition = await loadBackendModuleDefinition<{ views?: readonly PageViewLike[] }>(
    options.workspaceRoot,
  );

  const rendered: SsgRenderedPage[] = [];
  const documents = new Map<string, (data: unknown) => string>();
  for (const view of moduleDefinition?.views ?? []) {
    const definition = view.definition ?? {};
    const page = definition.page;
    if (!page) {
      continue;
    }
    const name = definition.name || definition.path || page;
    const meta = findViewMetadata(metadata, definition.name ?? '', definition.path ?? '');
    const renderMode =
      meta?.renderMode ?? definition.renderMode ?? (isSsgWorkspace ? 'ssg' : undefined);
    if (renderMode !== 'ssg') {
      throw new Error(
        `[webstir-frontend] view ${name} renders page '${page}' as ${renderMode ?? 'a server page'}, which a static site cannot serve; remove its renderMode or make it 'ssg'.`,
      );
    }
    const staticPaths = getEffectiveStaticPaths(meta, definition, isSsgWorkspace);
    if (staticPaths.length === 0) {
      throw new Error(
        `[webstir-frontend] view ${name} renders page '${page}' at ${definition.path ?? '(no path)'}, which names no single address; list the addresses to publish in staticPaths.`,
      );
    }

    let render = documents.get(page);
    if (!render) {
      render = await loadPageDocument(options.pageDirectory(page));
      documents.set(page, render);
    }

    for (const rawPath of staticPaths) {
      const urlPath = normalizePath(rawPath);
      const params = deriveRouteParams(definition.path ?? '', urlPath);
      if (!params) {
        throw new Error(
          `[webstir-frontend] view ${name} lists ${urlPath}, which does not match its path ${definition.path}.`,
        );
      }
      const clash = rendered.find((entry) => entry.path === urlPath);
      if (clash) {
        throw new Error(
          `[webstir-frontend] views ${clash.view} and ${name} both publish ${urlPath}.`,
        );
      }
      let loaded: unknown = {};
      try {
        loaded = view.load ? await view.load(createMinimalSsrContext(urlPath, params)) : {};
      } catch (error) {
        throw new Error(
          `[webstir-frontend] view ${name} failed to load ${urlPath}: ${describeError(error)}`,
        );
      }
      // Static pages carry no flash messages; views bind `flash` like any other page.
      const prepared = prepareViewData(view.data, loaded, []);
      if (!prepared.ok) {
        throw new Error(
          `[webstir-frontend] view ${name} returned data for ${urlPath} that does not match its schema: ${prepared.error}`,
        );
      }
      rendered.push({ path: urlPath, page, view: name, html: render(prepared.data) });
    }
  }
  return rendered;
}

/** A page with bindings renders from its program; one without is published as written. */
async function loadPageDocument(directory: string): Promise<(data: unknown) => string> {
  const programPath = path.join(directory, 'index.program.json');
  if (await pathExists(programPath)) {
    const program = readRenderProgram(await readJson(programPath), programPath);
    return (data) => executeRenderProgram(program, data, { csrfToken: false });
  }
  const html = await readFile(path.join(directory, 'index.html'));
  return () => html;
}

function describeError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}
