import path from 'node:path';

export interface SsgDevPages {
  /** Rebuilds the view module, checks the templates, and renders every view's static paths. */
  refresh(): Promise<void>;
  /**
   * A rendered page's HTML; `null` for a page template that only a view publishes, which the
   * published site would not have either; `undefined` for any other address.
   */
  lookup(pathname: string): string | null | undefined;
}

/**
 * Watch serves an SSG site's views as the publish would write them, rendered from the build
 * output after each rebuild, so the pages in development are the pages that ship.
 */
export function createSsgDevPages(workspaceRoot: string): SsgDevPages {
  let pages = new Map<string, string>();
  let hidden = new Set<string>();
  return {
    async refresh() {
      const { buildWorkspaceModuleDefinition } = await import('@webstir-io/webstir-backend');
      const { renderSsgViews, validateRenderPrograms } = await import(
        '@webstir-io/webstir-frontend'
      );
      await buildWorkspaceModuleDefinition(workspaceRoot);
      const pagesRoot = path.join(workspaceRoot, 'build', 'frontend', 'pages');
      await validateRenderPrograms({ workspaceRoot, pagesRoot });
      const rendered = await renderSsgViews({
        workspaceRoot,
        pageDirectory: (page) => path.join(pagesRoot, page),
      });
      pages = new Map(rendered.map((entry) => [entry.path, entry.html]));
      hidden = new Set(
        [...new Set(rendered.map((entry) => entry.page))]
          .map((page) => (page === 'home' ? '/' : `/${page}`))
          .filter((address) => !pages.has(address)),
      );
    },
    lookup(pathname) {
      const address = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
      if (pages.has(address)) {
        return pages.get(address);
      }
      return hidden.has(address) ? null : undefined;
    },
  };
}
