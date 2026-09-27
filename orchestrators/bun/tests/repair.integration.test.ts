import { expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { packageRoot, repoRoot } from '../src/paths.ts';
import { copyDemoWorkspace, removeDemoWorkspace } from '../test-support/demo-workspace.ts';

function decodeOutput(buffer: Uint8Array | undefined): string {
  return new TextDecoder().decode(buffer ?? new Uint8Array());
}

async function runCli(args: readonly string[]): Promise<{
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}> {
  const processResult = Bun.spawnSync({
    cmd: [process.execPath, path.join(packageRoot, 'src', 'cli.ts'), ...args],
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

// Files a mature full-mode app removes when it moves to server-rendered views. Nothing it keeps
// names them, so repair must leave them absent.
const REMOVED_BY_MATURE_APP = [
  'Errors.404.html',
  'Errors.500.html',
  'Errors.default.html',
  'types.global.d.ts',
  'types/global.d.ts',
  'src/frontend/app/error.ts',
  'src/frontend/app/hmr.js',
  'src/frontend/app/refresh.js',
  'src/frontend/app/navigation.ts',
  'src/frontend/app/router.ts',
  'src/frontend/app/styles/base.css',
  'src/frontend/pages/lifecycle/index.html',
  'src/frontend/pages/lifecycle/index.ts',
  'src/shared/router-types.ts',
  'src/shared/tsconfig.json',
  'src/shared/types/index.ts',
];

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

// The shape of a real app: its own instructions, project references in tsconfig.json,
// base.tsconfig.json only shared compiler options, no src/shared, and an app shell that loads no
// dev runtime scripts.
async function matureFullApp(root: string): Promise<void> {
  await writeFile(path.join(root, 'AGENTS.md'), '# App instructions\n', 'utf8');
  for (const relative of REMOVED_BY_MATURE_APP) {
    await rm(path.join(root, relative), { force: true });
  }
  const app = path.join(root, 'src', 'frontend', 'app');
  await writeFile(
    path.join(app, 'app.ts'),
    "import '@webstir-io/webstir-frontend/features/client-nav';\n",
    'utf8',
  );
  const shell = await readFile(path.join(app, 'app.html'), 'utf8');
  await writeFile(
    path.join(app, 'app.html'),
    shell.replace(/\s*<script[^>]*src="\/(?:hmr|refresh)\.js"[^>]*><\/script>/g, ''),
    'utf8',
  );
  const basePath = path.join(root, 'base.tsconfig.json');
  const base = JSON.parse(await readFile(basePath, 'utf8')) as Record<string, unknown>;
  delete base.files;
  delete base.references;
  await writeJson(basePath, base);
  await writeJson(path.join(root, 'tsconfig.json'), {
    files: [],
    references: [{ path: 'src/frontend' }, { path: 'src/backend' }],
  });
  const frontendPath = path.join(root, 'src', 'frontend', 'tsconfig.json');
  const frontend = JSON.parse(await readFile(frontendPath, 'utf8')) as {
    compilerOptions: Record<string, unknown>;
    references?: unknown;
  };
  delete frontend.compilerOptions.paths;
  frontend.references = [];
  await writeJson(frontendPath, frontend);
}

const templateRoot = path.join(packageRoot, 'assets', 'templates', 'full');

test.each([
  {
    name: 'a mature app missing optional scaffold files is left alone',
    prepare: async () => {},
    restored: [],
  },
  {
    name: 'an optional scaffold folder the app links elsewhere is neither checked nor written',
    prepare: async (root: string) => {
      const outside = path.join(path.dirname(root), 'outside-shared');
      await mkdir(outside, { recursive: true });
      await rm(path.join(root, 'src', 'shared'), { recursive: true, force: true });
      await symlink(outside, path.join(root, 'src', 'shared'), 'dir');
    },
    restored: [],
  },
  {
    name: 'a module the app entry still imports',
    prepare: async (root: string) => {
      await writeFile(
        path.join(root, 'src', 'frontend', 'app', 'app.ts'),
        "import '@webstir-io/webstir-frontend/features/client-nav';\nvoid import('./error');\n",
        'utf8',
      );
    },
    restored: ['src/frontend/app/error.ts'],
  },
  {
    name: 'the modules a restored file imports, through the @shared alias',
    prepare: async (root: string) => {
      const pagePath = path.join(root, 'src', 'frontend', 'pages', 'home', 'index.ts');
      await writeFile(
        pagePath,
        `import '../../app/navigation.js';\n${await readFile(pagePath, 'utf8')}`,
        'utf8',
      );
    },
    restored: [
      'src/frontend/app/navigation.ts',
      'src/frontend/app/router.ts',
      'src/shared/router-types.ts',
    ],
  },
  {
    name: 'a stylesheet app.css still imports',
    prepare: async (root: string) => {
      const cssPath = path.join(root, 'src', 'frontend', 'app', 'app.css');
      await writeFile(
        cssPath,
        `@import "./styles/base.css";\n${await readFile(cssPath, 'utf8')}`,
        'utf8',
      );
    },
    restored: ['src/frontend/app/styles/base.css'],
  },
  {
    name: 'a dev runtime script the app shell still loads',
    prepare: async (root: string) => {
      await writeFile(
        path.join(root, 'src', 'frontend', 'app', 'app.html'),
        await readFile(path.join(templateRoot, 'src', 'frontend', 'app', 'app.html'), 'utf8'),
        'utf8',
      );
    },
    restored: ['src/frontend/app/hmr.js', 'src/frontend/app/refresh.js'],
  },
  {
    name: 'a project tsconfig still references',
    prepare: async (root: string) => {
      await writeJson(path.join(root, 'tsconfig.json'), {
        files: [],
        references: [{ path: 'src/shared' }, { path: 'src/frontend' }, { path: 'src/backend' }],
      });
    },
    restored: ['src/shared/tsconfig.json'],
  },
  {
    name: 'the app shell every frontend build reads',
    prepare: async (root: string) => {
      await rm(path.join(root, 'src', 'frontend', 'app', 'app.html'));
    },
    restored: [
      'src/frontend/app/app.html',
      'src/frontend/app/hmr.js',
      'src/frontend/app/refresh.js',
    ],
  },
  {
    name: 'the app entry an enabled feature is imported from, with what it imports',
    prepare: async (root: string) => {
      await rm(path.join(root, 'src', 'frontend', 'app', 'app.ts'));
    },
    restored: ['src/frontend/app/app.ts', 'src/frontend/app/error.ts'],
  },
  {
    name: 'the backend entry',
    prepare: async (root: string) => {
      await rm(path.join(root, 'src', 'backend', 'index.ts'));
    },
    restored: ['src/backend/index.ts'],
  },
])(
  'CLI repair restores only what a workspace still needs: $name',
  async ({ prepare, restored }) => {
    const copiedWorkspace = await copyDemoWorkspace('full', 'webstir-repair-needed-', {
      workspaceName: 'full',
    });
    const root = copiedWorkspace.workspaceRoot;
    try {
      await matureFullApp(root);
      await prepare(root);

      const result = await runCli(['repair', '--json', '--workspace', root]);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as { changes: string[] };
      expect(parsed.changes).toEqual(
        [...restored].sort((left, right) => left.localeCompare(right)),
      );
      for (const relative of restored) {
        expect(existsSync(path.join(root, relative))).toBe(true);
      }
      for (const relative of REMOVED_BY_MATURE_APP.filter((file) => !restored.includes(file))) {
        expect(existsSync(path.join(root, relative))).toBe(false);
      }

      const again = await runCli(['repair', '--dry-run', '--json', '--workspace', root]);
      expect((JSON.parse(again.stdout) as { changes: string[] }).changes).toEqual([]);
    } finally {
      await removeDemoWorkspace(copiedWorkspace);
    }
  },
);

test('CLI repair supports dry-run without restoring files', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-repair-spa-', {
    workspaceName: 'spa',
  });

  try {
    const missingFile = path.join(
      copiedWorkspace.workspaceRoot,
      'src',
      'frontend',
      'app',
      'app.html',
    );
    await rm(missingFile, { force: true });

    const result = await runCli([
      'repair',
      '--dry-run',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('dry-run: true');
    expect(result.stdout).toContain('src/frontend/app/app.html');
    expect(existsSync(missingFile)).toBe(false);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI repair swaps the client-nav copies Webstir shipped for the package import', async () => {
  const copiedWorkspace = await copyDemoWorkspace('full', 'webstir-repair-client-nav-', {
    workspaceName: 'full',
  });
  const root = copiedWorkspace.workspaceRoot;
  try {
    // The app resolves the frontend package the way an installed app would; the demo's own
    // relative link breaks once the demo is copied elsewhere.
    const installed = path.join(root, 'node_modules', '@webstir-io');
    await mkdir(installed, { recursive: true });
    await rm(path.join(installed, 'webstir-frontend'), { force: true });
    await symlink(
      path.join(repoRoot, 'packages', 'tooling', 'webstir-frontend'),
      path.join(installed, 'webstir-frontend'),
      'dir',
    );
    // The copies Webstir 0.2.0 wrote into apps, kept byte for byte.
    const fixtures = path.join(packageRoot, 'test-support', 'fixtures', 'client-nav-0.2.0');
    const features = path.join(root, 'src', 'frontend', 'app', 'scripts', 'features');
    await Bun.write(path.join(features, '.keep'), '');
    for (const name of ['client-nav.ts', 'document-navigation.ts', 'form-enhancement.ts']) {
      await writeFile(
        path.join(features, name),
        await readFile(path.join(fixtures, `${name}.txt`), 'utf8'),
      );
    }
    const appTsPath = path.join(root, 'src', 'frontend', 'app', 'app.ts');
    const appTs = await readFile(appTsPath, 'utf8');
    await writeFile(
      appTsPath,
      appTs.replace(
        "import '@webstir-io/webstir-frontend/features/client-nav';",
        "import './scripts/features/client-nav.js';",
      ),
    );

    // A dry run reports the switch without touching anything.
    const dryRun = await runCli(['repair', '--dry-run', '--workspace', root]);
    expect(dryRun.exitCode).toBe(0);
    expect(dryRun.stdout).toContain('src/frontend/app/scripts/features/client-nav.ts');
    for (const name of ['client-nav.ts', 'document-navigation.ts', 'form-enhancement.ts']) {
      expect(existsSync(path.join(features, name))).toBe(true);
    }
    expect(await readFile(appTsPath, 'utf8')).toContain(
      "import './scripts/features/client-nav.js';",
    );

    const result = await runCli(['repair', '--workspace', root]);

    expect(result.exitCode).toBe(0);
    for (const name of ['client-nav.ts', 'document-navigation.ts', 'form-enhancement.ts']) {
      expect(existsSync(path.join(features, name))).toBe(false);
    }
    const repaired = await readFile(appTsPath, 'utf8');
    expect(repaired).toContain("import '@webstir-io/webstir-frontend/features/client-nav';");
    expect(repaired).not.toContain('./scripts/features/client-nav.js');
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI repair restores enabled feature imports and wiring for the SSG site demo', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/site', 'webstir-repair-ssg-site-', {
    workspaceName: 'site',
  });

  try {
    const root = copiedWorkspace.workspaceRoot;
    // The demo's own link to the frontend package breaks once it is copied elsewhere.
    const installed = path.join(root, 'node_modules', '@webstir-io');
    await mkdir(installed, { recursive: true });
    await rm(path.join(installed, 'webstir-frontend'), { force: true });
    await symlink(
      path.join(repoRoot, 'packages', 'tooling', 'webstir-frontend'),
      path.join(installed, 'webstir-frontend'),
      'dir',
    );
    const deployScript = path.join(root, 'utils', 'deploy-gh-pages.sh');
    const appTsPath = path.join(root, 'src', 'frontend', 'app', 'app.ts');
    const appCssPath = path.join(root, 'src', 'frontend', 'app', 'app.css');
    const searchScript = "import '@webstir-io/webstir-frontend/features/search';\n";
    const searchStyles = '@import "@webstir-io/webstir-frontend/features/search.css";\n';

    await rm(deployScript, { force: true });
    await writeFile(
      appTsPath,
      (await readFile(appTsPath, 'utf8')).replace(searchScript, ''),
      'utf8',
    );
    await writeFile(
      appCssPath,
      (await readFile(appCssPath, 'utf8')).replace(searchStyles, ''),
      'utf8',
    );

    const result = await runCli(['repair', '--workspace', root]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('utils/deploy-gh-pages.sh');
    expect(existsSync(deployScript)).toBe(true);
    expect(await readFile(appTsPath, 'utf8')).toContain(searchScript.trim());
    expect(await readFile(appCssPath, 'utf8')).toContain(searchStyles.trim());
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

const fixturesRoot = path.join(packageRoot, 'test-support', 'fixtures');

async function prepareHotModuleWorkspace(
  prefix: string,
  files: { readonly app?: string; readonly client?: string },
): Promise<{
  readonly workspace: Awaited<ReturnType<typeof copyDemoWorkspace>>;
  readonly appTsPath: string;
  readonly clientPath: string;
  readonly currentClient: string;
}> {
  const workspace = await copyDemoWorkspace('ssg/site', prefix, { workspaceName: 'site' });
  const appDir = path.join(workspace.workspaceRoot, 'src', 'frontend', 'app');
  const appTsPath = path.join(appDir, 'app.ts');
  const clientPath = path.join(appDir, 'hmr.js');
  const currentClient = await readFile(clientPath, 'utf8');
  if (files.app !== undefined) {
    await writeFile(appTsPath, files.app, 'utf8');
  }
  if (files.client !== undefined) {
    await writeFile(clientPath, files.client, 'utf8');
  }
  return { workspace, appTsPath, clientPath, currentClient };
}

test('CLI repair replaces the scaffold hot-module registry in app.ts when the client is current', async () => {
  const legacy = await readFile(path.join(fixturesRoot, 'legacy-hot-module-app.ts.txt'), 'utf8');
  const prepared = await prepareHotModuleWorkspace('webstir-repair-hot-module-', { app: legacy });

  try {
    const dryRun = await runCli([
      'repair',
      '--workspace',
      prepared.workspace.workspaceRoot,
      '--dry-run',
    ]);
    expect(dryRun.exitCode).toBe(0);
    expect(dryRun.stdout).toContain('src/frontend/app/app.ts');
    expect(await readFile(prepared.appTsPath, 'utf8')).toBe(legacy);

    const result = await runCli(['repair', '--workspace', prepared.workspace.workspaceRoot]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('  - src/frontend/app/app.ts');
    expect(result.stdout).not.toContain('  - src/frontend/app/hmr.js');
    expect(result.stdout).not.toContain('note:');

    const updated = await readFile(prepared.appTsPath, 'utf8');
    expect(updated).toContain('export function registerHotModule(');
    expect(updated).toContain('window.__webstirHotModules ??= []');
    expect(updated).not.toContain('__webstirDispose');
    expect(updated).toContain('export { loadErrorHandler };');
    expect(await readFile(prepared.clientPath, 'utf8')).toBe(prepared.currentClient);

    const again = await runCli(['repair', '--workspace', prepared.workspace.workspaceRoot]);
    expect(again.stdout).not.toContain('src/frontend/app/app.ts');
  } finally {
    await removeDemoWorkspace(prepared.workspace);
  }
});

test('CLI repair moves a scaffold app.ts and a scaffold hmr.js forward together', async () => {
  const legacyApp = await readFile(path.join(fixturesRoot, 'legacy-hot-module-app.ts.txt'), 'utf8');
  const legacyClient = await readFile(
    path.join(fixturesRoot, 'legacy-hmr-client-ssg.js.txt'),
    'utf8',
  );
  const prepared = await prepareHotModuleWorkspace('webstir-repair-hot-module-pair-', {
    app: legacyApp,
    client: legacyClient,
  });

  try {
    const result = await runCli(['repair', '--workspace', prepared.workspace.workspaceRoot]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('src/frontend/app/app.ts');
    expect(result.stdout).toContain('src/frontend/app/hmr.js');
    expect(result.stdout).not.toContain('note:');
    expect(await readFile(prepared.clientPath, 'utf8')).toBe(prepared.currentClient);
    expect(await readFile(prepared.appTsPath, 'utf8')).toContain(
      'window.__webstirHotModules ??= []',
    );
  } finally {
    await removeDemoWorkspace(prepared.workspace);
  }
});

test('CLI repair refreshes a scaffold hmr.js left behind by a newer app.ts', async () => {
  const legacyClient = await readFile(
    path.join(fixturesRoot, 'legacy-hmr-client-spa.js.txt'),
    'utf8',
  );
  const prepared = await prepareHotModuleWorkspace('webstir-repair-hot-module-client-', {
    client: legacyClient,
  });

  try {
    const result = await runCli(['repair', '--workspace', prepared.workspace.workspaceRoot]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('src/frontend/app/hmr.js');
    expect(result.stdout).not.toContain('note:');
    expect(await readFile(prepared.clientPath, 'utf8')).toBe(prepared.currentClient);
  } finally {
    await removeDemoWorkspace(prepared.workspace);
  }
});

test('CLI repair leaves a scaffold app.ts and a customized hmr.js both unchanged, with a note', async () => {
  const legacyApp = await readFile(path.join(fixturesRoot, 'legacy-hot-module-app.ts.txt'), 'utf8');
  const customClient = `${await readFile(path.join(fixturesRoot, 'legacy-hmr-client-ssg.js.txt'), 'utf8')}\nconsole.log('mine');\n`;
  const prepared = await prepareHotModuleWorkspace('webstir-repair-hot-module-custom-client-', {
    app: legacyApp,
    client: customClient,
  });

  try {
    const result = await runCli(['repair', '--workspace', prepared.workspace.workspaceRoot]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      'note: src/frontend/app/app.ts still installs the old hot-update hooks, and src/frontend/app/hmr.js is customized',
    );
    expect(await readFile(prepared.clientPath, 'utf8')).toBe(customClient);
    const app = await readFile(prepared.appTsPath, 'utf8');
    expect(app).toContain('window.__webstirDispose = async');
    expect(app).not.toContain('window.__webstirHotModules ??= []');
  } finally {
    await removeDemoWorkspace(prepared.workspace);
  }
});

test('CLI repair keeps a scaffold hmr.js under an app.ts that still installs the old hooks', async () => {
  const legacy = await readFile(path.join(fixturesRoot, 'legacy-hot-module-app.ts.txt'), 'utf8');
  const partial = legacy.replace('window.__webstirRegisterHotModule = registerHotModule;\n', '');
  expect(partial).not.toBe(legacy);
  const legacyClient = await readFile(
    path.join(fixturesRoot, 'legacy-hmr-client-ssg.js.txt'),
    'utf8',
  );
  const prepared = await prepareHotModuleWorkspace('webstir-repair-hot-module-partial-', {
    app: partial,
    client: legacyClient,
  });

  try {
    const result = await runCli(['repair', '--workspace', prepared.workspace.workspaceRoot]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      'note: src/frontend/app/app.ts still installs the old hot-update hooks',
    );
    expect(result.stdout).not.toContain('  - src/frontend/app/hmr.js');
    expect(await readFile(prepared.clientPath, 'utf8')).toBe(legacyClient);
    expect(await readFile(prepared.appTsPath, 'utf8')).toContain('window.__webstirDispose = async');
  } finally {
    await removeDemoWorkspace(prepared.workspace);
  }
});

test('CLI repair reports a customized hot-module registry instead of rewriting it', async () => {
  const legacy = await readFile(path.join(fixturesRoot, 'legacy-hot-module-app.ts.txt'), 'utf8');
  const customized = legacy.replace(
    '  try {\n    const result = record.dispose(contextWithHistory);',
    "  try {\n    console.debug('disposing', moduleId);\n    const result = record.dispose(contextWithHistory);",
  );
  expect(customized).not.toBe(legacy);
  const legacyClient = await readFile(
    path.join(fixturesRoot, 'legacy-hmr-client-ssg.js.txt'),
    'utf8',
  );
  const prepared = await prepareHotModuleWorkspace('webstir-repair-hot-module-custom-app-', {
    app: customized,
    client: legacyClient,
  });

  try {
    const result = await runCli(['repair', '--workspace', prepared.workspace.workspaceRoot]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      'note: src/frontend/app/app.ts still installs the old hot-update hooks, but its registry block differs from the scaffold',
    );
    expect(result.stdout).not.toContain('  - src/frontend/app/hmr.js');
    const app = await readFile(prepared.appTsPath, 'utf8');
    expect(app).toContain("console.debug('disposing', moduleId);");
    expect(app).toContain('window.__webstirDispose = async');
    expect(await readFile(prepared.clientPath, 'utf8')).toBe(legacyClient);

    const json = await runCli([
      'repair',
      '--workspace',
      prepared.workspace.workspaceRoot,
      '--json',
    ]);
    const parsed = JSON.parse(json.stdout) as { notes: string[] };
    expect(parsed.notes).toHaveLength(1);
  } finally {
    await removeDemoWorkspace(prepared.workspace);
  }
});

test('CLI repair restores the s3-cloudfront deploy script and edge function', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-repair-ssg-s3-');
  try {
    const enable = await runCli([
      'enable',
      's3-cloudfront',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);
    expect(enable.exitCode).toBe(0);

    const deployScript = path.join(
      copiedWorkspace.workspaceRoot,
      'utils',
      'deploy-s3-cloudfront.sh',
    );
    const edgeFunction = path.join(
      copiedWorkspace.workspaceRoot,
      'utils',
      'cloudfront-rewrite-directory-index.js',
    );
    await rm(deployScript, { force: true });
    await rm(edgeFunction, { force: true });

    const result = await runCli(['repair', '--workspace', copiedWorkspace.workspaceRoot]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('utils/deploy-s3-cloudfront.sh');
    expect(result.stdout).toContain('utils/cloudfront-rewrite-directory-index.js');
    expect(existsSync(deployScript)).toBe(true);
    expect(existsSync(edgeFunction)).toBe(true);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI repair preserves mode ownership when an enabled feature target overlaps', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-repair-overlap-', {
    workspaceName: 'spa',
  });
  const packageJsonPath = path.join(copiedWorkspace.workspaceRoot, 'package.json');
  const routerPath = path.join(
    copiedWorkspace.workspaceRoot,
    'src',
    'frontend',
    'app',
    'router.ts',
  );
  const modeRouterPath = path.join(
    packageRoot,
    'assets',
    'templates',
    'spa',
    'src',
    'frontend',
    'app',
    'router.ts',
  );

  try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
      webstir: { enable?: { spa?: boolean } };
    };
    packageJson.webstir.enable = { ...packageJson.webstir.enable, spa: true };
    await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
    await rm(routerPath, { force: true });

    const result = await runCli(['repair', '--workspace', copiedWorkspace.workspaceRoot]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('src/frontend/app/router.ts');
    expect(await readFile(routerPath, 'utf8')).toBe(await readFile(modeRouterPath, 'utf8'));
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI repair emits machine-readable JSON for dry-run output', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-repair-json-', {
    workspaceName: 'spa',
  });

  try {
    const missingFile = path.join(
      copiedWorkspace.workspaceRoot,
      'src',
      'frontend',
      'app',
      'app.html',
    );
    await rm(missingFile, { force: true });

    const result = await runCli([
      'repair',
      '--dry-run',
      '--json',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(existsSync(missingFile)).toBe(false);

    const parsed = JSON.parse(result.stdout) as {
      command: string;
      workspaceRoot: string;
      mode: string;
      dryRun: boolean;
      changes: string[];
    };

    expect(parsed.command).toBe('repair');
    expect(parsed.workspaceRoot).toBe(copiedWorkspace.workspaceRoot);
    expect(parsed.mode).toBe('spa');
    expect(parsed.dryRun).toBe(true);
    expect(parsed.changes).toEqual(['AGENTS.md', 'src/frontend/app/app.html']);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI repair preflights every asset it restores before dry-run or mutation', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-repair-assets-symlink-', {
    workspaceName: 'spa',
  });
  const externalRoot = await mkdtemp(
    path.join(os.tmpdir(), 'webstir-repair-assets-symlink-outside-'),
  );
  // Still named by base.tsconfig.json's references, so repair would restore it.
  const missingRootAsset = path.join(
    copiedWorkspace.workspaceRoot,
    'src',
    'shared',
    'tsconfig.json',
  );
  const packageJsonPath = path.join(copiedWorkspace.workspaceRoot, 'package.json');
  const packageJson = await readFile(packageJsonPath, 'utf8');
  const sentinelPath = path.join(externalRoot, 'sentinel.txt');
  await writeFile(sentinelPath, 'outside-sentinel', 'utf8');

  try {
    await rm(missingRootAsset, { force: true });
    const appRoot = path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'app');
    await rm(appRoot, { recursive: true, force: true });
    await symlink(externalRoot, appRoot, 'dir');

    for (const extraArgs of [['--dry-run'], []] as const) {
      const result = await runCli([
        'repair',
        ...extraArgs,
        '--workspace',
        copiedWorkspace.workspaceRoot,
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('symbolic link');
      expect(existsSync(missingRootAsset)).toBe(false);
      expect(await readFile(packageJsonPath, 'utf8')).toBe(packageJson);
      expect(await readFile(sentinelPath, 'utf8')).toBe('outside-sentinel');
      expect(existsSync(path.join(externalRoot, 'app.ts'))).toBe(false);
    }
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
    await rm(externalRoot, { recursive: true, force: true });
  }
});

test('CLI repair preflights enabled feature assets before restoring root assets', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/site', 'webstir-repair-feature-symlink-', {
    workspaceName: 'site',
  });
  const externalRoot = await mkdtemp(
    path.join(os.tmpdir(), 'webstir-repair-feature-symlink-outside-'),
  );
  // Still named by base.tsconfig.json's references, so repair would restore it.
  const missingRootAsset = path.join(
    copiedWorkspace.workspaceRoot,
    'src',
    'frontend',
    'tsconfig.json',
  );
  const sentinelPath = path.join(externalRoot, 'sentinel.txt');
  await writeFile(sentinelPath, 'outside-sentinel', 'utf8');

  try {
    await rm(missingRootAsset, { force: true });
    const featureStyles = path.join(
      copiedWorkspace.workspaceRoot,
      'src',
      'frontend',
      'app',
      'styles',
      'features',
    );
    await rm(featureStyles, { recursive: true, force: true });
    await symlink(externalRoot, featureStyles, 'dir');

    const result = await runCli(['repair', '--workspace', copiedWorkspace.workspaceRoot]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('symbolic link');
    expect(existsSync(missingRootAsset)).toBe(false);
    expect(await readFile(sentinelPath, 'utf8')).toBe('outside-sentinel');
    expect(existsSync(path.join(externalRoot, 'search.css'))).toBe(false);
    expect(existsSync(path.join(externalRoot, 'content-nav.css'))).toBe(false);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
    await rm(externalRoot, { recursive: true, force: true });
  }
});

test('CLI repair preflights backend provider assets before restoring root assets', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-repair-backend-symlink-', {
    workspaceName: 'spa',
  });
  const externalRoot = await mkdtemp(
    path.join(os.tmpdir(), 'webstir-repair-backend-symlink-outside-'),
  );
  // Still named by base.tsconfig.json's references, so repair would restore it.
  const missingRootAsset = path.join(
    copiedWorkspace.workspaceRoot,
    'src',
    'shared',
    'tsconfig.json',
  );
  const sentinelPath = path.join(externalRoot, 'sentinel.txt');
  await writeFile(sentinelPath, 'outside-sentinel', 'utf8');

  try {
    const enableResult = await runCli([
      'enable',
      'backend',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);
    expect(enableResult.exitCode).toBe(0);

    await rm(missingRootAsset, { force: true });
    const backendAuthRoot = path.join(copiedWorkspace.workspaceRoot, 'src', 'backend', 'auth');
    await rm(backendAuthRoot, { recursive: true, force: true });
    await symlink(externalRoot, backendAuthRoot, 'dir');

    const result = await runCli(['repair', '--workspace', copiedWorkspace.workspaceRoot]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('symbolic link');
    expect(existsSync(missingRootAsset)).toBe(false);
    expect(await readFile(sentinelPath, 'utf8')).toBe('outside-sentinel');
    expect(existsSync(path.join(externalRoot, 'adapter.ts'))).toBe(false);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
    await rm(externalRoot, { recursive: true, force: true });
  }
});
