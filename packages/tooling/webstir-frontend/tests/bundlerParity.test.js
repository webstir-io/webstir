import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { frontendProvider } from '../dist/index.js';

async function createWorkspace(prefix = 'webstir-frontend-bundler-parity-') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const appDir = path.join(root, 'src', 'frontend', 'app');
  const appScriptsDir = path.join(appDir, 'scripts');
  const pageDir = path.join(root, 'src', 'frontend', 'pages', 'home');

  await fs.mkdir(appScriptsDir, { recursive: true });
  await fs.mkdir(pageDir, { recursive: true });

  await fs.writeFile(
    path.join(appDir, 'app.html'),
    '<!DOCTYPE html><html><head><title>App</title></head><body><main></main><script type="module" src="/app/app.js"></script></body></html>',
    'utf8'
  );
  await fs.writeFile(path.join(appScriptsDir, 'boot.ts'), 'export const boot = "ready";\n', 'utf8');
  await fs.writeFile(path.join(appDir, 'app.ts'), 'import { boot } from "./scripts/boot"; console.log(boot);\n', 'utf8');
  await fs.writeFile(path.join(pageDir, 'index.html'), '<head></head><main><section>Home</section></main>', 'utf8');
  await fs.writeFile(path.join(pageDir, 'message.ts'), 'export const message = "home";\n', 'utf8');
  await fs.writeFile(path.join(pageDir, 'index.ts'), 'import { message } from "./message"; console.log(message);\n', 'utf8');

  return root;
}

function getPackageRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..');
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

async function readJsonOrNull(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function snapshotWorkspace(workspace, entryPoints) {
  const buildRoot = path.join(workspace, 'build', 'frontend');
  const distRoot = path.join(workspace, 'dist', 'frontend');
  const sharedManifest = await readJsonOrNull(path.join(distRoot, 'manifest.json'));
  const pageManifest = await readJsonOrNull(path.join(distRoot, 'pages', 'home', 'manifest.json'));

  const sharedJs = sharedManifest?.shared?.js;
  const pageJs = pageManifest?.pages?.home?.js;

  assert.match(sharedJs ?? '', /^app-[a-z0-9]+\.js$/i, 'expected hashed shared app bundle');
  assert.match(pageJs ?? '', /^index-[a-z0-9]+\.js$/i, 'expected hashed page bundle');
  await fs.access(path.join(distRoot, 'app', sharedJs));
  await fs.access(path.join(distRoot, 'pages', 'home', pageJs));

  return {
    entryPoints: [...entryPoints].sort(),
    buildFiles: await listRelativeFiles(buildRoot),
    distFiles: (await listRelativeFiles(distRoot)).map(normalizeHashedPath),
    sharedJs: normalizeHashedName(sharedJs),
    pageJs: normalizeHashedName(pageJs)
  };
}

function normalizeHashedPath(relativePath) {
  return relativePath
    .replace(/app-[a-z0-9]+\.js$/i, 'app-[hash].js')
    .replace(/app-[a-z0-9]+\.js\.(br|gz)$/i, 'app-[hash].js.$1')
    .replace(/index-[a-z0-9]+\.js$/i, 'index-[hash].js')
    .replace(/index-[a-z0-9]+\.js\.(br|gz)$/i, 'index-[hash].js.$1');
}

function normalizeHashedName(fileName) {
  return normalizeHashedPath(fileName ?? '');
}

async function runWithNodeProvider(workspace) {
  const buildResult = await frontendProvider.build({
    workspaceRoot: workspace,
    env: { WEBSTIR_MODULE_MODE: 'build' },
    incremental: false
  });
  const publishResult = await frontendProvider.build({
    workspaceRoot: workspace,
    env: { WEBSTIR_MODULE_MODE: 'publish' },
    incremental: false
  });

  return await snapshotWorkspace(workspace, publishResult.manifest.entryPoints.length > 0
    ? publishResult.manifest.entryPoints
    : buildResult.manifest.entryPoints);
}

async function runWithBunProvider(workspace) {
  const packageRoot = getPackageRoot();
  const moduleUrl = pathToFileURL(path.join(packageRoot, 'dist', 'index.js')).href;
  const script = `
const workspace = process.argv[1];
const { frontendProvider } = await import(${JSON.stringify(moduleUrl)});
const buildResult = await frontendProvider.build({
  workspaceRoot: workspace,
  env: { WEBSTIR_MODULE_MODE: 'build', WEBSTIR_FRONTEND_BUNDLER: 'bun' },
  incremental: false
});
const publishResult = await frontendProvider.build({
  workspaceRoot: workspace,
  env: { WEBSTIR_MODULE_MODE: 'publish', WEBSTIR_FRONTEND_BUNDLER: 'bun' },
  incremental: false
});
const payload = {
  entryPoints: publishResult.manifest.entryPoints.length > 0
    ? publishResult.manifest.entryPoints
    : buildResult.manifest.entryPoints
};
console.log('__RESULT__' + JSON.stringify(payload));
`;

  const child = spawn('bun', ['--eval', script, workspace], {
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
    throw new Error(`bun frontend parity harness failed (exit=${exitCode ?? 'null'})\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }

  const payload = JSON.parse(resultLine.slice('__RESULT__'.length));
  return await snapshotWorkspace(workspace, payload.entryPoints ?? []);
}

async function compareBundlerSnapshots() {
  const esbuildWorkspace = await createWorkspace('webstir-frontend-esbuild-');
  const bunWorkspace = await createWorkspace('webstir-frontend-bun-');

  const esbuildSnapshot = await runWithNodeProvider(esbuildWorkspace);
  const bunSnapshot = await runWithBunProvider(bunWorkspace);

  return { esbuildSnapshot, bunSnapshot };
}

test('build mode Bun bundler preserves frontend build output shape', async () => {
  const { esbuildSnapshot, bunSnapshot } = await compareBundlerSnapshots();

  assert.deepEqual(bunSnapshot.entryPoints, esbuildSnapshot.entryPoints, 'build manifest entry points should stay aligned');
  assert.deepEqual(bunSnapshot.buildFiles, esbuildSnapshot.buildFiles, 'build/frontend output shape should stay aligned');
});

test('publish mode Bun bundler preserves frontend filename/hash resolution parity', async () => {
  const { esbuildSnapshot, bunSnapshot } = await compareBundlerSnapshots();

  assert.deepEqual(bunSnapshot.distFiles, esbuildSnapshot.distFiles, 'dist/frontend output shape should stay aligned');
  assert.equal(bunSnapshot.sharedJs, esbuildSnapshot.sharedJs, 'shared app bundle name should keep the same hashed shape');
  assert.equal(bunSnapshot.pageJs, esbuildSnapshot.pageJs, 'page bundle name should keep the same hashed shape');
});
