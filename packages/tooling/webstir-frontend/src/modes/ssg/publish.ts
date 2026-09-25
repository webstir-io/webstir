import path from 'node:path';

import { RENDER_PROGRAM_FILE } from '@webstir-io/module-contract';

import { createCompressedVariants } from '../../assets/precompression.js';
import { EXTENSIONS, FILES, FOLDERS } from '../../core/constants.js';
import { validateRenderPrograms } from '../../render/validate.js';
import type { FrontendConfig } from '../../types.js';
import { ensureDir, remove, writeFile } from '../../utils/fs.js';
import { scanGlob } from '../../utils/glob.js';
import { isRootPagesLayout, resolvePageHtmlDir } from '../../utils/pagePaths.js';
import { renderSsgViews } from './render.js';
import { applySsgRouting } from './routing.js';
import { generateSsgViewData } from './views.js';

/**
 * Finishes an SSG publish: checks every template against the view that renders it, writes each
 * view's static paths as finished HTML, publishes a claimed page's template only where a view
 * renders it, and drops the programs, which are build artifacts and not part of the site.
 */
export async function publishSsgSite(config: FrontendConfig): Promise<void> {
  const distRoot = config.paths.dist.frontend;
  const useRootIndex = isRootPagesLayout(distRoot, config.paths.dist.pages);
  const pageDirectory = (page: string) =>
    resolvePageHtmlDir(config.paths.dist.pages, page, useRootIndex);

  await validateRenderPrograms({
    workspaceRoot: config.paths.workspace,
    pagesRoot: config.paths.build.pages,
  });
  const rendered = await renderSsgViews({ workspaceRoot: config.paths.workspace, pageDirectory });
  const renderedPaths = new Set(rendered.map((entry) => entry.path));

  for (const entry of new Set(rendered.map((page) => page.page))) {
    const own = entry === FOLDERS.home ? '/' : `/${entry}`;
    if (!renderedPaths.has(own)) {
      await removeWithVariants(path.join(pageDirectory(entry), FILES.indexHtml));
    }
  }
  for (const entry of rendered) {
    const target = path.join(distRoot, ...entry.path.split('/').filter(Boolean), FILES.indexHtml);
    await ensureDir(path.dirname(target));
    await writeFile(target, entry.html);
    if (config.features.precompression) {
      await createCompressedVariants(target);
    } else {
      await removeVariants(target);
    }
  }
  for (const program of await scanGlob(`**/${RENDER_PROGRAM_FILE}`, { cwd: distRoot })) {
    await remove(path.join(distRoot, program));
  }

  await generateSsgViewData(config);
  await applySsgRouting(config, { rendered: renderedPaths });
}

async function removeWithVariants(filePath: string): Promise<void> {
  await remove(filePath);
  await removeVariants(filePath);
}

async function removeVariants(filePath: string): Promise<void> {
  await Promise.all([remove(`${filePath}${EXTENSIONS.br}`), remove(`${filePath}${EXTENSIONS.gz}`)]);
}
