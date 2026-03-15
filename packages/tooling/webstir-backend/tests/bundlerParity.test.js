import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { backendProvider } from '../dist/index.js';

async function createTempWorkspace(prefix = 'webstir-backend-bundler-parity-') {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function copyFile(src, dest) {
  await ensureDir(path.dirname(dest));
  await fs.copyFile(src, dest);
}

function getPackageRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..');
}

async function hydrateBackendScaffold(workspace) {
  const assets = await backendProvider.getScaffoldAssets();

  for (const asset of assets) {
    const normalized = asset.targetPath.replace(/\\/g, '/');
    if (!normalized.includes('src/backend/')) {
      continue;
    }

    const target = path.join(workspace, asset.targetPath);
    await copyFile(asset.sourcePath, target);
  }
}

async function listRelativeFiles(root) {
  const collected = [];

  async function walk(current, prefix = '') {
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return;
      }
      throw error;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relativePath = prefix ? path.posix.join(prefix, entry.name) : entry.name;
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
        continue;
      }
      collected.push(relativePath);
    }
  }

  await walk(root);
  return collected;
}

async function readCachedOutputPaths(workspace) {
  const cachePath = path.join(workspace, '.webstir', 'backend-outputs.json');
  try {
    const raw = await fs.readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Object.keys(parsed).sort();
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function selectPrimaryArtifactPaths(paths) {
  return paths.filter((relativePath) => {
    return (
      /(^|\/)index\.js(\.map)?$/.test(relativePath) ||
      relativePath === 'module.js' ||
      relativePath === 'module.js.map' ||
      relativePath === 'env.js' ||
      relativePath === 'env.js.map'
    );
  });
}

async function snapshotWorkspaceBuild(workspace, entryPoints) {
  const buildRoot = path.join(workspace, 'build', 'backend');
  const artifactPaths = await listRelativeFiles(buildRoot);

  return {
    entryPoints: [...entryPoints].sort(),
    artifactPaths,
    primaryArtifactPaths: selectPrimaryArtifactPaths(artifactPaths).sort(),
    cachedOutputPaths: await readCachedOutputPaths(workspace)
  };
}

async function buildWithNodeProvider(workspace, env) {
  const result = await backendProvider.build({
    workspaceRoot: workspace,
    env,
    incremental: false
  });
  return await snapshotWorkspaceBuild(workspace, result.manifest.entryPoints);
}

async function buildWithBunProvider(workspace, env) {
  const packageRoot = getPackageRoot();
  const moduleUrl = pathToFileURL(path.join(packageRoot, 'dist', 'index.js')).href;
  const script = `
const workspace = process.argv[1];
const env = JSON.parse(process.argv[2]);
const { backendProvider } = await import(${JSON.stringify(moduleUrl)});
const result = await backendProvider.build({ workspaceRoot: workspace, env, incremental: false });
const errors = result.manifest.diagnostics.filter((entry) => entry.severity === 'error');
if (errors.length > 0) {
  console.error('__ERROR__' + JSON.stringify(errors));
  process.exit(1);
}
console.log('__RESULT__' + JSON.stringify({ entryPoints: result.manifest.entryPoints }));
`;

  const child = spawn('bun', ['--eval', script, workspace, JSON.stringify(env)], {
    cwd: packageRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });

  const resultLine = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('__RESULT__'))
    .at(-1);

  if (exitCode !== 0 || !resultLine) {
    throw new Error(`bun build parity harness failed (exit=${exitCode ?? 'null'})\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }

  const payload = JSON.parse(resultLine.slice('__RESULT__'.length));
  return await snapshotWorkspaceBuild(workspace, payload.entryPoints ?? []);
}

async function compareBundlerSnapshots(mode, extraEnv = {}) {
  const esbuildWorkspace = await createTempWorkspace(`${mode}-esbuild-`);
  const bunWorkspace = await createTempWorkspace(`${mode}-bun-`);
  await hydrateBackendScaffold(esbuildWorkspace);
  await hydrateBackendScaffold(bunWorkspace);

  const baseEnv = {
    WEBSTIR_MODULE_MODE: mode,
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
    ...extraEnv
  };

  const esbuildSnapshot = await buildWithNodeProvider(esbuildWorkspace, baseEnv);
  const bunSnapshot = await buildWithBunProvider(bunWorkspace, {
    ...baseEnv,
    WEBSTIR_BACKEND_BUNDLER: 'bun'
  });

  assert.deepEqual(bunSnapshot.entryPoints, esbuildSnapshot.entryPoints, `${mode}: entry points should stay aligned`);
  assert.deepEqual(
    bunSnapshot.cachedOutputPaths,
    esbuildSnapshot.cachedOutputPaths,
    `${mode}: cached output accounting should stay aligned`
  );
  assert.deepEqual(
    bunSnapshot.primaryArtifactPaths,
    esbuildSnapshot.primaryArtifactPaths,
    `${mode}: primary emitted artifacts should stay aligned`
  );
}

test('build mode Bun bundler preserves artifact accounting parity', async () => {
  await compareBundlerSnapshots('build');
});

test('publish mode Bun bundler preserves artifact accounting parity with sourcemaps enabled', async () => {
  await compareBundlerSnapshots('publish', {
    WEBSTIR_BACKEND_SOURCEMAPS: 'on'
  });
});
