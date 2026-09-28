import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { build as esbuild, type Plugin } from 'esbuild';

import { createCompressedVariants } from '../assets/precompression.js';
import type { FrontendConfig } from '../types.js';
import { ensureDir, pathExists, remove } from '../utils/fs.js';

/** Island sources, by extension: which library mounts them. */
const ISLAND_EXTENSIONS = ['.tsx', '.jsx', '.svelte', '.vue', '.ts', '.js'] as const;
const JSX_LIBRARIES = ['react', 'preact', 'solid-js'] as const;
type JsxLibrary = (typeof JSX_LIBRARIES)[number];
type IslandLibrary = JsxLibrary | 'svelte' | 'vue' | 'plain';

export interface Island {
  readonly name: string;
  readonly file: string;
  readonly library: IslandLibrary;
}

/** Where the build writes islands, and the manifest the loader and the HTML build read. */
export interface IslandsManifest {
  /** The loader's address, which pages with islands load. */
  readonly loader: string;
  /** Island name to its bundle's address. */
  readonly islands: Readonly<Record<string, string>>;
}

export const ISLANDS_FOLDER = 'islands';
/** Where island bundles publish: beside the app's own bundle, never a page's address. */
const ISLANDS_OUTPUT = path.join('app', ISLANDS_FOLDER);
const ISLANDS_URL = `/app/${ISLANDS_FOLDER}`;
const MANIFEST_FILE = 'islands.json';
const runtimeEntry = fileURLToPath(new URL('../islands/runtime.js', import.meta.url));

export function islandsSourceRoot(config: FrontendConfig): string {
  return path.join(config.paths.src.frontend, ISLANDS_FOLDER);
}

export async function readIslandsManifest(outputRoot: string): Promise<IslandsManifest | null> {
  const file = path.join(outputRoot, ISLANDS_OUTPUT, MANIFEST_FILE);
  return (await pathExists(file))
    ? (JSON.parse(await readFile(file, 'utf8')) as IslandsManifest)
    : null;
}

/** The app's islands: one per file in src/frontend/islands, named by the file. */
export async function listIslands(config: FrontendConfig): Promise<readonly Island[]> {
  const root = islandsSourceRoot(config);
  if (!(await pathExists(root))) return [];
  const jsx = await resolveJsxLibrary(config.paths.workspace);
  const islands: Island[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const extension = ISLAND_EXTENSIONS.find((candidate) => entry.name.endsWith(candidate));
    if (!extension || entry.name.endsWith('.d.ts')) continue;
    const name = entry.name.slice(0, -extension.length);
    const library: IslandLibrary =
      extension === '.svelte'
        ? 'svelte'
        : extension === '.vue'
          ? 'vue'
          : extension === '.tsx' || extension === '.jsx'
            ? requireJsx(jsx, entry.name)
            : 'plain';
    islands.push({ name, file: path.join(root, entry.name), library });
  }
  return islands.sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Builds the app's islands as one code-split bundle, so a library several islands use ships once,
 * then the loader that mounts them, with the manifest from name to bundle.
 */
export async function buildIslands(config: FrontendConfig, isProduction: boolean): Promise<void> {
  const outputRoot = path.join(
    isProduction ? config.paths.dist.frontend : config.paths.build.frontend,
    ISLANDS_OUTPUT,
  );
  await remove(outputRoot);
  const islands = await listIslands(config);
  if (islands.length === 0) return;

  const workspaceRoot = config.paths.workspace;
  const wrapperRoot = path.join(workspaceRoot, 'build', '.webstir', 'islands');
  await remove(wrapperRoot);
  await ensureDir(wrapperRoot);
  const entryPoints: Record<string, string> = {};
  for (const island of islands) {
    const wrapper = path.join(wrapperRoot, `${island.name}.ts`);
    await writeFile(wrapper, mountWrapper(island), 'utf8');
    entryPoints[island.name] = wrapper;
  }

  const jsx = islands.find((island) => isJsxLibrary(island.library))?.library as
    | JsxLibrary
    | undefined;
  const result = await esbuild({
    entryPoints,
    bundle: true,
    splitting: true,
    format: 'esm',
    target: 'es2020',
    platform: 'browser',
    outdir: outputRoot,
    entryNames: isProduction ? '[name]-[hash]' : '[name]',
    chunkNames: 'chunks/[name]-[hash]',
    minify: isProduction,
    sourcemap: !isProduction,
    metafile: true,
    logLevel: 'silent',
    // A workspace's own node_modules holds the island libraries.
    nodePaths: [path.join(workspaceRoot, 'node_modules')],
    jsx: 'automatic',
    jsxImportSource: jsx === 'preact' ? 'preact' : 'react',
    define: { 'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development') },
    plugins: [
      svelteIslands(workspaceRoot, islands),
      vueIslands(workspaceRoot, islands),
      solidIslands(workspaceRoot, islands),
    ],
  });

  const addresses: Record<string, string> = {};
  for (const [output, meta] of Object.entries(result.metafile.outputs)) {
    if (!meta.entryPoint) continue;
    // Each island's wrapper is named for it; paths in the metafile may be resolved differently.
    const name = path.basename(meta.entryPoint, '.ts');
    if (name in entryPoints) {
      // Entry bundles sit at the top of the islands folder ([name] or [name]-[hash]).
      addresses[name] = `${ISLANDS_URL}/${path.basename(output)}`;
    }
  }

  const loaderSource = `import { startIslands } from ${JSON.stringify(runtimeEntry)};\nstartIslands(${JSON.stringify(addresses)});\n`;
  const loaderName = isProduction
    ? `loader-${createHash('sha256').update(loaderSource).digest('hex').slice(0, 8)}.js`
    : 'loader.js';
  await esbuild({
    stdin: { contents: loaderSource, resolveDir: wrapperRoot, loader: 'ts' },
    bundle: true,
    format: 'esm',
    target: 'es2020',
    platform: 'browser',
    outfile: path.join(outputRoot, loaderName),
    minify: isProduction,
    logLevel: 'silent',
  });

  if (isProduction && config.features.precompression) {
    for (const entry of await readdir(outputRoot, { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.js')) {
        await createCompressedVariants(path.join(entry.parentPath, entry.name));
      }
    }
  }

  const manifest: IslandsManifest = {
    loader: `${ISLANDS_URL}/${loaderName}`,
    islands: addresses,
  };
  await writeFile(path.join(outputRoot, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Mounts the island's default export with its library's own API; a plain island exports mount. */
function mountWrapper(island: Island): string {
  const source = JSON.stringify(island.file);
  switch (island.library) {
    case 'react':
      return `import Component from ${source};
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
export default function mount(element, props) {
  element.replaceChildren();
  const root = createRoot(element);
  root.render(createElement(Component, props));
  return () => root.unmount();
}
`;
    case 'preact':
      return `import Component from ${source};
import { h, render } from 'preact';
export default function mount(element, props) {
  element.replaceChildren();
  render(h(Component, props), element);
  return () => render(null, element);
}
`;
    case 'solid-js':
      return `import Component from ${source};
import { createComponent } from 'solid-js';
import { render } from 'solid-js/web';
export default function mount(element, props) {
  element.replaceChildren();
  return render(() => createComponent(Component, props), element);
}
`;
    case 'svelte':
      return `import Component from ${source};
import { mount as mountComponent, unmount } from 'svelte';
export default function mount(element, props) {
  element.replaceChildren();
  const component = mountComponent(Component, { target: element, props });
  return () => unmount(component);
}
`;
    case 'vue':
      return `import Component from ${source};
import { createApp } from 'vue';
export default function mount(element, props) {
  const app = createApp(Component, props);
  element.replaceChildren();
  app.mount(element);
  return () => app.unmount();
}
`;
    case 'plain':
      return `export { mount as default } from ${source};\n`;
  }
}

function isJsxLibrary(library: IslandLibrary): library is JsxLibrary {
  return (JSX_LIBRARIES as readonly string[]).includes(library);
}

/** JSX islands use the app's JSX library; with several, `webstir.islands.jsx` names one. */
async function resolveJsxLibrary(workspaceRoot: string): Promise<JsxLibrary | string | null> {
  const packageJson = JSON.parse(
    await readFile(path.join(workspaceRoot, 'package.json'), 'utf8'),
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    webstir?: { islands?: { jsx?: string } };
  };
  const chosen = packageJson.webstir?.islands?.jsx;
  if (chosen) {
    return (JSX_LIBRARIES as readonly string[]).includes(chosen)
      ? (chosen as JsxLibrary)
      : `webstir.islands.jsx is "${chosen}"; expected one of ${JSX_LIBRARIES.join(', ')}`;
  }
  const dependencies = { ...packageJson.devDependencies, ...packageJson.dependencies };
  const installed = JSX_LIBRARIES.filter((library) => library in dependencies);
  if (installed.length > 1) {
    return `the app depends on ${installed.join(' and ')}; set webstir.islands.jsx in package.json to the one its JSX islands use`;
  }
  return installed[0] ?? null;
}

function requireJsx(jsx: JsxLibrary | string | null, file: string): JsxLibrary {
  if (jsx && (JSX_LIBRARIES as readonly string[]).includes(jsx)) return jsx as JsxLibrary;
  throw new Error(
    `[webstir-frontend] island src/frontend/islands/${file} is JSX, but ${
      jsx ?? `the app has no JSX library; add one of ${JSX_LIBRARIES.join(', ')}`
    }.`,
  );
}

/** Loads a compiler from the app's own dependencies, naming the island that needs it. */
async function importFromApp<T>(
  workspaceRoot: string,
  specifier: string,
  island: string,
): Promise<T> {
  const require = createRequire(path.join(workspaceRoot, 'package.json'));
  let resolved: string;
  try {
    resolved = require.resolve(specifier);
  } catch {
    throw new Error(
      `[webstir-frontend] island ${island} needs ${specifier}; add its package to the app's dependencies.`,
    );
  }
  return (await import(pathToFileURL(resolved).href)) as T;
}

function islandFile(islands: readonly Island[], library: IslandLibrary): string | undefined {
  const island = islands.find((candidate) => candidate.library === library);
  return island && `src/frontend/islands/${path.basename(island.file)}`;
}

// The parts of each compiler the build uses; the compilers are the app's own dependencies.
interface SvelteCompiler {
  compile(
    source: string,
    options: { filename: string; generate: 'client'; css: 'injected' },
  ): { js: { code: string } };
}

interface VueBlock {
  readonly content: string;
  readonly scoped?: boolean;
}

interface VueCompiler {
  parse(
    source: string,
    options: { filename: string },
  ): {
    descriptor: {
      script: VueBlock | null;
      scriptSetup: VueBlock | null;
      template: VueBlock | null;
      styles: readonly VueBlock[];
    };
  };
  compileScript(
    descriptor: unknown,
    options: { id: string; inlineTemplate: boolean },
  ): { content: string; lang?: string };
  rewriteDefault(code: string, name: string): string;
  compileTemplate(options: { source: string; filename: string; id: string; scoped: boolean }): {
    code: string;
  };
  compileStyle(options: { source: string; filename: string; id: string; scoped?: boolean }): {
    code: string;
  };
}

interface BabelCore {
  transformAsync(
    source: string,
    options: Record<string, unknown>,
  ): Promise<{ code?: string | null } | null>;
}

function svelteIslands(workspaceRoot: string, islands: readonly Island[]): Plugin {
  return {
    name: 'webstir-svelte-islands',
    setup(build) {
      build.onLoad({ filter: /\.svelte$/ }, async (args) => {
        const { compile } = await importFromApp<SvelteCompiler>(
          workspaceRoot,
          'svelte/compiler',
          islandFile(islands, 'svelte') ?? args.path,
        );
        const result = compile(await readFile(args.path, 'utf8'), {
          filename: args.path,
          generate: 'client',
          css: 'injected',
        });
        return { contents: result.js.code, loader: 'js', resolveDir: path.dirname(args.path) };
      });
    },
  };
}

function vueIslands(workspaceRoot: string, islands: readonly Island[]): Plugin {
  return {
    name: 'webstir-vue-islands',
    setup(build) {
      build.onLoad({ filter: /\.vue$/ }, async (args) => {
        const sfc = await importFromApp<VueCompiler>(
          workspaceRoot,
          'vue/compiler-sfc',
          islandFile(islands, 'vue') ?? args.path,
        );
        const source = await readFile(args.path, 'utf8');
        const { descriptor } = sfc.parse(source, { filename: args.path });
        const id = createHash('sha256').update(args.path).digest('hex').slice(0, 8);
        const scoped = descriptor.styles.some((style) => style.scoped);
        const lines: string[] = [];
        let lang = 'js';
        if (descriptor.script || descriptor.scriptSetup) {
          const script = sfc.compileScript(descriptor, {
            id,
            inlineTemplate: Boolean(descriptor.scriptSetup),
          });
          lang = script.lang === 'ts' || script.lang === 'tsx' ? 'ts' : 'js';
          lines.push(sfc.rewriteDefault(script.content, '__component'));
        } else {
          lines.push('const __component = {};');
        }
        if (descriptor.template && !descriptor.scriptSetup) {
          const template = sfc.compileTemplate({
            source: descriptor.template.content,
            filename: args.path,
            id,
            scoped,
          });
          lines.push(template.code.replace('export function render', 'function render'));
          lines.push('__component.render = render;');
        }
        if (scoped) lines.push(`__component.__scopeId = 'data-v-${id}';`);
        for (const style of descriptor.styles) {
          const css = sfc.compileStyle({
            source: style.content,
            filename: args.path,
            id: `data-v-${id}`,
            scoped: style.scoped,
          }).code;
          lines.push(
            `{ const style = document.createElement('style'); style.textContent = ${JSON.stringify(css)}; document.head.append(style); }`,
          );
        }
        lines.push('export default __component;');
        return {
          contents: lines.join('\n'),
          loader: lang as 'ts' | 'js',
          resolveDir: path.dirname(args.path),
        };
      });
    },
  };
}

function solidIslands(workspaceRoot: string, islands: readonly Island[]): Plugin {
  const solid = islands.filter((island) => island.library === 'solid-js');
  return {
    name: 'webstir-solid-islands',
    setup(build) {
      if (solid.length === 0) return;
      // Real paths on both sides: the bundler may see a file through a different path (/var and
      // /private/var on macOS, say).
      const files = new Set(solid.map((island) => realpathSync(island.file)));
      build.onLoad({ filter: /\.(tsx|jsx)$/ }, async (args) => {
        if (!files.has(realpathSync(args.path))) return undefined;
        const label = `src/frontend/islands/${path.basename(args.path)}`;
        const babel = await importFromApp<BabelCore>(workspaceRoot, '@babel/core', label);
        const require = createRequire(path.join(workspaceRoot, 'package.json'));
        const preset = (name: string) => {
          try {
            return require.resolve(name);
          } catch {
            throw new Error(
              `[webstir-frontend] island ${label} needs ${name}; add its package to the app's dependencies.`,
            );
          }
        };
        const result = await babel.transformAsync(await readFile(args.path, 'utf8'), {
          filename: args.path,
          babelrc: false,
          configFile: false,
          presets: [
            [preset('babel-preset-solid'), { generate: 'dom' }],
            ...(args.path.endsWith('.tsx') ? [preset('@babel/preset-typescript')] : []),
          ],
        });
        return { contents: result?.code ?? '', loader: 'js', resolveDir: path.dirname(args.path) };
      });
    },
  };
}
