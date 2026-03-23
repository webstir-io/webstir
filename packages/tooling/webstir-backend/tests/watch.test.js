import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startBackendWatch } from '../dist/watch.js';
import { backendProvider } from '../dist/index.js';

async function createTempWorkspace(prefix = 'webstir-backend-watch-') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return dir;
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function copyFile(src, dest) {
  await ensureDir(path.dirname(dest));
  await fs.copyFile(src, dest);
}

async function seedBackendEntry(workspace) {
  const assets = await backendProvider.getScaffoldAssets();
  for (const asset of assets) {
    if (!asset.targetPath.endsWith(path.join('backend', 'index.ts'))) continue;
    const target = path.join(workspace, asset.targetPath);
    await copyFile(asset.sourcePath, target);
  }
}

async function seedBackendScaffold(workspace) {
  const assets = await backendProvider.getScaffoldAssets();
  for (const asset of assets) {
    if (!asset.targetPath.startsWith(path.join('src', 'backend'))) continue;
    const target = path.join(workspace, asset.targetPath);
    await copyFile(asset.sourcePath, target);
  }
}

function getLocalBinPath() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkgRoot = path.resolve(here, '..');
  return path.join(pkgRoot, 'node_modules', '.bin');
}

async function waitFor(checkFn, timeoutMs = 5000, pollMs = 100) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkFn()) return;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error('waitFor timed out');
}

test('startBackendWatch updates cache files after rebuild', async () => {
  const workspace = await createTempWorkspace();
  await seedBackendEntry(workspace);

  const env = {
    WEBSTIR_MODULE_MODE: 'build',
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
    PATH: `${getLocalBinPath()}${path.delimiter}${process.env.PATH ?? ''}`,
  };

  try {
    const handle = await startBackendWatch({ workspaceRoot: workspace, env });
    const outputsPath = path.join(workspace, '.webstir', 'backend-outputs.json');

    try {
      await waitFor(async () => {
        try {
          await fs.access(outputsPath);
          return true;
        } catch {
          return false;
        }
      });

      const before = JSON.parse(await fs.readFile(outputsPath, 'utf8'));
      const indexPath = path.join(workspace, 'src', 'backend', 'index.ts');
      await fs.appendFile(indexPath, '\nconsole.log("watch-test");\n', 'utf8');

      await waitFor(async () => {
        try {
          const after = JSON.parse(await fs.readFile(outputsPath, 'utf8'));
          const key = Object.keys(after)[0];
          return before[key] !== after[key];
        } catch {
          return false;
        }
      });

      const manifestDigestPath = path.join(workspace, '.webstir', 'backend-manifest-digest.json');
      await waitFor(async () => {
        try {
          await fs.access(manifestDigestPath);
          return true;
        } catch {
          return false;
        }
      });

      assert.ok(true, 'watch updated cache files after rebuild');
    } finally {
      await handle.stop();
    }
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('startBackendWatch emits build outcome events for successful and failed rebuilds', async () => {
  const workspace = await createTempWorkspace('webstir-backend-watch-events-');
  await seedBackendEntry(workspace);

  const env = {
    WEBSTIR_MODULE_MODE: 'build',
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
    PATH: `${getLocalBinPath()}${path.delimiter}${process.env.PATH ?? ''}`,
  };

  const events = [];
  try {
    const handle = await startBackendWatch({
      workspaceRoot: workspace,
      env,
      onEvent(event) {
        events.push(event);
      },
    });

    try {
      await waitFor(async () =>
        events.some((event) => event.type === 'build-complete' && event.succeeded === true),
      );

      const indexPath = path.join(workspace, 'src', 'backend', 'index.ts');
      await fs.writeFile(indexPath, 'export default () => {\n', 'utf8');

      await waitFor(async () =>
        events.some((event) => event.type === 'build-complete' && event.succeeded === false),
      );

      assert.ok(events.some((event) => event.type === 'build-start'));
      assert.ok(
        events.some((event) => event.type === 'build-complete' && event.succeeded === true),
      );
      assert.ok(
        events.some((event) => event.type === 'build-complete' && event.succeeded === false),
      );
    } finally {
      await handle.stop();
    }
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('startBackendWatch reports Bun benchmark timings when enabled', async () => {
  const workspace = await createTempWorkspace('webstir-backend-watch-benchmark-');
  await seedBackendScaffold(workspace);

  const env = {
    WEBSTIR_MODULE_MODE: 'build',
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
    WEBSTIR_BACKEND_WATCH_BUN_BENCHMARK: '1',
    PATH: `${getLocalBinPath()}${path.delimiter}${process.env.PATH ?? ''}`,
  };

  const events = [];
  try {
    const handle = await startBackendWatch({
      workspaceRoot: workspace,
      env,
      onEvent(event) {
        events.push(event);
      },
    });

    try {
      await waitFor(async () =>
        events.some(
          (event) =>
            event.type === 'build-complete' &&
            event.succeeded === true &&
            typeof event.bunBenchmarkDurationMs === 'number' &&
            event.bunBenchmarkDurationMs > 0,
        ),
      );

      const completedEvent = events.find(
        (event) =>
          event.type === 'build-complete' &&
          event.succeeded === true &&
          typeof event.bunBenchmarkDurationMs === 'number',
      );

      assert.equal(completedEvent?.bunBenchmarkSucceeded, true);
      assert.equal(completedEvent?.bunBenchmarkErrorCount, 0);
      assert.ok((completedEvent?.bunBenchmarkDurationMs ?? 0) > 0);
    } finally {
      await handle.stop();
    }
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('startBackendWatch resolves WEBSTIR_WORKSPACE_ROOT outside the workspace cwd when workspaceRoot is omitted', async () => {
  const workspace = await createTempWorkspace('webstir-backend-watch-root-');
  const alternateCwd = await createTempWorkspace('webstir-backend-watch-cwd-');
  const previousCwd = process.cwd();
  await seedBackendEntry(workspace);

  try {
    process.chdir(alternateCwd);

    const handle = await startBackendWatch({
      env: {
        WEBSTIR_MODULE_MODE: 'build',
        WEBSTIR_BACKEND_TYPECHECK: 'skip',
        WEBSTIR_WORKSPACE_ROOT: workspace,
      },
    });

    try {
      await waitFor(async () => {
        try {
          await fs.access(path.join(workspace, '.webstir', 'backend-outputs.json'));
          return true;
        } catch {
          return false;
        }
      });
    } finally {
      await handle.stop();
    }
  } finally {
    process.chdir(previousCwd);
    await fs.rm(alternateCwd, { recursive: true, force: true });
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
