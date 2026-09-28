import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { readWorkspaceLayers } from '@webstir-io/module-contract/workspace';

import { normalizeScaffoldSegment } from './scaffold-path.ts';

export type IslandLibrary = 'react' | 'preact' | 'solid' | 'svelte' | 'vue' | 'plain';

export interface RunAddIslandOptions {
  readonly workspaceRoot: string;
  readonly args: readonly string[];
  readonly rawArgs: readonly string[];
}

export interface AddIslandResult {
  readonly workspaceRoot: string;
  readonly target: string;
  readonly changes: readonly string[];
  readonly note: string;
}

const LIBRARY_FLAGS: Readonly<Record<string, IslandLibrary>> = {
  '--react': 'react',
  '--preact': 'preact',
  '--solid': 'solid',
  '--svelte': 'svelte',
  '--vue': 'vue',
};

/** What each library needs in package.json; the plain contract needs nothing. */
const LIBRARY_DEPENDENCIES: Readonly<
  Record<IslandLibrary, { dependencies: Record<string, string>; dev?: Record<string, string> }>
> = {
  react: {
    dependencies: { react: '^19.3.0', 'react-dom': '^19.3.0' },
    dev: { '@types/react': '^19.3.0', '@types/react-dom': '^19.3.0' },
  },
  preact: { dependencies: { preact: '^10.29.8' } },
  solid: {
    dependencies: { 'solid-js': '^1.9.15' },
    dev: {
      'babel-preset-solid': '^1.9.15',
      '@babel/core': '^7.28.0',
      '@babel/preset-typescript': '^7.27.0',
    },
  },
  svelte: { dependencies: { svelte: '^5.57.1' } },
  vue: { dependencies: { vue: '^3.5.43' } },
  plain: { dependencies: {} },
};

const DETECTION_ORDER: readonly [string, IslandLibrary][] = [
  ['react', 'react'],
  ['preact', 'preact'],
  ['solid-js', 'solid'],
  ['svelte', 'svelte'],
  ['vue', 'vue'],
];

const EXTENSIONS: Readonly<Record<IslandLibrary, string>> = {
  react: '.tsx',
  preact: '.tsx',
  solid: '.tsx',
  svelte: '.svelte',
  vue: '.vue',
  plain: '.ts',
};

const ISLAND_EXTENSIONS = ['.tsx', '.jsx', '.svelte', '.vue', '.ts', '.js'];

/**
 * Scaffolds `src/frontend/islands/<name>` in a library: the one a flag names, else the one the app
 * already uses, else the plain `mount` contract. Adds the library to package.json when missing.
 */
export async function runAddIsland(options: RunAddIslandOptions): Promise<AddIslandResult> {
  const rawName = options.args[0];
  if (!rawName) {
    throw new Error(
      'Usage: webstir add-island <name> [--react|--preact|--solid|--svelte|--vue] --workspace <path>.',
    );
  }
  const name = normalizeScaffoldSegment(rawName, 'island');
  const root = options.workspaceRoot;
  if (!readWorkspaceLayers(root).pages) {
    throw new Error(
      'add-island needs an app with pages (src/frontend); run `webstir enable frontend` first.',
    );
  }

  const flags = options.rawArgs.filter((arg) => arg in LIBRARY_FLAGS);
  if (flags.length > 1) {
    throw new Error(`Pick one library for island "${name}", not ${flags.join(' and ')}.`);
  }
  const packageJsonPath = path.join(root, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as Record<
    string,
    unknown
  >;
  const library = flags[0] ? LIBRARY_FLAGS[flags[0]]! : detectLibrary(packageJson);

  const islandsRoot = path.join(root, 'src', 'frontend', 'islands');
  const existing = ISLAND_EXTENSIONS.find((extension) =>
    existsSync(path.join(islandsRoot, `${name}${extension}`)),
  );
  if (existing) {
    throw new Error(`Island "${name}" already exists (src/frontend/islands/${name}${existing}).`);
  }

  const changes: string[] = [];
  const target = path.join(islandsRoot, `${name}${EXTENSIONS[library]}`);
  await mkdir(islandsRoot, { recursive: true });
  await writeFile(target, islandTemplate(library), 'utf8');
  changes.push(relative(root, target));

  const added = addDependencies(packageJson, library);
  if (added) {
    await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
    changes.push('package.json');
  }
  if (await setJsxOptions(root, library)) changes.push('src/frontend/tsconfig.json');

  const usage = `Place it in a page: <div data-island="${name}" data-load="visible">…</div>`;
  return {
    workspaceRoot: root,
    target: relative(root, target),
    changes,
    note: added ? `${usage}. package.json gained dependencies; run \`bun install\`.` : `${usage}.`,
  };
}

function detectLibrary(packageJson: Record<string, unknown>): IslandLibrary {
  const dependencies = {
    ...(packageJson.devDependencies as Record<string, string> | undefined),
    ...(packageJson.dependencies as Record<string, string> | undefined),
  };
  return DETECTION_ORDER.find(([dependency]) => dependency in dependencies)?.[1] ?? 'plain';
}

function addDependencies(packageJson: Record<string, unknown>, library: IslandLibrary): boolean {
  const needs = LIBRARY_DEPENDENCIES[library];
  let added = false;
  for (const [field, wanted] of [
    ['dependencies', needs.dependencies],
    ['devDependencies', needs.dev ?? {}],
  ] as const) {
    const current = { ...(packageJson[field] as Record<string, string> | undefined) };
    for (const [dependency, version] of Object.entries(wanted)) {
      if (dependency in current) continue;
      current[dependency] = version;
      added = true;
    }
    if (Object.keys(current).length > 0) packageJson[field] = current;
  }
  return added;
}

/** JSX islands type-check in an editor with the library's JSX settings. */
async function setJsxOptions(root: string, library: IslandLibrary): Promise<boolean> {
  if (library !== 'react' && library !== 'preact' && library !== 'solid') return false;
  const tsconfigPath = path.join(root, 'src', 'frontend', 'tsconfig.json');
  if (!existsSync(tsconfigPath)) return false;
  let tsconfig: { compilerOptions?: Record<string, unknown>; include?: string[] };
  try {
    tsconfig = JSON.parse(await readFile(tsconfigPath, 'utf8'));
  } catch {
    return false;
  }
  const compilerOptions = { ...tsconfig.compilerOptions };
  if (compilerOptions.jsx !== undefined) return false;
  compilerOptions.jsx = library === 'solid' ? 'preserve' : 'react-jsx';
  compilerOptions.jsxImportSource = library === 'solid' ? 'solid-js' : library;
  tsconfig.compilerOptions = compilerOptions;
  if (Array.isArray(tsconfig.include) && !tsconfig.include.includes('**/*.tsx')) {
    tsconfig.include = [...tsconfig.include, '**/*.tsx'];
  }
  await writeFile(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`, 'utf8');
  return true;
}

function relative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}

function islandTemplate(library: IslandLibrary): string {
  switch (library) {
    case 'react':
      return `import { useState } from 'react';

export default function Island({ start = 0 }: { start?: number }) {
  const [count, setCount] = useState(start);
  return (
    <button type="button" onClick={() => setCount(count + 1)}>
      Clicked {count} times
    </button>
  );
}
`;
    case 'preact':
      return `import { useState } from 'preact/hooks';

export default function Island({ start = 0 }: { start?: number }) {
  const [count, setCount] = useState(start);
  return (
    <button type="button" onClick={() => setCount(count + 1)}>
      Clicked {count} times
    </button>
  );
}
`;
    case 'solid':
      return `import { createSignal } from 'solid-js';

export default function Island(props: { start?: number }) {
  const [count, setCount] = createSignal(props.start ?? 0);
  return (
    <button type="button" onClick={() => setCount(count() + 1)}>
      Clicked {count()} times
    </button>
  );
}
`;
    case 'svelte':
      return `<script lang="ts">
  let { start = 0 }: { start?: number } = $props();
  let count = $state(start);
</script>

<button type="button" onclick={() => (count += 1)}>Clicked {count} times</button>
`;
    case 'vue':
      return `<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{ start?: number }>();
const count = ref(props.start ?? 0);
</script>

<template>
  <button type="button" @click="count++">Clicked {{ count }} times</button>
</template>
`;
    case 'plain':
      return `// An island in no library: mount into the element, and return how to unmount.
export function mount(
  element: HTMLElement,
  props: { start?: number },
  { signal }: { signal: AbortSignal },
): () => void {
  let count = props.start ?? 0;
  const button = document.createElement('button');
  button.type = 'button';
  const show = () => {
    button.textContent = \`Clicked \${count} times\`;
  };
  show();
  button.addEventListener(
    'click',
    () => {
      count += 1;
      show();
    },
    { signal },
  );
  element.replaceChildren(button);
  return () => button.remove();
}
`;
  }
}
