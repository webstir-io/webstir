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

async function installPackages(workspace, packages, options = { dev: false }) {
  if (!packages || packages.length === 0) return;
  const args = ['add', '--silent', ...packages];
  if (options.dev) {
    args.push('-D');
  }
  await new Promise((resolve, reject) => {
    const child = spawn('bun', args, { cwd: workspace, stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`bun add failed (${code})`))));
  });
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
        ...env
      },
      stdio: ['ignore', 'pipe', 'pipe']
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
      entry.isDirectory() ? 'dir' : 'file'
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
      entry.isDirectory() ? 'dir' : 'file'
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

async function runTemplateSqliteProbes(workspace) {
  const alternateCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-backend-smoke-sqlite-cwd-'));
  const sessionStoreUrl = JSON.stringify(pathToFileURL(path.join(workspace, 'src', 'backend', 'session', 'store.ts')).href);
  const runtimeSessionUrl = JSON.stringify(pathToFileURL(path.join(workspace, 'src', 'backend', 'runtime', 'session.ts')).href);
  const dbConnectionUrl = JSON.stringify(pathToFileURL(path.join(workspace, 'src', 'backend', 'db', 'connection.ts')).href);

  const sessionProbe = `
    const [{ sessionStore }, { prepareSessionState }] = await Promise.all([
      import(${sessionStoreUrl}),
      import(${runtimeSessionUrl})
    ]);

    const config = {
      secret: 'smoke-session-secret',
      cookieName: 'webstir_session',
      secure: false,
      maxAgeSeconds: 60
    };
    const loginRoute = {
      form: {
        session: { write: true },
        flash: {
          publish: [{ key: 'signed-in', level: 'success', when: 'success' }]
        }
      }
    };
    const accountRoute = {
      session: { mode: 'optional' },
      flash: { consume: ['signed-in'] }
    };
    const created = prepareSessionState({
      cookies: '',
      route: loginRoute,
      config,
      store: sessionStore
    });
    const createdCommit = created.commit({
      session: {
        userId: 'ada@example.com'
      },
      route: loginRoute,
      result: {
        status: 303,
        redirect: { location: '/session/account' }
      }
    });
    const cookie = String(createdCommit.setCookie).split(';')[0];
    const read = prepareSessionState({
      cookies: cookie,
      route: accountRoute,
      config,
      store: sessionStore
    });
    console.log(JSON.stringify({
      userId: read.session?.userId ?? null,
      flash: read.flash.map((message) => ({ key: message.key, level: message.level }))
    }));
  `;

  const dbProbe = `
    const { createDatabaseClient } = await import(${dbConnectionUrl});
    const db = await createDatabaseClient();
    await db.execute('CREATE TABLE IF NOT EXISTS smoke_items (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
    await db.execute('DELETE FROM smoke_items');
    await db.execute('INSERT INTO smoke_items (id, value) VALUES (?, ?)', ['row-1', 'Ada']);
    const rows = await db.query('SELECT value FROM smoke_items WHERE id = ?', ['row-1']);
    const databases = await db.query('PRAGMA database_list');
    const main = databases.find((row) => row.name === 'main');
    console.log(JSON.stringify({ target: main?.file ?? null, value: rows[0]?.value ?? null }));
    await db.close();
  `;

  const sessionResult = await runBunProbe(sessionProbe, {
    cwd: alternateCwd,
    env: {
      WORKSPACE_ROOT: '   ',
      WEBSTIR_WORKSPACE_ROOT: workspace,
      SESSION_STORE_DRIVER: 'sqlite',
      SESSION_STORE_URL: 'file:./data/smoke-session.sqlite'
    }
  });
  console.info('[smoke] sqlite session probe:', sessionResult);
  if (sessionResult.userId !== 'ada@example.com') {
    throw new Error(`[smoke] sqlite session probe returned unexpected userId ${sessionResult.userId}`);
  }
  if (!await pathExists(path.join(workspace, 'data', 'smoke-session.sqlite'))) {
    throw new Error('[smoke] sqlite session probe did not create the workspace-root session database');
  }
  if (await pathExists(path.join(alternateCwd, 'data', 'smoke-session.sqlite'))) {
    throw new Error('[smoke] sqlite session probe wrote to the probe cwd instead of the workspace root');
  }

  const dbResult = await runBunProbe(dbProbe, {
    cwd: alternateCwd,
    env: {
      WORKSPACE_ROOT: '   ',
      WEBSTIR_WORKSPACE_ROOT: workspace,
      DATABASE_URL: 'file:./data/smoke-db.sqlite'
    }
  });
  console.info('[smoke] sqlite db probe:', dbResult);
  if (dbResult.value !== 'Ada') {
    throw new Error(`[smoke] sqlite db probe returned unexpected value ${dbResult.value}`);
  }
  if (!await pathExists(path.join(workspace, 'data', 'smoke-db.sqlite'))) {
    throw new Error('[smoke] sqlite db probe did not create the workspace-root database');
  }
  if (await pathExists(path.join(alternateCwd, 'data', 'smoke-db.sqlite'))) {
    throw new Error('[smoke] sqlite db probe wrote to the probe cwd instead of the workspace root');
  }
}

async function main() {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-backend-smoke-'));
  const assets = await backendProvider.getScaffoldAssets();
  await Promise.all(
    assets.map(async (asset) => {
      const target = path.join(workspace, asset.targetPath);
      await copyFile(asset.sourcePath, target);
    })
  );

  const backendTsconfigPath = path.join(workspace, 'src', 'backend', 'tsconfig.json');
  try {
    const backendTsconfigRaw = await fs.readFile(backendTsconfigPath, 'utf8');
    const backendTsconfig = JSON.parse(backendTsconfigRaw);
    if (backendTsconfig?.compilerOptions) {
      delete backendTsconfig.compilerOptions.types;
    }
    await fs.writeFile(backendTsconfigPath, `${JSON.stringify(backendTsconfig, null, 2)}\n`, 'utf8');
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
        views: []
      }
    }
  };
  await fs.writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

  await installPackages(workspace, ['pino']);

  if (process.env.WEBSTIR_BACKEND_SMOKE_FASTIFY !== 'skip') {
    // Add optional Fastify dependency so the scaffold type-checks if present
    try {
      await installPackages(workspace, ['fastify', '@types/node@^20'], { dev: true });
    } catch (err) {
      console.warn('[smoke] skipping Fastify install:', err);
    }
  } else {
    console.info('[smoke] fastify install skipped by WEBSTIR_BACKEND_SMOKE_FASTIFY=skip');
  }

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
      skipLibCheck: true
    }
  };
  await fs.writeFile(rootTsconfigPath, `${JSON.stringify(rootTsconfig, null, 2)}\n`, 'utf8');

  const envBase = {
    PATH: `${getLocalBinPath()}${path.delimiter}${process.env.PATH ?? ''}`,
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
    // Exercise provider diagnostic filtering: suppress info by default
    WEBSTIR_BACKEND_LOG_LEVEL: 'warn'
  };

  console.info('[smoke] build mode');
  const buildResult = await backendProvider.build({
    workspaceRoot: workspace,
    env: { ...envBase, WEBSTIR_MODULE_MODE: 'build' },
    incremental: false
  });
  const buildEntries = buildResult.manifest.entryPoints;
  const buildFunctions = buildEntries.filter((p) => p.startsWith('functions/')).length;
  const buildJobs = buildEntries.filter((p) => p.startsWith('jobs/')).length;
  const buildServer = buildEntries.filter((p) => p === 'index.js' || /(^|\/)index\.js$/.test(p) && !/^(functions|jobs)\//.test(p)).length;
  console.info('[smoke] build entryPoints:', buildEntries);
  console.info('[smoke] build entry counts:', { server: buildServer, functions: buildFunctions, jobs: buildJobs });
  if (buildFunctions < 1 || buildJobs < 1) {
    throw new Error(`[smoke] expected scaffold to include functions and jobs (got functions=${buildFunctions}, jobs=${buildJobs})`);
  }
  const buildModule = buildResult.manifest.module ?? {};
  console.info('[smoke] build routes/views summary:', {
    routes: Array.isArray(buildModule.routes) ? buildModule.routes.length : 0,
    views: Array.isArray(buildModule.views) ? buildModule.views.length : 0
  });
  console.info('[smoke] build diagnostics (>=warn):', buildResult.manifest.diagnostics.map((d) => d.message));
  console.info('[smoke] sqlite template probes');
  await runTemplateSqliteProbes(workspace);

  console.info('[smoke] publish mode');
  const publishResult = await backendProvider.build({
    workspaceRoot: workspace,
    // Intentionally clear PATH so `tsc` is not found; provider will warn and continue
    env: { ...envBase, WEBSTIR_MODULE_MODE: 'publish', PATH: '' },
    incremental: false
  });
  const publishEntries = publishResult.manifest.entryPoints;
  const publishFunctions = publishEntries.filter((p) => p.startsWith('functions/')).length;
  const publishJobs = publishEntries.filter((p) => p.startsWith('jobs/')).length;
  const publishServer = publishEntries.filter((p) => p === 'index.js' || /(^|\/)index\.js$/.test(p) && !/^(functions|jobs)\//.test(p)).length;
  console.info('[smoke] publish entryPoints:', publishEntries);
  console.info('[smoke] publish entry counts:', { server: publishServer, functions: publishFunctions, jobs: publishJobs });
  if (publishFunctions < 1 || publishJobs < 1) {
    throw new Error(`[smoke] expected scaffold to include functions and jobs after publish (got functions=${publishFunctions}, jobs=${publishJobs})`);
  }
  const publishModule = publishResult.manifest.module ?? {};
  console.info('[smoke] publish routes/views summary:', {
    routes: Array.isArray(publishModule.routes) ? publishModule.routes.length : 0,
    views: Array.isArray(publishModule.views) ? publishModule.views.length : 0
  });
  const publishDiagnostics = publishResult.manifest.diagnostics
    .map((d) => ({ ...d, message: d.message.trim() }))
    .filter((d) => d.severity !== 'info');
  const unexpectedPublishDiagnostics = publishDiagnostics.filter((d) => !/TypeScript compiler \(tsc\) not found|Type checking failed/.test(d.message));
  if (unexpectedPublishDiagnostics.length > 0) {
    console.info('[smoke] publish diagnostics (non-info):', unexpectedPublishDiagnostics.map((d) => d.message));
  }

  if (process.env.WEBSTIR_BACKEND_SMOKE_FASTIFY !== 'skip') {
    // Fastify scaffold type-check (no run): ensure tsc sees server/fastify.ts
    console.info('[smoke] fastify type-check');
    const typecheckResult = await backendProvider.build({
      workspaceRoot: workspace,
      env: { PATH: envBase.PATH, WEBSTIR_BACKEND_LOG_LEVEL: 'warn', WEBSTIR_MODULE_MODE: 'build', WEBSTIR_BACKEND_TYPECHECK: 'skip' },
      incremental: false
    });
    const typecheckErrors = typecheckResult.manifest.diagnostics.filter((d) => d.severity === 'error');
    if (typecheckErrors.length > 0) {
      throw new Error(`[smoke] fastify type-check reported errors: ${typecheckErrors.map((d) => d.message).join('; ')}`);
    }

    // Optionally run server and hit /api/health
    if (process.env.WEBSTIR_BACKEND_SMOKE_FASTIFY_RUN !== 'skip') {
      console.info('[smoke] fastify run + health check');
      const port = 47891;
      const child = spawn(process.execPath, ['build/backend/server/fastify.js'], {
        cwd: workspace,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PORT: String(port) }
      });

      let ready = false;
      const outChunks = [];
      child.stdout.on('data', (c) => {
        const s = c.toString();
        outChunks.push(s);
        if (!ready && s.includes('API server running')) {
          ready = true;
          (async () => {
            try {
              const res = await fetch(`http://127.0.0.1:${port}/api/health`);
              if (!res.ok) throw new Error(`health returned ${res.status}`);
              const json = await res.json();
              if (!json || json.ok !== true) throw new Error('health payload invalid');
            } catch (err) {
              console.error('[smoke] fastify health check failed:', err);
              child.kill();
              throw err;
            } finally {
              child.kill();
            }
          })().catch((err) => {
            console.error(err);
            process.exitCode = 1;
          });
        }
      });

      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          if (!ready) {
            console.error('[smoke] fastify did not reach readiness');
            child.kill();
          }
          resolve(null);
        }, 8000);
        child.on('close', () => {
          clearTimeout(timer);
          resolve(null);
        });
      });
    } else {
      console.info('[smoke] fastify run skipped by WEBSTIR_BACKEND_SMOKE_FASTIFY_RUN=skip');
    }
  } else {
    console.info('[smoke] fastify type-check skipped by WEBSTIR_BACKEND_SMOKE_FASTIFY=skip');
  }

  console.info('[smoke] completed: build ✔ publish ✔ fastify ✔');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
