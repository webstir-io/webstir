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

const fixturesRoot = path.join(packageRoot, 'test-support', 'fixtures');

// Files a mature full-mode app removes when it moves to server-rendered views, and its own
// instructions file it chose not to keep.
const REMOVED_BY_MATURE_APP = ['AGENTS.md', 'src/frontend/pages/home/index.ts'];

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

// The shape of a real app from before the package tsconfigs: starter files removed, project
// references kept in tsconfig.json, and base.tsconfig.json holding only shared compiler options.
async function matureFullApp(root: string): Promise<void> {
  for (const relative of REMOVED_BY_MATURE_APP) {
    await rm(path.join(root, relative), { force: true });
  }
  await writeJson(path.join(root, 'base.tsconfig.json'), { compilerOptions: { strict: true } });
  await writeJson(path.join(root, 'tsconfig.json'), {
    files: [],
    references: [{ path: 'src/frontend' }, { path: 'src/backend' }],
  });
}

const templateRoot = path.join(packageRoot, 'assets', 'templates', 'full');

const sortPaths = (paths: readonly string[]) =>
  [...paths].sort((left, right) => left.localeCompare(right));

test.each([
  {
    name: 'repair leaves a mature app missing scaffold files alone',
    args: [] as string[],
    prepare: async (_root: string) => {},
    changes: [] as string[],
    missing: REMOVED_BY_MATURE_APP,
  },
  {
    name: 'repair --restore-scaffold re-creates every missing scaffold file, AGENTS.md included',
    args: ['--restore-scaffold'],
    prepare: async (_root: string) => {},
    changes: REMOVED_BY_MATURE_APP,
    missing: [] as string[],
  },
  {
    name: "repair takes the scaffold's hot-module registry and error loader out of app.ts and writes no dev client",
    args: [] as string[],
    prepare: async (root: string) => {
      await writeFile(
        path.join(root, 'src', 'frontend', 'app', 'app.ts'),
        await readFile(path.join(fixturesRoot, 'legacy-hot-module-app.ts.txt'), 'utf8'),
        'utf8',
      );
    },
    changes: ['src/frontend/app/app.ts'],
    missing: REMOVED_BY_MATURE_APP,
    verify: async (root: string) => {
      const app = path.join(root, 'src', 'frontend', 'app');
      expect(existsSync(path.join(app, 'hmr.js'))).toBe(false);
      // Only the app's own import is left.
      expect(await readFile(path.join(app, 'app.ts'), 'utf8')).toBe(
        "import './scripts/components/menu.js';\n",
      );
    },
  },
  {
    name: 'repair still adds the backend reference base.tsconfig.json lacks',
    args: [] as string[],
    prepare: async (root: string) => {
      await rm(path.join(root, 'tsconfig.json'));
    },
    changes: ['base.tsconfig.json'],
    missing: REMOVED_BY_MATURE_APP,
  },
])('CLI $name', async ({ args, prepare, changes, missing, ...row }) => {
  const copiedWorkspace = await copyDemoWorkspace('full', 'webstir-repair-mature-', {
    workspaceName: 'full',
  });
  const root = copiedWorkspace.workspaceRoot;
  const restored = (relative: string) => existsSync(path.join(root, relative));
  try {
    await matureFullApp(root);
    await prepare(root);

    const dryRun = await runCli(['repair', '--dry-run', '--json', ...args, '--workspace', root]);
    expect(dryRun.exitCode).toBe(0);
    const planned = JSON.parse(dryRun.stdout) as {
      restoreScaffold: boolean;
      changes: string[];
      missingScaffold: string[];
    };
    expect(planned.restoreScaffold).toBe(args.includes('--restore-scaffold'));
    expect(planned.changes).toEqual(sortPaths(changes));
    expect(planned.missingScaffold).toEqual(sortPaths(missing));
    expect(REMOVED_BY_MATURE_APP.filter(restored)).toEqual([]);

    const result = await runCli(['repair', '--json', ...args, '--workspace', root]);
    expect(result.exitCode).toBe(0);
    expect((JSON.parse(result.stdout) as { changes: string[] }).changes).toEqual(
      sortPaths(changes),
    );
    expect(REMOVED_BY_MATURE_APP.filter(restored)).toEqual(
      REMOVED_BY_MATURE_APP.filter((file) => changes.includes(file)),
    );

    if ('verify' in row && row.verify) await row.verify(root);

    const again = await runCli(['repair', '--dry-run', '--json', ...args, '--workspace', root]);
    expect((JSON.parse(again.stdout) as { changes: string[] }).changes).toEqual([]);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI repair lists missing scaffold files and the flag that restores them', async () => {
  const copiedWorkspace = await copyDemoWorkspace('full', 'webstir-repair-mature-text-', {
    workspaceName: 'full',
  });
  const root = copiedWorkspace.workspaceRoot;
  try {
    await matureFullApp(root);

    const plain = await runCli(['repair', '--dry-run', '--workspace', root]);
    expect(plain.stdout).toContain('restore-scaffold: false');
    expect(plain.stdout).toContain('changes: none');
    expect(plain.stdout).toContain(
      `missing scaffold files (left alone; --restore-scaffold re-creates them): ${REMOVED_BY_MATURE_APP.length}`,
    );
    expect(plain.stdout).toContain('  - src/frontend/pages/home/index.ts');

    const restoring = await runCli([
      'repair',
      '--dry-run',
      '--restore-scaffold',
      '--workspace',
      root,
    ]);
    expect(restoring.stdout).toContain('restore-scaffold: true');
    expect(restoring.stdout).toContain(`changes: ${REMOVED_BY_MATURE_APP.length}`);
    expect(restoring.stdout).not.toContain('missing scaffold files');

    const misplaced = await runCli(['doctor', '--restore-scaffold', '--workspace', root]);
    expect(misplaced.exitCode).toBe(1);
    expect(misplaced.stderr).toContain('Only repair and agent repair accept --restore-scaffold.');
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI repair supports dry-run without restoring files', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-repair-spa-', {
    workspaceName: 'spa',
  });

  try {
    const missingFile = path.join(
      copiedWorkspace.workspaceRoot,
      'src/frontend/pages/home/index.css',
    );
    await rm(missingFile, { force: true });

    const result = await runCli([
      'repair',
      '--restore-scaffold',
      '--dry-run',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('dry-run: true');
    expect(result.stdout).toContain('src/frontend/pages/home/index.css');
    expect(existsSync(missingFile)).toBe(false);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI repair swaps the client-nav copies Webstir shipped for the packaged feature', async () => {
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
    // The entry those versions wrote imported the copies, and nothing of the app's own.
    const appTsPath = path.join(root, 'src', 'frontend', 'app', 'app.ts');
    await writeFile(
      appTsPath,
      "// Global app initialization\n\nimport './scripts/features/client-nav.js';\n",
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
    // The flag brings in the packaged feature, so the entry has nothing left to hold.
    expect(existsSync(appTsPath)).toBe(false);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI repair restores the SSG site demo deploy wiring and leaves feature imports to the build', async () => {
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
    // An app from before the build added features imports them itself.
    await writeFile(appTsPath, `${await readFile(appTsPath, 'utf8')}${searchScript}`, 'utf8');
    await writeFile(
      appCssPath,
      (await readFile(appCssPath, 'utf8')).replace(
        '@import "./styles/shell.css";',
        `${searchStyles}@import "./styles/shell.css";`,
      ),
      'utf8',
    );

    const result = await runCli(['repair', '--workspace', root]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('utils/deploy-gh-pages.sh');
    expect(existsSync(deployScript)).toBe(true);
    expect(await readFile(appTsPath, 'utf8')).not.toContain('features/search');
    expect(await readFile(appCssPath, 'utf8')).not.toContain('features/search.css');
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

async function prepareHotModuleWorkspace(
  prefix: string,
  files: { readonly app?: string; readonly client?: string },
): Promise<{
  readonly workspace: Awaited<ReturnType<typeof copyDemoWorkspace>>;
  readonly appTsPath: string;
  readonly clientPath: string;
}> {
  const workspace = await copyDemoWorkspace('ssg/site', prefix, { workspaceName: 'site' });
  const appDir = path.join(workspace.workspaceRoot, 'src', 'frontend', 'app');
  const appTsPath = path.join(appDir, 'app.ts');
  const clientPath = path.join(appDir, 'hmr.js');
  if (files.app !== undefined) {
    await writeFile(appTsPath, files.app, 'utf8');
  }
  if (files.client !== undefined) {
    await writeFile(clientPath, files.client, 'utf8');
  }
  return { workspace, appTsPath, clientPath };
}

const packagedClient = (name: string) =>
  path.join(repoRoot, 'packages', 'tooling', 'webstir-frontend', 'src', 'dev-clients', name);

test("CLI repair takes the scaffold's hot-module registry and error loader out of app.ts, and writes no client", async () => {
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
    expect(result.stdout).not.toContain('src/frontend/app/hmr.js');
    expect(result.stdout).not.toContain('note:');

    // The registry and error loader are Webstir's now; only the app's own import is left.
    expect(await readFile(prepared.appTsPath, 'utf8')).toBe(
      "import './scripts/components/menu.js';\n",
    );
    expect(existsSync(prepared.clientPath)).toBe(false);

    const again = await runCli(['repair', '--workspace', prepared.workspace.workspaceRoot]);
    expect(again.stdout).not.toContain('src/frontend/app/app.ts');
  } finally {
    await removeDemoWorkspace(prepared.workspace);
  }
});

// Webstir owns the app entry's registry, the error reporter and the app's styles on every page, so
// repair takes the copies 0.7 wrote out of an app, and leaves anything the app changed with a note.
const APP_07 = path.join(fixturesRoot, 'app-0.7');
test.each([
  {
    name: 'an app as 0.7 wrote it',
    prepare: async (_root: string) => {},
    removed: ['src/frontend/app/app.ts', 'src/frontend/app/error.ts'],
    kept: [] as string[],
    note: null as RegExp | null,
  },
  {
    name: 'an app that edited its error reporter',
    prepare: async (root: string) => {
      const errorTs = path.join(root, 'src', 'frontend', 'app', 'error.ts');
      await writeFile(errorTs, `${await readFile(errorTs, 'utf8')}// ours\n`);
    },
    removed: ['src/frontend/app/app.ts'],
    kept: ['src/frontend/app/error.ts'],
    note: /src\/frontend\/app\/error\.ts is no longer used/,
  },
  {
    name: 'an app whose page imports from app.ts',
    prepare: async (root: string) => {
      await writeFile(
        path.join(root, 'src', 'frontend', 'pages', 'home', 'uses-app.ts'),
        "import { registerHotModule } from '../../app/app';\nexport { registerHotModule };\n",
      );
    },
    removed: [] as string[],
    kept: ['src/frontend/app/app.ts', 'src/frontend/app/error.ts'],
    note: /because src\/frontend\/pages\/home\/uses-app\.ts import from it/,
  },
  {
    name: 'an app whose page add-page wrote loads app.ts itself',
    prepare: async (root: string) => {
      await writeFile(
        path.join(root, 'src', 'frontend', 'pages', 'home', 'index.ts'),
        "// Page entry point\nimport '../../app/app';\n\n// Add page-specific logic here\n",
      );
    },
    removed: ['src/frontend/app/app.ts', 'src/frontend/app/error.ts'],
    kept: [] as string[],
    note: null as RegExp | null,
    verify: async (root: string) => {
      expect(
        await readFile(path.join(root, 'src', 'frontend', 'pages', 'home', 'index.ts'), 'utf8'),
      ).toBe('// Page entry point\nexport {};\n\n// Add page-specific logic here\n');
    },
  },
  {
    name: 'an app with a page that only shows the import in a string',
    prepare: async (root: string) => {
      await writeFile(
        path.join(root, 'src', 'frontend', 'pages', 'home', 'sample.ts'),
        "export const sample = `\nimport '../../app/app';\n`;\n",
      );
    },
    removed: ['src/frontend/app/app.ts', 'src/frontend/app/error.ts'],
    kept: [] as string[],
    note: null as RegExp | null,
    verify: async (root: string) => {
      expect(
        await readFile(path.join(root, 'src', 'frontend', 'pages', 'home', 'sample.ts'), 'utf8'),
      ).toBe("export const sample = `\nimport '../../app/app';\n`;\n");
    },
  },
  {
    name: 'an app whose page imports its error reporter',
    prepare: async (root: string) => {
      await writeFile(
        path.join(root, 'src', 'frontend', 'pages', 'home', 'uses-error.ts'),
        "import { install } from '../../app/error';\nexport { install };\n",
      );
    },
    removed: ['src/frontend/app/app.ts'],
    kept: ['src/frontend/app/error.ts'],
    note: /but src\/frontend\/pages\/home\/uses-error\.ts import it/,
  },
  {
    name: 'an app whose page imports app.css with a condition',
    prepare: async (root: string) => {
      const pageCss = path.join(root, 'src', 'frontend', 'pages', 'home', 'index.css');
      await writeFile(
        pageCss,
        (await readFile(pageCss, 'utf8')).replace(
          '@import "@app/app.css";',
          '@import "@app/app.css" layer(app);',
        ),
      );
    },
    removed: ['src/frontend/app/app.ts', 'src/frontend/app/error.ts'],
    kept: [] as string[],
    note: /index\.css still import @app\/app\.css with a condition/,
  },
])('CLI repair moves $name onto the packaged entry, reporter and styles', async (row) => {
  const copiedWorkspace = await copyDemoWorkspace('full', 'webstir-repair-app-07-', {
    workspaceName: 'full',
  });
  const root = copiedWorkspace.workspaceRoot;
  const app = path.join(root, 'src', 'frontend', 'app');
  const pageCss = path.join(root, 'src', 'frontend', 'pages', 'home', 'index.css');
  try {
    const installed = path.join(root, 'node_modules', '@webstir-io');
    await mkdir(installed, { recursive: true });
    await rm(path.join(installed, 'webstir-frontend'), { force: true });
    await symlink(
      path.join(repoRoot, 'packages', 'tooling', 'webstir-frontend'),
      path.join(installed, 'webstir-frontend'),
      'dir',
    );
    await writeFile(
      path.join(app, 'app.ts'),
      await readFile(path.join(APP_07, 'app.ts.txt'), 'utf8'),
    );
    await writeFile(
      path.join(app, 'error.ts'),
      await readFile(path.join(APP_07, 'error.ts.txt'), 'utf8'),
    );
    await writeFile(pageCss, `@import "@app/app.css";\n\n${await readFile(pageCss, 'utf8')}`);
    await row.prepare(root);

    const result = await runCli(['repair', '--workspace', root]);
    expect(result.exitCode).toBe(0);
    for (const file of row.removed) expect(existsSync(path.join(root, file))).toBe(false);
    for (const file of row.kept) expect(existsSync(path.join(root, file))).toBe(true);
    if (row.note) expect(result.stdout).toMatch(row.note);
    else expect(result.stdout).not.toContain('note:');
    const repairedCss = await readFile(pageCss, 'utf8');
    expect(repairedCss.includes('@import "@app/app.css";')).toBe(false);
    if ('verify' in row && row.verify) await row.verify(root);

    const again = await runCli(['repair', '--dry-run', '--workspace', root]);
    expect(again.stdout).toContain('changes: none');
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

// A condition on a feature stylesheet import is the app's; repair keeps it, and the build adds no
// second, unconditioned import.
test('CLI repair keeps a feature stylesheet import that carries a condition', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/site', 'webstir-repair-conditioned-css-', {
    workspaceName: 'site',
  });
  const root = copiedWorkspace.workspaceRoot;
  const appCss = path.join(root, 'src', 'frontend', 'app', 'app.css');
  const conditioned =
    '@import "@webstir-io/webstir-frontend/features/search.css" layer(widgets) print;';
  try {
    const installed = path.join(root, 'node_modules', '@webstir-io');
    await mkdir(installed, { recursive: true });
    await rm(path.join(installed, 'webstir-frontend'), { force: true });
    await symlink(
      path.join(repoRoot, 'packages', 'tooling', 'webstir-frontend'),
      path.join(installed, 'webstir-frontend'),
      'dir',
    );
    await writeFile(
      appCss,
      (await readFile(appCss, 'utf8')).replace(
        '@import "./styles/shell.css";',
        `${conditioned}\n@import "./styles/shell.css";`,
      ),
    );
    const result = await runCli(['repair', '--workspace', root]);
    expect(result.exitCode).toBe(0);
    expect(await readFile(appCss, 'utf8')).toContain(conditioned);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

// Webstir serves its own dev clients: a copy a scaffold wrote goes, an edited one stays with a note.
test.each([
  {
    name: 'the last hmr.js',
    file: 'hmr.js',
    source: () => readFile(packagedClient('hmr.js'), 'utf8'),
    removed: true,
  },
  {
    name: 'the last refresh.js',
    file: 'refresh.js',
    source: () => readFile(packagedClient('refresh.js'), 'utf8'),
    removed: true,
  },
  {
    name: 'an older ssg hmr.js',
    file: 'hmr.js',
    source: () => readFile(path.join(fixturesRoot, 'legacy-hmr-client-ssg.js.txt'), 'utf8'),
    removed: true,
  },
  {
    name: 'an older spa hmr.js',
    file: 'hmr.js',
    source: () => readFile(path.join(fixturesRoot, 'legacy-hmr-client-spa.js.txt'), 'utf8'),
    removed: true,
  },
  {
    name: 'an edited hmr.js',
    file: 'hmr.js',
    source: async () =>
      `${await readFile(packagedClient('hmr.js'), 'utf8')}\nconsole.log('mine');\n`,
    removed: false,
  },
  {
    name: 'an edited refresh.js',
    file: 'refresh.js',
    source: async () =>
      `${await readFile(packagedClient('refresh.js'), 'utf8')}\nconsole.log('mine');\n`,
    removed: false,
  },
])('CLI repair with $name in the app', async ({ file, source, removed }) => {
  const prepared = await prepareHotModuleWorkspace('webstir-repair-dev-client-', {});
  const clientPath = path.join(path.dirname(prepared.appTsPath), file);
  const contents = await source();
  await writeFile(clientPath, contents, 'utf8');

  try {
    const result = await runCli(['repair', '--workspace', prepared.workspace.workspaceRoot]);
    expect(result.exitCode).toBe(0);
    if (removed) {
      expect(result.stdout).toContain(`  - src/frontend/app/${file}`);
      expect(result.stdout).not.toContain('note:');
      expect(existsSync(clientPath)).toBe(false);
    } else {
      expect(result.stdout).toContain(
        `note: src/frontend/app/${file} is no longer used: Webstir serves its own /${file} in development.`,
      );
      expect(await readFile(clientPath, 'utf8')).toBe(contents);
    }
  } finally {
    await removeDemoWorkspace(prepared.workspace);
  }
});

test('CLI repair reports an app.ts that still installs part of the old hooks', async () => {
  const legacy = await readFile(path.join(fixturesRoot, 'legacy-hot-module-app.ts.txt'), 'utf8');
  const partial = legacy.replace('window.__webstirRegisterHotModule = registerHotModule;\n', '');
  expect(partial).not.toBe(legacy);
  const prepared = await prepareHotModuleWorkspace('webstir-repair-hot-module-partial-', {
    app: partial,
  });

  try {
    const result = await runCli(['repair', '--workspace', prepared.workspace.workspaceRoot]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      'note: src/frontend/app/app.ts still installs the old hot-update hooks',
    );
    expect(await readFile(prepared.appTsPath, 'utf8')).toContain('window.__webstirDispose = async');
  } finally {
    await removeDemoWorkspace(prepared.workspace);
  }
});

test.each([
  { file: 'app.ts', fixture: 'legacy-hot-module-app.ts.txt' },
  { file: 'hmr.js', fixture: 'legacy-hmr-client-ssg.js.txt' },
])(
  'CLI repair refuses to touch a linked $file that restores would not touch',
  async ({ file, fixture }) => {
    const prepared = await prepareHotModuleWorkspace('webstir-repair-hot-module-link-', {
      app: await readFile(path.join(fixturesRoot, 'legacy-hot-module-app.ts.txt'), 'utf8'),
      client: await readFile(path.join(fixturesRoot, 'legacy-hmr-client-ssg.js.txt'), 'utf8'),
    });
    const outside = path.join(path.dirname(prepared.workspace.workspaceRoot), `outside-${file}`);
    const legacy = await readFile(path.join(fixturesRoot, fixture), 'utf8');

    try {
      // No enabled feature, so nothing else lists app.ts as a write target.
      const packageJsonPath = path.join(prepared.workspace.workspaceRoot, 'package.json');
      const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
        webstir: Record<string, unknown>;
      };
      delete packageJson.webstir.enable;
      await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
      await writeFile(outside, legacy, 'utf8');
      const linked = file === 'app.ts' ? prepared.appTsPath : prepared.clientPath;
      await rm(linked);
      await symlink(outside, linked, 'file');

      for (const extraArgs of [['--dry-run'], []] as const) {
        const result = await runCli([
          'repair',
          ...extraArgs,
          '--workspace',
          prepared.workspace.workspaceRoot,
        ]);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('symbolic link');
        expect(await readFile(outside, 'utf8')).toBe(legacy);
      }
    } finally {
      await removeDemoWorkspace(prepared.workspace);
    }
  },
);

test('CLI repair reports a customized hot-module registry instead of rewriting it', async () => {
  const legacy = await readFile(path.join(fixturesRoot, 'legacy-hot-module-app.ts.txt'), 'utf8');
  const customized = legacy.replace(
    '  try {\n    const result = record.dispose(contextWithHistory);',
    "  try {\n    console.debug('disposing', moduleId);\n    const result = record.dispose(contextWithHistory);",
  );
  expect(customized).not.toBe(legacy);
  const prepared = await prepareHotModuleWorkspace('webstir-repair-hot-module-custom-app-', {
    app: customized,
  });

  try {
    const result = await runCli(['repair', '--workspace', prepared.workspace.workspaceRoot]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      'note: src/frontend/app/app.ts still installs the old hot-update hooks, but its registry block differs from the scaffold',
    );
    const app = await readFile(prepared.appTsPath, 'utf8');
    expect(app).toContain("console.debug('disposing', moduleId);");
    expect(app).toContain('window.__webstirDispose = async');

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

test('CLI repair removes the fields that used to say what an app is, and a dry run only reports it', async () => {
  const copiedWorkspace = await copyDemoWorkspace('full', 'webstir-repair-shape-', {
    workspaceName: 'full',
  });
  const packageJsonPath = path.join(copiedWorkspace.workspaceRoot, 'package.json');

  try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
      webstir: { mode?: string; enable?: Record<string, unknown> };
    };
    packageJson.webstir.mode = 'spa';
    packageJson.webstir.enable = { ...packageJson.webstir.enable, backend: true };
    const legacy = `${JSON.stringify(packageJson, null, 2)}\n`;
    await writeFile(packageJsonPath, legacy, 'utf8');

    const dryRun = await runCli([
      'repair',
      '--dry-run',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);
    expect(dryRun.exitCode).toBe(0);
    expect(dryRun.stdout).toContain('Removed webstir.mode and webstir.enable.backend');
    expect(await readFile(packageJsonPath, 'utf8')).toBe(legacy);

    const result = await runCli(['repair', '--workspace', copiedWorkspace.workspaceRoot]);
    expect(result.exitCode).toBe(0);
    const repaired = JSON.parse(await readFile(packageJsonPath, 'utf8'));
    expect(repaired.webstir.mode).toBeUndefined();
    expect(repaired.webstir.enable).toEqual({ clientNav: true });
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI repair lists the retired SPA router as removable and leaves it in place', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-repair-router-', {
    workspaceName: 'spa',
  });
  const routerFiles = [
    path.join('src', 'frontend', 'app', 'router.ts'),
    path.join('src', 'frontend', 'app', 'navigation.ts'),
    path.join('src', 'shared', 'router-types.ts'),
  ];

  try {
    for (const file of routerFiles) {
      await mkdir(path.dirname(path.join(copiedWorkspace.workspaceRoot, file)), {
        recursive: true,
      });
      await writeFile(path.join(copiedWorkspace.workspaceRoot, file), 'export {};\n', 'utf8');
    }

    const result = await runCli(['repair', '--workspace', copiedWorkspace.workspaceRoot]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      'The SPA router is retired (client-nav is the navigation): delete src/frontend/app/router.ts, src/frontend/app/navigation.ts, src/shared/router-types.ts once nothing in the app imports them.',
    );
    for (const file of routerFiles) {
      expect(existsSync(path.join(copiedWorkspace.workspaceRoot, file))).toBe(true);
    }
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
      'src/frontend/pages/home/index.css',
    );
    await rm(missingFile, { force: true });

    const result = await runCli([
      'repair',
      '--restore-scaffold',
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
    expect(parsed.layers).toEqual({ pages: true, server: false });
    expect(parsed.dryRun).toBe(true);
    expect(parsed.changes).toContain('src/frontend/pages/home/index.css');
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI repair preflights every asset before dry-run or mutation', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-repair-assets-symlink-', {
    workspaceName: 'spa',
  });
  const externalRoot = await mkdtemp(
    path.join(os.tmpdir(), 'webstir-repair-assets-symlink-outside-'),
  );
  const missingRootAsset = path.join(
    copiedWorkspace.workspaceRoot,
    'src/frontend/pages/home/index.css',
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
        '--restore-scaffold',
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
  const missingRootAsset = path.join(
    copiedWorkspace.workspaceRoot,
    'src/frontend/pages/home/index.css',
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

    const result = await runCli([
      'repair',
      '--restore-scaffold',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);

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

test('CLI repair preflights backend scaffold assets before restoring root assets', async () => {
  const copiedWorkspace = await copyDemoWorkspace('full', 'webstir-repair-backend-symlink-', {
    workspaceName: 'full',
  });
  const externalRoot = await mkdtemp(
    path.join(os.tmpdir(), 'webstir-repair-backend-symlink-outside-'),
  );
  const missingRootAsset = path.join(
    copiedWorkspace.workspaceRoot,
    'src/frontend/pages/home/index.css',
  );
  const backendRoot = path.join(copiedWorkspace.workspaceRoot, 'src', 'backend');

  try {
    // The server entry lives outside the app, behind a linked src/backend without its module.ts.
    await writeFile(
      path.join(externalRoot, 'index.ts'),
      await readFile(path.join(backendRoot, 'index.ts'), 'utf8'),
      'utf8',
    );
    await rm(backendRoot, { recursive: true, force: true });
    await symlink(externalRoot, backendRoot, 'dir');
    await rm(missingRootAsset, { force: true });

    const result = await runCli([
      'repair',
      '--restore-scaffold',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('symbolic link');
    expect(existsSync(missingRootAsset)).toBe(false);
    expect(existsSync(path.join(externalRoot, 'module.ts'))).toBe(false);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
    await rm(externalRoot, { recursive: true, force: true });
  }
});
