import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { backendProvider } from '../dist/index.js';
import { CONTRACT_VERSION } from '@webstir-io/module-contract';

function getLocalBinPath() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkgRoot = path.resolve(here, '..');
  return path.join(pkgRoot, 'node_modules', '.bin');
}

function getPackageRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..');
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function copyFile(src, dest) {
  await ensureDir(path.dirname(dest));
  await fs.copyFile(src, dest);
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function runBunProbe(script, { cwd, env }) {
  return await new Promise((resolve, reject) => {
    const child = spawn('bun', ['--eval', script], {
      cwd,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`bun probe failed (${code}).\nstdout:\n${stdout}\nstderr:\n${stderr}`));
        return;
      }
      const line = stdout
        .split(/\r?\n/)
        .map((value) => value.trim())
        .find((value) => value.startsWith('{'));
      if (!line) {
        reject(new Error(`bun probe did not emit JSON.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
        return;
      }
      resolve(JSON.parse(line));
    });
  });
}

async function linkWorkspaceNodeModules(workspace) {
  const packageRoot = getPackageRoot();
  const source = path.join(packageRoot, 'node_modules');
  const target = path.join(workspace, 'node_modules');
  await fs.mkdir(target, { recursive: true });

  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '@webstir-io') {
      continue;
    }
    await createSymlinkIfMissing(
      path.join(source, entry.name),
      path.join(target, entry.name),
      entry.isDirectory() ? 'dir' : 'file',
    );
  }

  const scopeSource = path.join(source, '@webstir-io');
  const scopeTarget = path.join(target, '@webstir-io');
  await fs.mkdir(scopeTarget, { recursive: true });
  const scopeEntries = await fs.readdir(scopeSource, { withFileTypes: true });
  for (const entry of scopeEntries) {
    await createSymlinkIfMissing(
      path.join(scopeSource, entry.name),
      path.join(scopeTarget, entry.name),
      entry.isDirectory() ? 'dir' : 'file',
    );
  }

  await createSymlinkIfMissing(packageRoot, path.join(scopeTarget, 'webstir-backend'), 'dir');
}

async function createSymlinkIfMissing(source, target, type) {
  try {
    await fs.symlink(source, target, type);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      return;
    }
    throw error;
  }
}

/**
 * The batteries find the app from outside it: a script run from another directory keeps its
 * sessions and database in the app's `data/`, not in the directory it ran from.
 */
async function runBatteriesProbes(workspace) {
  const alternateCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-backend-smoke-cwd-'));
  const dist = (file) =>
    JSON.stringify(pathToFileURL(path.join(getPackageRoot(), 'dist', file)).href);

  const sessionProbe = `
    const [{ appDatabase }, { createDatabaseSessionStore }, { prepareSessionState }] = await Promise.all([
      import(${dist('db/index.js')}),
      import(${dist('runtime/session-database-store.js')}),
      import(${dist('runtime/session.js')}),
    ]);
    const store = createDatabaseSessionStore(appDatabase);
    const config = { secret: 'smoke-session-secret', cookieName: 'webstir_session', secure: false, maxAgeSeconds: 60 };
    const created = await prepareSessionState({ cookies: '', config, store });
    const commit = await created.commit({ session: { userId: 'ada@example.com' } });
    const read = await prepareSessionState({ cookies: commit.setCookie.split(';')[0], config, store });
    console.log(JSON.stringify({ userId: read.session?.userId ?? null }));
    process.exit(0);
  `;
  const sessionResult = await runBunProbe(sessionProbe, {
    cwd: alternateCwd,
    env: { WORKSPACE_ROOT: '   ', WEBSTIR_WORKSPACE_ROOT: workspace },
  });
  console.info('[smoke] session probe:', sessionResult);
  if (sessionResult.userId !== 'ada@example.com') {
    throw new Error(`[smoke] session probe returned unexpected userId ${sessionResult.userId}`);
  }
  if (!(await pathExists(path.join(workspace, 'data', 'app.sqlite')))) {
    throw new Error('[smoke] session probe did not create the workspace-root database');
  }
  if (await pathExists(path.join(alternateCwd, 'data', 'app.sqlite'))) {
    throw new Error('[smoke] session probe wrote to the probe cwd instead of the workspace root');
  }

  const dbProbe = `
    const { db } = await import(${dist('db/index.js')});
    await db.execute('CREATE TABLE IF NOT EXISTS smoke_people (name TEXT NOT NULL)');
    await db.execute('INSERT INTO smoke_people (name) VALUES (?)', ['Ada']);
    const row = await db.get('SELECT name FROM smoke_people');
    console.log(JSON.stringify({ value: row?.name ?? null }));
    process.exit(0);
  `;
  const dbResult = await runBunProbe(dbProbe, {
    cwd: alternateCwd,
    env: {
      WORKSPACE_ROOT: '   ',
      WEBSTIR_WORKSPACE_ROOT: workspace,
      DATABASE_URL: 'file:./data/smoke-db.sqlite',
    },
  });
  console.info('[smoke] db probe:', dbResult);
  if (dbResult.value !== 'Ada') {
    throw new Error(`[smoke] db probe returned unexpected value ${dbResult.value}`);
  }
  if (!(await pathExists(path.join(workspace, 'data', 'smoke-db.sqlite')))) {
    throw new Error('[smoke] db probe did not create the workspace-root database');
  }
  if (await pathExists(path.join(alternateCwd, 'data', 'smoke-db.sqlite'))) {
    throw new Error('[smoke] db probe wrote to the probe cwd instead of the workspace root');
  }
}

async function main() {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-backend-smoke-'));
  const assets = await backendProvider.getScaffoldAssets();
  await Promise.all(
    assets.map(async (asset) => {
      const target = path.join(workspace, asset.targetPath);
      await copyFile(asset.sourcePath, target);
    }),
  );

  const backendTsconfigPath = path.join(workspace, 'src', 'backend', 'tsconfig.json');
  try {
    const backendTsconfigRaw = await fs.readFile(backendTsconfigPath, 'utf8');
    const backendTsconfig = JSON.parse(backendTsconfigRaw);
    if (backendTsconfig?.compilerOptions) {
      delete backendTsconfig.compilerOptions.types;
    }
    await fs.writeFile(
      backendTsconfigPath,
      `${JSON.stringify(backendTsconfig, null, 2)}\n`,
      'utf8',
    );
  } catch (error) {
    console.warn('[smoke] failed to adjust backend tsconfig:', error);
  }

  const packageJsonPath = path.join(workspace, 'package.json');
  const packageJson = {
    name: '@smoke/backend',
    version: '0.0.0',
    private: true,
    type: 'module',
    webstir: {
      module: {
        contractVersion: CONTRACT_VERSION,
        name: '@smoke/backend',
        version: '0.0.0',
        kind: 'backend',
        capabilities: [],
        routes: [],
        views: [],
      },
    },
  };
  await fs.writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

  await linkWorkspaceNodeModules(workspace);

  const rootTsconfigPath = path.join(workspace, 'tsconfig.json');
  const rootTsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      resolveJsonModule: true,
      strict: true,
      isolatedModules: true,
      esModuleInterop: true,
      skipLibCheck: true,
    },
  };
  await fs.writeFile(rootTsconfigPath, `${JSON.stringify(rootTsconfig, null, 2)}\n`, 'utf8');

  const envBase = {
    PATH: `${getLocalBinPath()}${path.delimiter}${process.env.PATH ?? ''}`,
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
    // Exercise provider diagnostic filtering: suppress info by default
    WEBSTIR_BACKEND_LOG_LEVEL: 'warn',
  };

  console.info('[smoke] build mode');
  const buildResult = await backendProvider.build({
    workspaceRoot: workspace,
    env: { ...envBase, WEBSTIR_MODULE_MODE: 'build' },
    incremental: false,
  });
  const buildEntries = buildResult.manifest.entryPoints;
  const buildFunctions = buildEntries.filter((p) => p.startsWith('functions/')).length;
  const buildJobs = buildEntries.filter((p) => p.startsWith('jobs/')).length;
  const buildServer = buildEntries.filter(
    (p) => p === 'index.js' || (/(^|\/)index\.js$/.test(p) && !/^(functions|jobs)\//.test(p)),
  ).length;
  console.info('[smoke] build entryPoints:', buildEntries);
  console.info('[smoke] build entry counts:', {
    server: buildServer,
    functions: buildFunctions,
    jobs: buildJobs,
  });
  if (buildFunctions < 1 || buildJobs < 1) {
    throw new Error(
      `[smoke] expected scaffold to include functions and jobs (got functions=${buildFunctions}, jobs=${buildJobs})`,
    );
  }
  const buildModule = buildResult.manifest.module ?? {};
  console.info('[smoke] build routes/views summary:', {
    routes: Array.isArray(buildModule.routes) ? buildModule.routes.length : 0,
    views: Array.isArray(buildModule.views) ? buildModule.views.length : 0,
  });
  console.info(
    '[smoke] build diagnostics (>=warn):',
    buildResult.manifest.diagnostics.map((d) => d.message),
  );
  console.info('[smoke] batteries probes');
  await runBatteriesProbes(workspace);

  console.info('[smoke] publish mode');
  const publishResult = await backendProvider.build({
    workspaceRoot: workspace,
    // Intentionally clear PATH so `tsc` is not found; provider will warn and continue
    env: { ...envBase, WEBSTIR_MODULE_MODE: 'publish', PATH: '' },
    incremental: false,
  });
  const publishEntries = publishResult.manifest.entryPoints;
  const publishFunctions = publishEntries.filter((p) => p.startsWith('functions/')).length;
  const publishJobs = publishEntries.filter((p) => p.startsWith('jobs/')).length;
  const publishServer = publishEntries.filter(
    (p) => p === 'index.js' || (/(^|\/)index\.js$/.test(p) && !/^(functions|jobs)\//.test(p)),
  ).length;
  console.info('[smoke] publish entryPoints:', publishEntries);
  console.info('[smoke] publish entry counts:', {
    server: publishServer,
    functions: publishFunctions,
    jobs: publishJobs,
  });
  if (publishFunctions < 1 || publishJobs < 1) {
    throw new Error(
      `[smoke] expected scaffold to include functions and jobs after publish (got functions=${publishFunctions}, jobs=${publishJobs})`,
    );
  }
  const publishModule = publishResult.manifest.module ?? {};
  console.info('[smoke] publish routes/views summary:', {
    routes: Array.isArray(publishModule.routes) ? publishModule.routes.length : 0,
    views: Array.isArray(publishModule.views) ? publishModule.views.length : 0,
  });
  const publishDiagnostics = publishResult.manifest.diagnostics
    .map((d) => ({ ...d, message: d.message.trim() }))
    .filter((d) => d.severity !== 'info');
  const unexpectedPublishDiagnostics = publishDiagnostics.filter(
    (d) => !/TypeScript compiler \(tsc\) not found|Type checking failed/.test(d.message),
  );
  if (unexpectedPublishDiagnostics.length > 0) {
    console.info(
      '[smoke] publish diagnostics (non-info):',
      unexpectedPublishDiagnostics.map((d) => d.message),
    );
  }

  console.info('[smoke] completed: build ✔ publish ✔');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
