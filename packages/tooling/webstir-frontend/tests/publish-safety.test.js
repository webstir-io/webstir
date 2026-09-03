import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { frontendProvider } from '../dist/index.js';

async function createWorkspace({ header = false, explicitStickyHeader = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-frontend-publish-safety-'));
  const appDir = path.join(root, 'src', 'frontend', 'app');
  const pageDir = path.join(root, 'src', 'frontend', 'pages', 'home');
  await fs.mkdir(appDir, { recursive: true });
  await fs.mkdir(pageDir, { recursive: true });
  await fs.writeFile(
    path.join(appDir, 'app.html'),
    `<!doctype html><html><head><link rel="stylesheet" href="/app/app.css"></head><body>${header ? '<header class="app-header"></header>' : '<aside class="app-sidebar"></aside>'}<main></main></body></html>`,
  );
  await fs.writeFile(path.join(appDir, 'app.css'), 'body { color: #111; }');
  await fs.writeFile(
    path.join(pageDir, 'index.html'),
    '<head><link rel="stylesheet" href="index.css"></head><main>Home</main>',
  );
  await fs.writeFile(path.join(pageDir, 'index.css'), '@import "@app/app.css";');
  if (explicitStickyHeader) {
    await fs.writeFile(
      path.join(root, 'src', 'frontend', 'frontend.config.json'),
      JSON.stringify({ shell: { stickyHeader: true } }),
    );
  }
  return root;
}

async function publish(workspace, extraEnv = {}) {
  await frontendProvider.build({
    workspaceRoot: workspace,
    env: { WEBSTIR_MODULE_MODE: 'build', ...extraEnv },
    incremental: false,
  });
  return frontendProvider.build({
    workspaceRoot: workspace,
    env: { WEBSTIR_MODULE_MODE: 'publish', ...extraEnv },
    incremental: false,
  });
}

async function readPublishedHome(workspace) {
  return fs.readFile(
    path.join(workspace, 'dist', 'frontend', 'pages', 'home', 'index.html'),
    'utf8',
  );
}

test('standard app-header shell retains sticky header body spacing', async () => {
  const workspace = await createWorkspace({ header: true });
  try {
    await publish(workspace);
    const html = await readPublishedHome(workspace);
    assert.match(html, /padding-top:var\(--ws-header-sticky-offset,0\)/);
    assert.match(html, /\.app-header\{position:fixed/);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('sidebar-only shell receives no artificial sticky header spacing', async () => {
  const workspace = await createWorkspace();
  try {
    await publish(workspace);
    const html = await readPublishedHome(workspace);
    assert.doesNotMatch(html, /padding-top:var\(--ws-header-sticky-offset/);
    assert.doesNotMatch(html, /\.app-header\{position:fixed/);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('explicit sticky-header shell configuration retains spacing without standard markup', async () => {
  const workspace = await createWorkspace({ explicitStickyHeader: true });
  try {
    await publish(workspace);
    const html = await readPublishedHome(workspace);
    assert.match(html, /padding-top:var\(--ws-header-sticky-offset,0\)/);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('publish rejects an unresolved TypeScript browser entry reference', async () => {
  const workspace = await createWorkspace();
  try {
    const pageHtml = path.join(workspace, 'src', 'frontend', 'pages', 'home', 'index.html');
    await fs.writeFile(
      pageHtml,
      '<head><script type="module" src="index.ts"></script></head><main>Home</main>',
    );
    await assert.rejects(
      publish(workspace),
      /Published HTML references browser-invalid source entry.*index\.ts/i,
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('publish rejects unresolved local assets in emitted HTML', async () => {
  const workspace = await createWorkspace();
  try {
    const pageHtml = path.join(workspace, 'src', 'frontend', 'pages', 'home', 'index.html');
    await fs.writeFile(pageHtml, '<head></head><main><img src="missing.svg" alt=""></main>');
    await assert.rejects(
      publish(workspace),
      /Published HTML references missing local asset.*missing\.svg/i,
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
