import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
  /** Island name to its bundle's address, and to its stylesheet's when it imports CSS. */
  readonly islands: IslandAddresses;
}

export interface IslandAddresses {
  readonly modules: Readonly<Record<string, string>>;
  readonly styles: Readonly<Record<string, string>>;
}

export const ISLANDS_FOLDER = 'islands';
/** Where island bundles publish: beside the app's own bundle, never a page's address. */
const ISLANDS_OUTPUT = path.join('app', ISLANDS_FOLDER);
const ISLANDS_URL = `/app/${ISLANDS_FOLDER}`;
const MANIFEST_FILE = 'islands.json';
/** The loader sits in its own folder, so no island's bundle (`<name>.js`) can take its name. */
const LOADER_FOLDER = 'runtime';
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
    const other = islands.find((island) => island.name === name);
    if (other) {
      throw new Error(
        `[webstir-frontend] src/frontend/islands/${path.basename(other.file)} and ${entry.name} are both the island "${name}"; rename one.`,
      );
    }
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

  const modules: Record<string, string> = {};
  const styles: Record<string, string> = {};
  for (const [output, meta] of Object.entries(result.metafile.outputs)) {
    if (!meta.entryPoint) continue;
    // Each island's wrapper is named for it; paths in the metafile may be resolved differently.
    const name = path.basename(meta.entryPoint, '.ts');
    if (name in entryPoints) {
      // Entry bundles, and the CSS they import, sit at the top of the islands folder.
      modules[name] = `${ISLANDS_URL}/${path.basename(output)}`;
      if (meta.cssBundle) styles[name] = `${ISLANDS_URL}/${path.basename(meta.cssBundle)}`;
    }
  }
  const addresses: IslandAddresses = { modules, styles };

  // The loader's own folder keeps its sources and output apart from any island's.
  const loaderSourceRoot = path.join(wrapperRoot, LOADER_FOLDER);
  await ensureDir(loaderSourceRoot);
  const loaderEntry = path.join(loaderSourceRoot, 'loader.ts');
  await writeFile(
    loaderEntry,
    `import { startIslands } from ${JSON.stringify(runtimeEntry)};\nstartIslands(${JSON.stringify(addresses)});\n`,
  );
  const loaderResult = await esbuild({
    entryPoints: [loaderEntry],
    bundle: true,
    format: 'esm',
    target: 'es2020',
    platform: 'browser',
    outdir: path.join(outputRoot, LOADER_FOLDER),
    // Hashed from the bundled output, so a new runtime gets a new name.
    entryNames: isProduction ? 'loader-[hash]' : 'loader',
    minify: isProduction,
    metafile: true,
    logLevel: 'silent',
  });
  const loaderOutput = Object.keys(loaderResult.metafile.outputs).find((output) =>
    output.endsWith('.js'),
  );
  if (!loaderOutput) throw new Error('[webstir-frontend] the islands loader did not build.');
  const loaderName = path.posix.join(LOADER_FOLDER, path.basename(loaderOutput));

  if (isProduction && config.features.precompression) {
    for (const entry of await readdir(outputRoot, { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && /\.(js|css)$/.test(entry.name)) {
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
    options: { filename: string; generate: 'client'; css: 'external' },
  ): { js: { code: string }; css: { code: string } | null };
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
    options: { id: string; inlineTemplate: boolean; genDefaultAs: string },
  ): { content: string; lang?: string };
  compileTemplate(options: { source: string; filename: string; id: string; scoped: boolean }): {
    code: string;
    errors: readonly (string | Error)[];
  };
  compileStyle(options: { source: string; filename: string; id: string; scoped?: boolean }): {
    code: string;
    errors: readonly Error[];
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
          css: 'external',
        });
        return {
          contents: `${result.js.code}\n${replaceStyles(args.path, result.css ? [result.css.code] : [])}`,
          loader: 'js',
          resolveDir: path.dirname(args.path),
        };
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
            genDefaultAs: '__component',
          });
          lang = script.lang === 'ts' || script.lang === 'tsx' ? 'ts' : 'js';
          lines.push(script.content);
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
          throwCompilerErrors(args.path, template.errors);
          lines.push(template.code.replace('export function render', 'function render'));
          lines.push('__component.render = render;');
        }
        if (scoped) lines.push(`__component.__scopeId = 'data-v-${id}';`);
        const styles = descriptor.styles.map((style) => {
          const css = sfc.compileStyle({
            source: style.content,
            filename: args.path,
            id: `data-v-${id}`,
            scoped: style.scoped,
          });
          throwCompilerErrors(args.path, css.errors);
          return css.code;
        });
        lines.push(replaceStyles(args.path, styles));
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

/**
 * A component's styles, as one set per source file: a new build of the file replaces the styles the
 * previous one added, so a rule deleted in watch is gone after the island mounts again.
 */
function replaceStyles(file: string, styles: readonly string[]): string {
  const owner = createHash('sha256').update(file).digest('hex').slice(0, 8);
  return `for (const style of document.head.querySelectorAll('style[data-webstir-island-style="${owner}"]')) style.remove();
for (const css of ${JSON.stringify(styles)}) {
  const style = document.createElement('style');
  style.setAttribute('data-webstir-island-style', '${owner}');
  style.textContent = css;
  document.head.append(style);
}
`;
}

/** Compiler diagnostics fail the build, naming the file, instead of shipping incomplete output. */
function throwCompilerErrors(file: string, errors: readonly (string | Error)[]): void {
  if (errors.length === 0) return;
  const messages = errors.map((error) => (typeof error === 'string' ? error : error.message));
  throw new Error(`[webstir-frontend] ${file}: ${messages.join('; ')}`);
}

function solidIslands(workspaceRoot: string, islands: readonly Island[]): Plugin {
  return {
    name: 'webstir-solid-islands',
    setup(build) {
      if (!islands.some((island) => island.library === 'solid-js')) return;
      // An app's JSX is all one library's: an island's own components compile as Solid too.
      build.onLoad({ filter: /\.(tsx|jsx)$/ }, async (args) => {
        if (args.path.split(path.sep).includes('node_modules')) return undefined;
        const label = path.relative(workspaceRoot, args.path).split(path.sep).join('/');
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
