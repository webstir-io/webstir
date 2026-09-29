import { expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { link, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { readWorkspaceLayers } from '@webstir-io/module-contract/workspace';

import { materializeRepoLocalWorkspaceDependencies } from '../src/external-workspace.ts';
import { packageRoot, repoRoot } from '../src/paths.ts';
import { copyDemoWorkspace, removeDemoWorkspace } from '../test-support/demo-workspace.ts';

function decodeOutput(buffer: Uint8Array | undefined): string {
  return new TextDecoder().decode(buffer ?? new Uint8Array());
}

async function runEnableInWorkspace(
  copiedWorkspace: string,
  featureArgs: readonly string[],
): Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number }> {
  const processResult = Bun.spawnSync({
    cmd: [
      process.execPath,
      path.join(packageRoot, 'src', 'cli.ts'),
      'enable',
      ...featureArgs,
      '--workspace',
      copiedWorkspace,
    ],
    cwd: repoRoot,
    env: process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return {
    stdout: decodeOutput(processResult.stdout),
    stderr: decodeOutput(processResult.stderr),
    exitCode: processResult.exitCode,
  };
}

async function runWorkspaceCli(
  copiedWorkspace: string,
  args: readonly string[],
): Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number }> {
  const processResult = Bun.spawnSync({
    cmd: [
      process.execPath,
      path.join(packageRoot, 'src', 'cli.ts'),
      ...args,
      '--workspace',
      copiedWorkspace,
    ],
    cwd: repoRoot,
    env: process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return {
    stdout: decodeOutput(processResult.stdout),
    stderr: decodeOutput(processResult.stderr),
    exitCode: processResult.exitCode,
  };
}

type EnableWorkspacePackageJson = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  webstir: {
    mode: string;
    enable: {
      search: boolean;
      clientNav: boolean;
      githubPages: boolean;
      s3CloudFront: boolean;
    };
  };
  scripts: {
    deploy: string;
  };
};

async function readJsonFile(filePath: string): Promise<EnableWorkspacePackageJson> {
  return JSON.parse(await readFile(filePath, 'utf8')) as EnableWorkspacePackageJson;
}

// Search and content-nav are imported from the frontend package, script and stylesheet; nothing is
// copied, and a search app that still has the copies 0.2.0 wrote is switched over.
const styledFeatureCases = [
  { feature: 'search', flag: 'search', copies: false },
  { feature: 'content-nav', flag: 'contentNav', copies: false },
  { feature: 'search', flag: 'search', copies: true },
] as const;

for (const { feature, flag, copies } of styledFeatureCases) {
  test(`CLI enables ${feature} from the package${copies ? ' over the copies 0.2.0 wrote' : ''}`, async () => {
    const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-ssg-base-');
    const root = copiedWorkspace.workspaceRoot;
    const app = path.join(root, 'src', 'frontend', 'app');
    if (copies) {
      const fixtures = path.join(packageRoot, 'test-support', 'fixtures', 'search-0.2.0');
      await mkdir(path.join(app, 'scripts', 'features'), { recursive: true });
      await mkdir(path.join(app, 'styles', 'features'), { recursive: true });
      await writeFile(
        path.join(app, 'scripts', 'features', 'search.ts'),
        await readFile(path.join(fixtures, 'search.ts.txt'), 'utf8'),
      );
      await writeFile(
        path.join(app, 'styles', 'features', 'search.css'),
        await readFile(path.join(fixtures, 'search.css.txt'), 'utf8'),
      );
      await writeFile(
        path.join(app, 'app.ts'),
        `${await readFile(path.join(app, 'app.ts'), 'utf8')}import "./scripts/features/search.js";\n`,
      );
      const appCss = await readFile(path.join(app, 'app.css'), 'utf8');
      await writeFile(
        path.join(app, 'app.css'),
        appCss.replace(
          '@import "./styles/components/buttons.css";',
          '@import "./styles/components/buttons.css";\n@import "./styles/features/search.css";',
        ),
      );
    }

    const result = await runEnableInWorkspace(root, [feature]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    const appTs = await readFile(path.join(app, 'app.ts'), 'utf8');
    const appCss = await readFile(path.join(app, 'app.css'), 'utf8');
    expect((await readJsonFile(path.join(root, 'package.json'))).webstir.enable[flag]).toBe(true);
    // The flag alone brings in the feature and its styles; the app imports neither.
    expect(appTs).not.toContain(`features/${feature}`);
    expect(appCss).not.toContain(`features/${feature}.css`);
    expect(appCss).toContain(
      '@layer reset, tokens, base, layout, components, features, utilities, overrides;',
    );
    expect(existsSync(path.join(app, 'scripts', 'features', `${feature}.ts`))).toBe(false);
    expect(existsSync(path.join(app, 'styles', 'features', `${feature}.css`))).toBe(false);
  });
}

// Copies someone edited stay, and stay loaded: an app whose imports of them went missing gets the
// imports back instead of an enabled feature that never runs. A copy that something already loads,
// in whatever form, is left as it is, and a byte order mark stays first.
const SEARCH_CSS = '@import "./styles/features/search.css";';
const keptCopyWiringCases: Array<{
  name: string;
  script: boolean;
  style?: string;
  partial?: boolean;
  bom?: boolean;
  typeOnly?: boolean;
  unusedStylesheet?: boolean;
  appCssImports: number;
}> = [
  { name: 'its script import is gone', script: false, style: SEARCH_CSS, appCssImports: 1 },
  { name: 'its stylesheet import is gone', script: true, appCssImports: 1 },
  { name: 'both imports are gone', script: false, appCssImports: 1 },
  {
    name: 'its stylesheet is imported with a query and a media condition',
    script: true,
    style: '@import "./styles/features/search.css?v=1" print;',
    appCssImports: 1,
  },
  {
    name: 'its stylesheet is imported through another stylesheet',
    script: true,
    style: '@import "./styles/feature-bundle.css";',
    partial: true,
    appCssImports: 0,
  },
  { name: 'app.css starts with a byte order mark', script: true, bom: true, appCssImports: 1 },
  {
    name: 'only an unused stylesheet and a type-only import mention the copies',
    script: false,
    typeOnly: true,
    unusedStylesheet: true,
    appCssImports: 1,
  },
];

for (const {
  name,
  script,
  style,
  partial,
  bom,
  typeOnly,
  unusedStylesheet,
  appCssImports,
} of keptCopyWiringCases) {
  test(`CLI enable search keeps edited copies loaded when ${name}`, async () => {
    const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-kept-copies-');
    const root = copiedWorkspace.workspaceRoot;
    const app = path.join(root, 'src', 'frontend', 'app');
    const fixtures = path.join(packageRoot, 'test-support', 'fixtures', 'search-0.2.0');
    await mkdir(path.join(app, 'scripts', 'features'), { recursive: true });
    await mkdir(path.join(app, 'styles', 'features'), { recursive: true });
    await writeFile(
      path.join(app, 'scripts', 'features', 'search.ts'),
      `${await readFile(path.join(fixtures, 'search.ts.txt'), 'utf8')}\n// local change\n`,
    );
    await writeFile(
      path.join(app, 'styles', 'features', 'search.css'),
      await readFile(path.join(fixtures, 'search.css.txt'), 'utf8'),
    );
    if (partial) {
      await writeFile(
        path.join(app, 'styles', 'feature-bundle.css'),
        '@import "./features/search.css";\n',
      );
    }
    if (script) {
      await writeFile(
        path.join(app, 'app.ts'),
        `${await readFile(path.join(app, 'app.ts'), 'utf8')}import "./scripts/features/search.js";\n`,
      );
    }
    if (typeOnly) {
      await writeFile(
        path.join(app, 'app.ts'),
        `import type {} from "./scripts/features/search.js";\n${await readFile(path.join(app, 'app.ts'), 'utf8')}`,
      );
    }
    if (unusedStylesheet) {
      await writeFile(path.join(app, 'styles', 'unused.css'), '@import "./features/search.css";\n');
    }
    const originalCss = await readFile(path.join(app, 'app.css'), 'utf8');
    const withStyle = style
      ? originalCss.replace(
          '@import "./styles/components/buttons.css";',
          `@import "./styles/components/buttons.css";\n${style}`,
        )
      : originalCss;
    await writeFile(path.join(app, 'app.css'), `${bom ? '\uFEFF' : ''}${withStyle}`);

    try {
      const result = await runEnableInWorkspace(root, ['search']);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toMatch(/Kept the local search copies/);
      const appTs = await readFile(path.join(app, 'app.ts'), 'utf8');
      const appCss = await readFile(path.join(app, 'app.css'), 'utf8');
      expect(
        appTs.match(
          /^import "\.\/scripts\/features\/search\.js";|^import '\.\/scripts\/features\/search\.js';/gm,
        ),
      ).toHaveLength(1);
      expect(appCss.match(/\.\/styles\/features\/search\.css/g) ?? []).toHaveLength(appCssImports);
      if (style) expect(appCss).toContain(style);
      if (bom) expect(appCss.charCodeAt(0)).toBe(0xfeff);
      expect(appTs).not.toContain('@webstir-io/webstir-frontend/features/search');
      const firstRule = appCss.indexOf('{');
      if (firstRule !== -1 && appCssImports > 0) {
        expect(appCss.indexOf('features/search.css')).toBeLessThan(firstRule);
      }
      expect(existsSync(path.join(app, 'scripts', 'features', 'search.ts'))).toBe(true);
      expect(existsSync(path.join(app, 'styles', 'features', 'search.css'))).toBe(true);
    } finally {
      await removeDemoWorkspace(copiedWorkspace);
    }
  });
}

const FEATURES_DIR = ['src', 'frontend', 'app', 'scripts', 'features'] as const;
const PACKAGED_IMPORT = "import '@webstir-io/webstir-frontend/features/client-nav';";

/** The copies Webstir 0.2.0 wrote into apps, kept byte for byte. */
async function shippedClientNavCopies(): Promise<Record<string, string>> {
  const fixtures = path.join(packageRoot, 'test-support', 'fixtures', 'client-nav-0.2.0');
  const copies: Record<string, string> = {};
  for (const name of ['client-nav.ts', 'document-navigation.ts', 'form-enhancement.ts']) {
    copies[name] = await readFile(path.join(fixtures, `${name}.txt`), 'utf8');
  }
  return copies;
}

async function writeLegacyClientNav(
  workspaceRoot: string,
  edit?: (source: string) => string,
  importLine = 'import "./scripts/features/client-nav.js";',
): Promise<void> {
  const dir = path.join(workspaceRoot, ...FEATURES_DIR);
  await mkdir(dir, { recursive: true });
  for (const [name, source] of Object.entries(await shippedClientNavCopies())) {
    await writeFile(path.join(dir, name), name === 'client-nav.ts' && edit ? edit(source) : source);
  }
  const appTs = path.join(workspaceRoot, 'src', 'frontend', 'app', 'app.ts');
  await writeFile(appTs, `${await readFile(appTs, 'utf8')}${importLine}\n`);
}

// Enabling client-nav imports it from the frontend package. Copies Webstir wrote earlier are
// swapped for the import; a copy someone changed is left alone, and a linked one is refused.
const clientNavCases: Array<{
  name: string;
  setup(workspaceRoot: string): Promise<void>;
  exitCode: number;
  imports: 'packaged' | 'legacy';
  copies: boolean;
  stderr?: RegExp;
  /** The app entry the build bundles, when it is not app.ts. */
  entry?: string;
}> = [
  { name: 'a fresh app', setup: async () => {}, exitCode: 0, imports: 'packaged', copies: false },
  {
    name: 'an app whose entry is app.tsx',
    setup: async (root) => {
      await writeLegacyClientNav(root);
      const app = path.join(root, 'src', 'frontend', 'app');
      await writeFile(path.join(app, 'app.tsx'), await readFile(path.join(app, 'app.ts'), 'utf8'));
      await rm(path.join(app, 'app.ts'));
    },
    exitCode: 0,
    imports: 'packaged',
    copies: false,
    entry: 'app.tsx',
  },
  ...(['symbolic', 'hard'] as const).map((kind) => ({
    name: `an app whose app.tsx entry is a ${kind} link`,
    setup: async (root: string) => {
      await writeLegacyClientNav(root);
      const app = path.join(root, 'src', 'frontend', 'app');
      const outside = path.join(os.tmpdir(), `webstir-outside-${process.pid}-${Date.now()}.tsx`);
      await writeFile(outside, await readFile(path.join(app, 'app.ts'), 'utf8'));
      await rm(path.join(app, 'app.ts'));
      await (kind === 'symbolic' ? symlink : link)(outside, path.join(app, 'app.tsx'));
    },
    exitCode: 1,
    imports: 'legacy' as const,
    copies: true,
    stderr: kind === 'symbolic' ? /symbolic link/ : /multiple hard links/,
    entry: 'app.tsx',
  })),
  {
    name: 'an app whose tests import a copy',
    setup: async (root) => {
      await writeLegacyClientNav(root);
      await mkdir(path.join(root, 'tests'), { recursive: true });
      await writeFile(
        path.join(root, 'tests', 'forms.test.ts'),
        "import { buildEnhancedFormRequest } from '../src/frontend/app/scripts/features/form-enhancement.js';\nexport { buildEnhancedFormRequest };\n",
      );
    },
    exitCode: 0,
    imports: 'legacy',
    copies: true,
    stderr: /Kept the local client-nav copies because tests\/forms\.test\.ts still use them/,
  },
  {
    name: 'an app with no entry to import from',
    setup: async (root) => {
      await writeLegacyClientNav(root);
      const app = path.join(root, 'src', 'frontend', 'app');
      await writeFile(
        path.join(app, 'app.backup'),
        await readFile(path.join(app, 'app.ts'), 'utf8'),
      );
      await rm(path.join(app, 'app.ts'));
    },
    exitCode: 0,
    imports: 'packaged',
    copies: false,
  },
  {
    name: 'an app with the copies Webstir shipped',
    setup: (root) => writeLegacyClientNav(root),
    exitCode: 0,
    imports: 'packaged',
    copies: false,
  },
  {
    name: 'an app that edited its copy',
    setup: (root) => writeLegacyClientNav(root, (source) => `${source}\n// local change\n`),
    exitCode: 0,
    imports: 'legacy',
    copies: true,
    stderr:
      /Kept the local client-nav copies because src\/frontend\/app\/scripts\/features\/client-nav\.ts differ/,
  },
  {
    name: 'an app whose copy is a link',
    setup: async (root) => {
      await writeLegacyClientNav(root);
      const copy = path.join(root, ...FEATURES_DIR, 'form-enhancement.ts');
      const outside = path.join(os.tmpdir(), `webstir-outside-${process.pid}-${Date.now()}.ts`);
      await writeFile(outside, await readFile(copy, 'utf8'));
      await rm(copy);
      await symlink(outside, copy);
    },
    exitCode: 1,
    imports: 'legacy',
    copies: true,
  },
  {
    name: 'an app whose copies have Windows line endings',
    setup: async (root) => {
      await writeLegacyClientNav(root);
      for (const name of ['client-nav.ts', 'document-navigation.ts', 'form-enhancement.ts']) {
        const copy = path.join(root, ...FEATURES_DIR, name);
        await writeFile(copy, (await readFile(copy, 'utf8')).replaceAll('\n', '\r\n'));
      }
    },
    exitCode: 0,
    imports: 'packaged',
    copies: false,
  },
  // Type-only imports, re-exports through a path alias and dynamic imports all keep the copies.
  ...[
    [
      'a type-only import',
      "import type { EnhancedFormRequest } from './scripts/features/form-enhancement.js';\n",
    ],
    ['a path alias', "export { buildEnhancedFormRequest } from '@features/form-enhancement';\n"],
    [
      'a dynamic import',
      "export const load = () => import('./scripts/features/document-navigation.js');\n",
    ],
    [
      'an import after a regex that looks like a comment',
      "const slashes = /\\/*/;\nexport { buildEnhancedFormRequest } from './scripts/features/form-enhancement.js';\nexport { slashes };\n",
    ],
  ].map(([what, source]) => ({
    name: `an app where another file has ${what}`,
    setup: async (root: string) => {
      await writeLegacyClientNav(root);
      await writeFile(path.join(root, 'src', 'frontend', 'app', 'other.ts'), source);
    },
    exitCode: 0,
    imports: 'legacy' as const,
    copies: true,
    stderr: /Kept the local client-nav copies because src\/frontend\/app\/other\.ts still use them/,
  })),
  {
    name: 'an app with strings that only look like a copy',
    setup: async (root) => {
      await writeLegacyClientNav(root);
      await writeFile(
        path.join(root, 'src', 'frontend', 'app', 'other.ts'),
        "export const helpLink = '/docs/client-nav';\nexport const event = 'webstir:client-nav';\n",
      );
    },
    exitCode: 0,
    imports: 'packaged',
    copies: false,
  },
  {
    name: 'an app whose import carries a comment',
    setup: (root) =>
      writeLegacyClientNav(
        root,
        undefined,
        "import './scripts/features/client-nav.js'; // navigation",
      ),
    exitCode: 0,
    imports: 'packaged',
    copies: false,
  },
  {
    name: 'an app with another file importing a copy',
    setup: async (root) => {
      await writeLegacyClientNav(root);
      await writeFile(
        path.join(root, 'src', 'frontend', 'app', 'forms.ts'),
        "export { buildEnhancedFormRequest } from './scripts/features/form-enhancement.js';\n",
      );
    },
    exitCode: 0,
    imports: 'legacy',
    copies: true,
    stderr: /Kept the local client-nav copies because src\/frontend\/app\/forms\.ts still use them/,
  },
  {
    name: 'an app whose installed frontend predates the packaged feature',
    setup: async (root) => {
      await writeLegacyClientNav(root);
      // Replace the demo's link to the repo package; writing through it would change the repo.
      const installed = path.join(root, 'node_modules', '@webstir-io', 'webstir-frontend');
      await rm(installed, { force: true, recursive: false }).catch(() => {});
      await mkdir(installed, { recursive: true });
      await writeFile(
        path.join(installed, 'package.json'),
        JSON.stringify({
          name: '@webstir-io/webstir-frontend',
          version: '0.2.0',
          exports: { './runtime': './dist/runtime/index.js', './package.json': './package.json' },
        }),
      );
    },
    exitCode: 1,
    imports: 'legacy',
    copies: true,
    stderr:
      /does not ship '@webstir-io\/webstir-frontend\/features\/client-nav'\. Upgrade it to 0\.3\.0/,
  },
];

for (const scenario of clientNavCases) {
  test(`CLI enables client-nav from the package for ${scenario.name}`, async () => {
    const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-client-nav-');
    const root = copiedWorkspace.workspaceRoot;
    await scenario.setup(root);
    const result = await runEnableInWorkspace(root, ['client-nav']);

    expect(result.exitCode).toBe(scenario.exitCode);
    if (scenario.stderr) expect(result.stderr).toMatch(scenario.stderr);
    const entry = path.join(root, 'src', 'frontend', 'app', scenario.entry ?? 'app.ts');
    const appTs = existsSync(entry) ? await readFile(entry, 'utf8') : '';
    if (scenario.imports === 'packaged') {
      // The flag alone brings in the feature; the app imports neither it nor its old copy.
      expect(appTs).not.toContain(PACKAGED_IMPORT);
      expect(appTs).not.toContain('./scripts/features/client-nav.js');
      expect((await readJsonFile(path.join(root, 'package.json'))).webstir.enable.clientNav).toBe(
        true,
      );
    } else {
      expect(appTs).toContain('./scripts/features/client-nav.js');
      expect(appTs).not.toContain(PACKAGED_IMPORT);
      if (scenario.exitCode !== 0) {
        expect(
          (await readJsonFile(path.join(root, 'package.json'))).webstir.enable?.clientNav,
        ).toBeUndefined();
      }
    }
    for (const name of ['client-nav.ts', 'document-navigation.ts', 'form-enhancement.ts']) {
      expect(existsSync(path.join(root, ...FEATURES_DIR, name))).toBe(scenario.copies);
    }
  });
}

test('CLI enable frontend gives a server-only app pages that build beside its server', async () => {
  const copiedWorkspace = await copyDemoWorkspace('api', 'webstir-enable-frontend-');
  const root = copiedWorkspace.workspaceRoot;

  try {
    expect(readWorkspaceLayers(root)).toEqual({ pages: false, server: true });

    const result = await runEnableInWorkspace(root, ['frontend']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('feature: frontend');
    // The api starter's route at / is now the home page's address.
    expect(result.stdout).toContain('the server answers under /api/*');
    expect(readWorkspaceLayers(root)).toEqual({ pages: true, server: true });
    const packageJson = await readJsonFile(path.join(root, 'package.json'));
    expect(packageJson.dependencies['@webstir-io/webstir-frontend']).toBe('workspace:*');
    expect(packageJson.webstir.enable.clientNav).toBe(true);
    const baseTsconfig = await readJsonFile(path.join(root, 'base.tsconfig.json'));
    expect(baseTsconfig.references).toContainEqual({ path: 'src/frontend' });

    expect(result.stdout).toContain('run `bun install` before building');
    await materializeRepoLocalWorkspaceDependencies(root, { installStdio: 'pipe' });
    const build = await runWorkspaceCli(root, ['build']);
    expect(build.stderr).toBe('');
    expect(build.exitCode).toBe(0);
    expect(existsSync(path.join(root, 'build', 'frontend', 'pages', 'home', 'index.html'))).toBe(
      true,
    );
    expect(existsSync(path.join(root, 'build', 'backend', 'index.js'))).toBe(true);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI enable frontend leaves an app that has pages its own client-nav setting', async () => {
  const copiedWorkspace = await copyDemoWorkspace('full', 'webstir-enable-frontend-has-pages-');
  const packageJsonPath = path.join(copiedWorkspace.workspaceRoot, 'package.json');
  try {
    const packageJson = await readJsonFile(packageJsonPath);
    packageJson.webstir.enable.clientNav = false;
    await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

    const result = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, ['frontend']);

    expect(result.exitCode).toBe(0);
    expect((await readJsonFile(packageJsonPath)).webstir.enable.clientNav).toBe(false);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI enable backend gives a static app with build-time loaders a server and keeps its module', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-backend-static-');
  const modulePath = path.join(copiedWorkspace.workspaceRoot, 'src', 'backend', 'module.ts');
  const moduleSource = 'export const module = { views: [] };\n';

  try {
    await mkdir(path.dirname(modulePath), { recursive: true });
    await writeFile(modulePath, moduleSource, 'utf8');
    expect(readWorkspaceLayers(copiedWorkspace.workspaceRoot)).toEqual({
      pages: true,
      server: false,
    });

    const result = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, ['backend']);

    expect(result.exitCode).toBe(0);
    expect(readWorkspaceLayers(copiedWorkspace.workspaceRoot)).toEqual({
      pages: true,
      server: true,
    });
    expect(await readFile(modulePath, 'utf8')).toBe(moduleSource);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI enable spa stops and points to client-nav without touching the workspace', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-enable-spa-removed-');
  const packageJsonPath = path.join(copiedWorkspace.workspaceRoot, 'package.json');
  const packageJson = await readFile(packageJsonPath, 'utf8');

  try {
    const result = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, ['spa']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Run `webstir enable client-nav`');
    expect(await readFile(packageJsonPath, 'utf8')).toBe(packageJson);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI enables backend on the SPA demo workspace end to end', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-enable-spa-');
  const result = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, ['backend']);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('feature: backend');

  const packageJson = await readJsonFile(path.join(copiedWorkspace.workspaceRoot, 'package.json'));

  expect(packageJson.webstir.mode).toBeUndefined();
  expect(packageJson.webstir.enable?.backend).toBeUndefined();
  expect(packageJson.dependencies['@webstir-io/webstir-backend']).toBe('workspace:*');
  // The same thin server init gives: the backend package carries the runtime.
  expect(packageJson.dependencies.pino).toBeUndefined();
  expect(existsSync(path.join(copiedWorkspace.workspaceRoot, 'src', 'backend', 'index.ts'))).toBe(
    true,
  );
  // The server's compiler settings are the package's; the app has no base config to reference.
  expect(
    JSON.parse(
      await readFile(
        path.join(copiedWorkspace.workspaceRoot, 'src', 'backend', 'tsconfig.json'),
        'utf8',
      ),
    ),
  ).toEqual({ extends: '@webstir-io/webstir-backend/tsconfig.json' });
  expect(existsSync(path.join(copiedWorkspace.workspaceRoot, 'base.tsconfig.json'))).toBe(false);

  const repairResult = await runWorkspaceCli(copiedWorkspace.workspaceRoot, [
    'repair',
    '--dry-run',
    '--json',
  ]);
  const repair = JSON.parse(repairResult.stdout) as {
    changes: string[];
    missingScaffold: string[];
  };
  expect(repairResult.exitCode).toBe(0);
  expect(repairResult.stderr).toBe('');
  // Enable and repair share one server scaffold, so nothing of it counts as missing.
  expect(repair.missingScaffold.filter((file) => file.startsWith('src/backend/'))).toEqual([]);
  expect(repair.changes.some((change) => change.startsWith('src/backend/'))).toBe(false);
});

test('CLI enables gh-deploy with Bun-native deploy scaffolding', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-ssg-base-');
  const result = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, [
    'gh-deploy',
    'demo-site',
  ]);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('feature: gh-deploy');

  const packageJson = await readJsonFile(path.join(copiedWorkspace.workspaceRoot, 'package.json'));
  const frontendConfig = await readJsonFile(
    path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'frontend.config.json'),
  );
  const deployScript = await readFile(
    path.join(copiedWorkspace.workspaceRoot, 'utils', 'deploy-gh-pages.sh'),
    'utf8',
  );
  const workflow = await readFile(
    path.join(copiedWorkspace.workspaceRoot, '.github', 'workflows', 'webstir-gh-pages.yml'),
    'utf8',
  );

  expect(packageJson.webstir.enable.githubPages).toBe(true);
  expect(packageJson.scripts.deploy).toBe('bash ./utils/deploy-gh-pages.sh');
  expect(frontendConfig.publish.basePath).toBe('/demo-site');
  expect(deployScript).toContain(
    'bun "$ROOT_DIR/node_modules/@webstir-io/webstir-frontend/dist/cli.js" build -w "$ROOT_DIR"',
  );
  expect(deployScript).toContain(
    'bun "$ROOT_DIR/node_modules/@webstir-io/webstir-frontend/dist/cli.js" publish -w "$ROOT_DIR"',
  );
  expect(workflow).toContain('uses: oven-sh/setup-bun@v2');
  expect(workflow).toContain('run: bun run deploy');
});

test('CLI enables s3-cloudfront with a deploy script, edge function, and workflow', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-ssg-base-');
  const result = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, ['s3-cloudfront']);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('feature: s3-cloudfront');

  const packageJson = await readJsonFile(path.join(copiedWorkspace.workspaceRoot, 'package.json'));
  const deployScript = await readFile(
    path.join(copiedWorkspace.workspaceRoot, 'utils', 'deploy-s3-cloudfront.sh'),
    'utf8',
  );
  const edgeFunction = await readFile(
    path.join(copiedWorkspace.workspaceRoot, 'utils', 'cloudfront-rewrite-directory-index.js'),
    'utf8',
  );
  const workflow = await readFile(
    path.join(copiedWorkspace.workspaceRoot, '.github', 'workflows', 'webstir-s3-cloudfront.yml'),
    'utf8',
  );

  expect(packageJson.webstir.enable.s3CloudFront).toBe(true);
  expect(packageJson.scripts.deploy).toBe('bash ./utils/deploy-s3-cloudfront.sh');
  expect(deployScript).toContain(
    'bun "$ROOT_DIR/node_modules/@webstir-io/webstir-frontend/dist/cli.js" build -w "$ROOT_DIR"',
  );
  expect(deployScript).toContain(
    'bun "$ROOT_DIR/node_modules/@webstir-io/webstir-frontend/dist/cli.js" publish -w "$ROOT_DIR"',
  );
  expect(deployScript).toContain('--cache-control "$IMMUTABLE_CACHE"');
  expect(deployScript).toContain('--cache-control "$DOCUMENT_CACHE"');
  expect(deployScript).toContain('aws cloudfront create-invalidation');
  expect(edgeFunction).toContain("request.uri = uri + 'index.html';");
  expect(workflow).toContain('uses: aws-actions/configure-aws-credentials@v4');
  expect(workflow).toContain(`S3_BUCKET: \${{ vars.S3_BUCKET }}`);
  expect(workflow).toContain('run: bash ./utils/deploy-s3-cloudfront.sh');
  expect(
    existsSync(path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'frontend.config.json')),
  ).toBe(false);

  const secondRun = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, ['s3-cloudfront']);
  expect(secondRun.exitCode).toBe(0);
  expect(secondRun.stdout).not.toContain('webstir-s3-cloudfront.yml');
});

test('CLI s3-cloudfront keeps an existing deploy command and the workflow still runs its own script', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-ssg-base-');
  const pages = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, ['gh-deploy', 'demo']);
  expect(pages.exitCode).toBe(0);
  const s3 = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, ['s3-cloudfront']);
  expect(s3.exitCode).toBe(0);

  const packageJson = await readJsonFile(path.join(copiedWorkspace.workspaceRoot, 'package.json'));
  const workflow = await readFile(
    path.join(copiedWorkspace.workspaceRoot, '.github', 'workflows', 'webstir-s3-cloudfront.yml'),
    'utf8',
  );

  expect(packageJson.scripts.deploy).toBe('bash ./utils/deploy-gh-pages.sh');
  expect(packageJson.webstir.enable.s3CloudFront).toBe(true);
  expect(workflow).toContain('run: bash ./utils/deploy-s3-cloudfront.sh');
  expect(workflow).not.toContain('bun run deploy');
});

test('generated s3-cloudfront script publishes from a clean checkout and retains bundles by last publish', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-ssg-base-');
  const workspace = copiedWorkspace.workspaceRoot;
  const enable = await runEnableInWorkspace(workspace, ['s3-cloudfront']);
  expect(enable.exitCode).toBe(0);
  await materializeRepoLocalWorkspaceDependencies(workspace, { installStdio: 'pipe' });

  await rm(path.join(workspace, 'build'), { recursive: true, force: true });
  await rm(path.join(workspace, 'dist'), { recursive: true, force: true });
  await rm(path.join(workspace, '.webstir'), { recursive: true, force: true });

  const stubDir = await mkdtemp(path.join(os.tmpdir(), 'webstir-aws-stub-'));
  await mkdir(path.join(stubDir, 'manifests'), { recursive: true });
  // Fake bucket state: MONTHOLD was uploaded long ago but the previous publish still served it.
  await writeFile(
    path.join(stubDir, 'aws'),
    [
      '#!/usr/bin/env bash',
      'printf \'%s\\n\' "$*" >> "$AWS_STUB_LOG"',
      'PREFIX="s3://example-bucket/.webstir-deploys/"',
      'if [[ "$1 $2" == "s3 cp" && "$4" == "$PREFIX"* ]]; then',
      '  cp "$3" "$AWS_STUB_DIR/manifests/$(basename "$4")"',
      'elif [[ "$1 $2" == "s3 cp" && "$3" == "$PREFIX"* && "$4" == "-" ]]; then',
      '  name="$(basename "$3")"',
      '  case "$name" in',
      '    19990101T000000Z.txt) echo "app/app-ANCIENT0.js" ;;',
      '    20000101T000000Z.txt) echo "app/app-MONTHOLD.js" ;;',
      '    29990101T000000Z.txt) echo "home/index-NEWNEW01.js" ;;',
      '    *) cat "$AWS_STUB_DIR/manifests/$name" ;;',
      '  esac',
      'elif [[ "$1 $2" == "s3 ls" && "$3" == "$PREFIX" ]]; then',
      '  if [[ "$AWS_STUB_HISTORY" == "busy" ]]; then',
      '    echo "1999-01-01 00:00:00     100 19990101T000000Z.txt"',
      '    echo "2000-01-01 00:00:00     100 20000101T000000Z.txt"',
      '    echo "2999-01-01 00:00:00     100 29990101T000000Z.txt"',
      '  elif [[ "$AWS_STUB_HISTORY" == "quiet" ]]; then',
      '    echo "2000-01-01 00:00:00     100 20000101T000000Z.txt"',
      '  fi',
      '  for f in "$AWS_STUB_DIR"/manifests/*; do echo "2999-01-01 00:00:00     100 $(basename "$f")"; done',
      'elif [[ "$1 $2" == "s3 ls" && "$4" == "--recursive" ]]; then',
      '  echo "1999-01-01 00:00:00     100 app/app-ANCIENT0.js"',
      '  echo "2000-01-01 00:00:00     100 app/app-MONTHOLD.js"',
      '  echo "2000-01-01 00:00:00     100 app/app-OLDOLD01.js"',
      '  echo "2999-01-01 00:00:00     100 home/index-NEWNEW01.js"',
      '  echo "2000-01-01 00:00:00     100 index.html"',
      '  (cd "$DIST_DIR" && find . -name "*-????????.js" -o -name "*-????????.css" | sed "s|^\\./|2000-01-01 00:00:00     100 |")',
      'fi',
      '',
    ].join('\n'),
    { encoding: 'utf8', mode: 0o755 },
  );

  async function runDeploy(history: 'busy' | 'quiet' | 'no'): Promise<string[]> {
    const callLog = path.join(stubDir, `calls-${history}.log`);
    await rm(path.join(stubDir, 'manifests'), { recursive: true, force: true });
    await mkdir(path.join(stubDir, 'manifests'), { recursive: true });
    const run = Bun.spawnSync({
      cmd: ['bash', path.join(workspace, 'utils', 'deploy-s3-cloudfront.sh')],
      cwd: workspace,
      env: {
        ...process.env,
        PATH: `${stubDir}:${process.env.PATH ?? ''}`,
        AWS_STUB_LOG: callLog,
        AWS_STUB_DIR: stubDir,
        AWS_STUB_HISTORY: history,
        DIST_DIR: path.join(workspace, 'dist', 'frontend'),
        S3_BUCKET: 'example-bucket',
        CLOUDFRONT_DISTRIBUTION_ID: 'EXAMPLE',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = decodeOutput(run.stdout);
    const stderr = decodeOutput(run.stderr);
    expect(run.exitCode, `stdout:\n${stdout}\nstderr:\n${stderr}`).toBe(0);
    return (await readFile(callLog, 'utf8')).trim().split('\n');
  }

  const calls = await runDeploy('busy');
  expect(existsSync(path.join(workspace, 'dist', 'frontend', 'index.html'))).toBe(true);

  const syncs = calls.filter((call) => call.startsWith('s3 sync '));
  expect(syncs).toHaveLength(2);
  expect(syncs[0]).not.toContain('--delete');
  expect(syncs[0]).toContain('--include *-????????.js');
  expect(syncs[1]).toContain('--delete');
  expect(syncs[1]).toContain('--exclude *-????????.js');
  expect(syncs[1]).toContain('--exclude .webstir-deploys/*');

  const headIndex = calls.findIndex((call) => call.startsWith('s3api head-object'));
  const manifestIndex = calls.findIndex((call) =>
    /^s3 cp \S+ s3:\/\/example-bucket\/\.webstir-deploys\/\d{8}T\d{6}Z\.txt/.test(call),
  );
  const invalidateIndex = calls.findIndex((call) =>
    call.startsWith('cloudfront create-invalidation'),
  );
  expect(headIndex).toBeGreaterThan(calls.indexOf(syncs[1] ?? ''));
  expect(manifestIndex).toBeGreaterThan(headIndex);
  expect(invalidateIndex).toBeGreaterThan(manifestIndex);
  expect(calls[invalidateIndex]).toContain('--distribution-id EXAMPLE');

  const removals = calls.filter((call) => call.startsWith('s3 rm ')).sort();
  // Busy history: 1999 and 2000 both predate the cutoff, but the 2000 release was the
  // one live when the window began, so it and its bundle stay. Only the release it
  // replaced (1999) and bundles no active release referenced are removed.
  expect(removals).toEqual([
    's3 rm s3://example-bucket/.webstir-deploys/19990101T000000Z.txt',
    's3 rm s3://example-bucket/app/app-ANCIENT0.js',
    's3 rm s3://example-bucket/app/app-OLDOLD01.js',
  ]);
  expect(calls.findIndex((call) => call.startsWith('s3 rm '))).toBeGreaterThan(invalidateIndex);

  // Quiet period: one release published long before the cutoff and live until this
  // deploy. Its manifest and bundle must survive; only unreferenced bundles go.
  const quiet = await runDeploy('quiet');
  expect(quiet.filter((call) => call.startsWith('s3 rm ')).sort()).toEqual([
    's3 rm s3://example-bucket/app/app-ANCIENT0.js',
    's3 rm s3://example-bucket/app/app-OLDOLD01.js',
    's3 rm s3://example-bucket/home/index-NEWNEW01.js',
  ]);

  // With no publish history, nothing is ever removed.
  const firstRun = await runDeploy('no');
  expect(firstRun.some((call) => call.startsWith('s3 rm '))).toBe(false);

  await rm(stubDir, { recursive: true, force: true });
}, 120_000);

test('CLI enables page scripts once and rejects duplicate scaffold attempts', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-ssg-base-');
  const firstRun = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, [
    'scripts',
    '  home  ',
  ]);

  expect(firstRun.exitCode).toBe(0);
  expect(firstRun.stderr).toBe('');
  expect(
    existsSync(
      path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'pages', 'home', 'index.ts'),
    ),
  ).toBe(true);

  const secondRun = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, ['scripts', 'home']);
  expect(secondRun.exitCode).toBe(1);
  expect(secondRun.stderr).toContain('already has an index.ts script');
});

test('CLI rejects unsafe page script names without touching the workspace or outside files', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-scripts-safe-');
  const externalRoot = await mkdtemp(path.join(os.tmpdir(), 'webstir-enable-scripts-outside-'));
  const packageJsonPath = path.join(copiedWorkspace.workspaceRoot, 'package.json');
  const sentinelPath = path.join(externalRoot, 'sentinel.txt');
  const pagesRoot = path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'pages');
  const packageJson = await readFile(packageJsonPath, 'utf8');
  await writeFile(sentinelPath, 'outside-sentinel', 'utf8');

  try {
    const traversalName = path.relative(pagesRoot, externalRoot).split(path.sep).join('/');
    for (const pageName of [
      traversalName,
      traversalName.replaceAll('/', '\\'),
      '.',
      '..',
      'bad\nname',
      'home\n',
      '\thome',
      'foo:bar',
      'NUL',
      'COM¹.txt',
    ]) {
      const result = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, [
        'scripts',
        pageName,
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Invalid page name');
    }

    expect(await readFile(packageJsonPath, 'utf8')).toBe(packageJson);
    expect(await readFile(sentinelPath, 'utf8')).toBe('outside-sentinel');
    expect(existsSync(path.join(externalRoot, 'index.ts'))).toBe(false);
    expect(
      existsSync(
        path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'pages', 'home', 'index.ts'),
      ),
    ).toBe(false);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
    await rm(externalRoot, { recursive: true, force: true });
  }
});

test('CLI rejects symlinked page script ancestors and targets without following them', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-scripts-symlink-');
  const externalRoot = await mkdtemp(
    path.join(os.tmpdir(), 'webstir-enable-scripts-symlink-outside-'),
  );
  const packageJsonPath = path.join(copiedWorkspace.workspaceRoot, 'package.json');
  const packageJson = await readFile(packageJsonPath, 'utf8');
  const sentinelPath = path.join(externalRoot, 'sentinel.txt');
  const linkedTargetPath = path.join(externalRoot, 'linked-index.ts');
  await writeFile(sentinelPath, 'outside-sentinel', 'utf8');
  await writeFile(linkedTargetPath, 'target-sentinel', 'utf8');

  try {
    const pagesRoot = path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'pages');
    const linkedPagePath = path.join(pagesRoot, 'linked-page');
    await symlink(externalRoot, linkedPagePath, 'dir');

    const ancestorResult = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, [
      'scripts',
      'linked-page',
    ]);
    expect(ancestorResult.exitCode).toBe(1);
    expect(ancestorResult.stderr).toContain('symbolic link');
    expect(existsSync(path.join(externalRoot, 'index.ts'))).toBe(false);

    const homeRoot = path.join(pagesRoot, 'home');
    await mkdir(homeRoot, { recursive: true });
    await symlink(linkedTargetPath, path.join(homeRoot, 'index.ts'), 'file');

    const targetResult = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, [
      'scripts',
      'home',
    ]);
    expect(targetResult.exitCode).toBe(1);
    expect(targetResult.stderr).toContain('symbolic link');

    expect(await readFile(packageJsonPath, 'utf8')).toBe(packageJson);
    expect(await readFile(sentinelPath, 'utf8')).toBe('outside-sentinel');
    expect(await readFile(linkedTargetPath, 'utf8')).toBe('target-sentinel');
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
    await rm(externalRoot, { recursive: true, force: true });
  }
});

test('CLI enable backend rejects a symlinked scaffold ancestor before external writes', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-enable-backend-symlink-');
  const externalRoot = await mkdtemp(
    path.join(os.tmpdir(), 'webstir-enable-backend-symlink-outside-'),
  );
  const packageJsonPath = path.join(copiedWorkspace.workspaceRoot, 'package.json');
  const packageJson = await readFile(packageJsonPath, 'utf8');
  const sentinelPath = path.join(externalRoot, 'sentinel.txt');
  await writeFile(sentinelPath, 'outside-sentinel', 'utf8');
  // The linked src still holds the app's pages.
  await mkdir(path.join(externalRoot, 'frontend'), { recursive: true });

  try {
    await rm(path.join(copiedWorkspace.workspaceRoot, 'src'), { recursive: true, force: true });
    await symlink(externalRoot, path.join(copiedWorkspace.workspaceRoot, 'src'), 'dir');

    const result = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, ['backend']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('symbolic link');
    expect(await readFile(packageJsonPath, 'utf8')).toBe(packageJson);
    expect(await readFile(sentinelPath, 'utf8')).toBe('outside-sentinel');
    expect(existsSync(path.join(externalRoot, 'backend', 'index.ts'))).toBe(false);
    expect(existsSync(path.join(externalRoot, 'backend', 'env.ts'))).toBe(false);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
    await rm(externalRoot, { recursive: true, force: true });
  }
});

test('CLI enable search rejects symlinked overwrite targets before changing any asset', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-search-symlink-');
  const externalRoot = await mkdtemp(
    path.join(os.tmpdir(), 'webstir-enable-search-symlink-outside-'),
  );
  const externalStyles = path.join(externalRoot, 'styles');
  const externalStyle = path.join(externalStyles, 'search.css');
  const packageJsonPath = path.join(copiedWorkspace.workspaceRoot, 'package.json');
  const appRoot = path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'app');
  const appTsPath = path.join(appRoot, 'app.ts');
  const appCssPath = path.join(appRoot, 'app.css');
  const appHtmlPath = path.join(appRoot, 'app.html');
  const before = {
    packageJson: await readFile(packageJsonPath, 'utf8'),
    appTs: await readFile(appTsPath, 'utf8'),
    appCss: await readFile(appCssPath, 'utf8'),
    appHtml: await readFile(appHtmlPath, 'utf8'),
  };

  await mkdir(externalStyles, { recursive: true });
  await writeFile(externalStyle, 'style-sentinel', 'utf8');

  try {
    const stylesTarget = path.join(appRoot, 'styles', 'features');
    await rm(stylesTarget, { recursive: true, force: true });
    await symlink(externalStyles, stylesTarget, 'dir');

    const result = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, ['search']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('symbolic link');
    expect(existsSync(path.join(appRoot, 'scripts', 'features', 'search.ts'))).toBe(false);
    expect(await readFile(externalStyle, 'utf8')).toBe('style-sentinel');
    expect(await readFile(packageJsonPath, 'utf8')).toBe(before.packageJson);
    expect(await readFile(appTsPath, 'utf8')).toBe(before.appTs);
    expect(await readFile(appCssPath, 'utf8')).toBe(before.appCss);
    expect(await readFile(appHtmlPath, 'utf8')).toBe(before.appHtml);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
    await rm(externalRoot, { recursive: true, force: true });
  }
});

test('CLI enable search rejects hard-linked overwrite targets before changing any asset', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-search-hardlink-');
  const externalRoot = await mkdtemp(
    path.join(os.tmpdir(), 'webstir-enable-search-hardlink-outside-'),
  );
  const externalStyle = path.join(externalRoot, 'search.css');
  const packageJsonPath = path.join(copiedWorkspace.workspaceRoot, 'package.json');
  const appRoot = path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'app');
  const appTsPath = path.join(appRoot, 'app.ts');
  const appCssPath = path.join(appRoot, 'app.css');
  const appHtmlPath = path.join(appRoot, 'app.html');
  const targetStyle = path.join(appRoot, 'styles', 'features', 'search.css');
  const before = {
    packageJson: await readFile(packageJsonPath, 'utf8'),
    appTs: await readFile(appTsPath, 'utf8'),
    appCss: await readFile(appCssPath, 'utf8'),
    appHtml: await readFile(appHtmlPath, 'utf8'),
  };

  try {
    await writeFile(externalStyle, 'hard-link-sentinel', 'utf8');
    await mkdir(path.dirname(targetStyle), { recursive: true });
    await rm(targetStyle, { force: true });
    await link(externalStyle, targetStyle);

    const result = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, ['search']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('multiple hard links');
    expect(existsSync(path.join(appRoot, 'scripts', 'features', 'search.ts'))).toBe(false);
    expect(await readFile(externalStyle, 'utf8')).toBe('hard-link-sentinel');
    expect(await readFile(packageJsonPath, 'utf8')).toBe(before.packageJson);
    expect(await readFile(appTsPath, 'utf8')).toBe(before.appTs);
    expect(await readFile(appCssPath, 'utf8')).toBe(before.appCss);
    expect(await readFile(appHtmlPath, 'utf8')).toBe(before.appHtml);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
    await rm(externalRoot, { recursive: true, force: true });
  }
});
