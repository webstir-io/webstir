import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runAddPage } from '../dist/index.js';

async function createWorkspace(pkg) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-frontend-add-page-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
  return root;
}

test('add-page defaults to ssg scaffold when webstir.mode=ssg', async () => {
  const workspace = await createWorkspace({
    name: 'webstir-project',
    version: '1.0.0',
    webstir: { mode: 'ssg' },
  });

  try {
    await runAddPage({ workspaceRoot: workspace, pageName: 'about' });

    const pageDir = path.join(workspace, 'src', 'frontend', 'pages', 'about');
    const htmlPath = path.join(pageDir, 'index.html');
    const cssPath = path.join(pageDir, 'index.css');
    const tsPath = path.join(pageDir, 'index.ts');

    assert.equal(fssync.existsSync(htmlPath), true);
    assert.equal(fssync.existsSync(cssPath), true);
    assert.equal(fssync.existsSync(tsPath), false);

    const html = await fs.readFile(htmlPath, 'utf8');
    assert.ok(
      !html.includes('<script type="module"'),
      'ssg scaffold should not include module script tag',
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('add-page defaults to standard scaffold when webstir.mode is not ssg', async () => {
  const workspace = await createWorkspace({
    name: 'webstir-project',
    version: '1.0.0',
  });

  try {
    await runAddPage({ workspaceRoot: workspace, pageName: '  about  ' });

    const pageDir = path.join(workspace, 'src', 'frontend', 'pages', 'about');
    const htmlPath = path.join(pageDir, 'index.html');
    const tsPath = path.join(pageDir, 'index.ts');

    assert.equal(fssync.existsSync(htmlPath), true);
    assert.equal(fssync.existsSync(tsPath), true);

    const html = await fs.readFile(htmlPath, 'utf8');
    assert.ok(
      html.includes('<script type="module"'),
      'standard scaffold should include module script tag',
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('add-page rejects unsafe and non-portable names before mutating the workspace', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-frontend-add-page-safety-'));
  const workspace = path.join(root, 'workspace');
  const outsideSentinel = path.join(root, 'outside-sentinel.txt');
  const escapedPage = path.join(root, 'escaped-page');
  await fs.mkdir(workspace);
  await fs.writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify({ name: 'webstir-project', version: '1.0.0' }, null, 2),
    'utf8',
  );
  await fs.writeFile(outsideSentinel, 'preserve me\n', 'utf8');

  try {
    for (const pageName of [
      '../../../../escaped-page',
      '..\\..\\..\\..\\escaped-page',
      '.',
      '..',
      '   ',
      'bad\0name',
      'bad\nname',
      'about\n',
      '\tabout',
      'bad\u007fname',
      'foo:bar',
      'foo?bar',
      'foo*bar',
      'foo<bar',
      'foo|bar',
      'name.',
      'NUL',
      'nul.txt',
      'CON',
      'CON .txt',
      'PRN.log',
      'COM1',
      'COM¹.txt',
      'LPT9',
      'LPT³',
      'CONIN$',
      'CONOUT$',
    ]) {
      await assert.rejects(
        runAddPage({ workspaceRoot: workspace, pageName }),
        /non-empty single path segment/,
      );
    }

    assert.equal(fssync.existsSync(escapedPage), false);
    assert.equal(fssync.existsSync(path.join(workspace, '.webstir')), false);
    assert.equal(await fs.readFile(outsideSentinel, 'utf8'), 'preserve me\n');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('add-page rejects a symlinked page root without changing its target', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-frontend-add-page-symlink-'));
  const workspace = path.join(root, 'workspace');
  const outsideRoot = path.join(root, 'outside');
  const pagesRoot = path.join(workspace, 'src', 'frontend', 'pages');
  const outsideSentinel = path.join(outsideRoot, 'sentinel.txt');
  await fs.mkdir(path.dirname(pagesRoot), { recursive: true });
  await fs.mkdir(outsideRoot);
  await fs.writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify({ name: 'webstir-project', version: '1.0.0' }, null, 2),
    'utf8',
  );
  await fs.writeFile(outsideSentinel, 'preserve me\n', 'utf8');
  await fs.symlink(outsideRoot, pagesRoot, process.platform === 'win32' ? 'junction' : 'dir');

  try {
    await assert.rejects(
      runAddPage({ workspaceRoot: workspace, pageName: 'about' }),
      /through symbolic link/,
    );

    assert.equal(fssync.existsSync(path.join(workspace, '.webstir')), false);
    assert.equal(fssync.existsSync(path.join(outsideRoot, 'about')), false);
    assert.equal(await fs.readFile(outsideSentinel, 'utf8'), 'preserve me\n');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('add-page rejects a symlinked src/frontend before reading config or writing metadata', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-frontend-add-page-root-link-'));
  const workspace = path.join(root, 'workspace');
  const outsideFrontend = path.join(root, 'outside-frontend');
  const frontendLink = path.join(workspace, 'src', 'frontend');
  const configPath = path.join(outsideFrontend, 'frontend.config.json');
  const invalidConfig = '{ preserve: "this is deliberately invalid JSON" }\n';
  await fs.mkdir(path.dirname(frontendLink), { recursive: true });
  await fs.mkdir(outsideFrontend);
  await fs.writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify({ name: 'webstir-project', version: '1.0.0' }, null, 2),
    'utf8',
  );
  await fs.writeFile(configPath, invalidConfig, 'utf8');
  await fs.symlink(
    outsideFrontend,
    frontendLink,
    process.platform === 'win32' ? 'junction' : 'dir',
  );

  try {
    await assert.rejects(
      runAddPage({ workspaceRoot: workspace, pageName: 'about' }),
      /through symbolic link: src\/frontend/,
    );

    assert.equal(await fs.readFile(configPath, 'utf8'), invalidConfig);
    assert.equal(fssync.existsSync(path.join(outsideFrontend, 'pages', 'about')), false);
    assert.equal(fssync.existsSync(path.join(workspace, '.webstir')), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('add-page rejects a symlinked frontend config before reading it or writing metadata', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-frontend-add-page-config-link-'));
  const workspace = path.join(root, 'workspace');
  const frontendRoot = path.join(workspace, 'src', 'frontend');
  const outsideConfig = path.join(root, 'outside-frontend.config.json');
  const configSentinel = '{ preserve: "this is deliberately invalid JSON" }\n';
  await fs.mkdir(frontendRoot, { recursive: true });
  await fs.writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify({ name: 'webstir-project', version: '1.0.0' }, null, 2),
    'utf8',
  );
  await fs.writeFile(outsideConfig, configSentinel, 'utf8');
  await fs.symlink(outsideConfig, path.join(frontendRoot, 'frontend.config.json'), 'file');

  try {
    await assert.rejects(
      runAddPage({ workspaceRoot: workspace, pageName: 'about' }),
      /through symbolic link: src\/frontend\/frontend\.config\.json/,
    );

    assert.equal(await fs.readFile(outsideConfig, 'utf8'), configSentinel);
    assert.equal(fssync.existsSync(path.join(workspace, '.webstir')), false);
    assert.equal(fssync.existsSync(path.join(frontendRoot, 'pages', 'about')), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('add-page rejects a non-regular frontend config before writing metadata', async () => {
  const workspace = await createWorkspace({
    name: 'webstir-project',
    version: '1.0.0',
  });
  const configPath = path.join(workspace, 'src', 'frontend', 'frontend.config.json');
  await fs.mkdir(configPath, { recursive: true });

  try {
    await assert.rejects(
      runAddPage({ workspaceRoot: workspace, pageName: 'about' }),
      /metadata path is not a regular file: src\/frontend\/frontend\.config\.json/,
    );

    assert.equal(fssync.existsSync(path.join(workspace, '.webstir')), false);
    assert.equal(
      fssync.existsSync(path.join(workspace, 'src', 'frontend', 'pages', 'about')),
      false,
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('add-page rejects a symlinked .webstir directory before writing the manifest or page', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-frontend-add-page-meta-link-'));
  const workspace = path.join(root, 'workspace');
  const outsideMetadata = path.join(root, 'outside-metadata');
  const manifestPath = path.join(outsideMetadata, 'frontend-manifest.json');
  const manifestSentinel = 'preserve manifest sentinel\n';
  await fs.mkdir(workspace);
  await fs.mkdir(outsideMetadata);
  await fs.writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify({ name: 'webstir-project', version: '1.0.0' }, null, 2),
    'utf8',
  );
  await fs.writeFile(manifestPath, manifestSentinel, 'utf8');
  await fs.symlink(
    outsideMetadata,
    path.join(workspace, '.webstir'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );

  try {
    await assert.rejects(
      runAddPage({ workspaceRoot: workspace, pageName: 'about' }),
      /through symbolic link: \.webstir/,
    );

    assert.equal(await fs.readFile(manifestPath, 'utf8'), manifestSentinel);
    assert.equal(
      fssync.existsSync(path.join(workspace, 'src', 'frontend', 'pages', 'about')),
      false,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('add-page rejects a symlinked package.json before reading it or mutating the workspace', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-frontend-add-page-pkg-link-'));
  const workspace = path.join(root, 'workspace');
  const outsidePackage = path.join(root, 'outside-package.json');
  const packageSentinel = '{ preserve: "this is deliberately invalid JSON" }\n';
  await fs.mkdir(workspace);
  await fs.writeFile(outsidePackage, packageSentinel, 'utf8');
  await fs.symlink(outsidePackage, path.join(workspace, 'package.json'), 'file');

  try {
    await assert.rejects(
      runAddPage({ workspaceRoot: workspace, pageName: 'about' }),
      /through symbolic link: package\.json/,
    );

    assert.equal(await fs.readFile(outsidePackage, 'utf8'), packageSentinel);
    assert.equal(fssync.existsSync(path.join(workspace, '.webstir')), false);
    assert.equal(
      fssync.existsSync(path.join(workspace, 'src', 'frontend', 'pages', 'about')),
      false,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('add-page rejects an existing page without rewriting scaffold metadata', async () => {
  const workspace = await createWorkspace({
    name: 'webstir-project',
    version: '1.0.0',
  });
  const pageDir = path.join(workspace, 'src', 'frontend', 'pages', 'about');
  const manifestPath = path.join(workspace, '.webstir', 'frontend-manifest.json');
  const manifestSentinel = 'preserve existing manifest\n';
  await fs.mkdir(pageDir, { recursive: true });
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, manifestSentinel, 'utf8');

  try {
    await assert.rejects(
      runAddPage({ workspaceRoot: workspace, pageName: 'about' }),
      /Page 'about' already exists/,
    );

    assert.equal(await fs.readFile(manifestPath, 'utf8'), manifestSentinel);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('add-page rejects malformed package metadata before rewriting the scaffold manifest', async () => {
  const workspace = await createWorkspace({
    name: 'webstir-project',
    version: '1.0.0',
  });
  const packageJsonPath = path.join(workspace, 'package.json');
  const pageDir = path.join(workspace, 'src', 'frontend', 'pages', 'about');
  const manifestPath = path.join(workspace, '.webstir', 'frontend-manifest.json');
  const packageSentinel = '{ deliberately invalid package JSON }\n';
  const manifestSentinel = 'preserve existing manifest\n';
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(packageJsonPath, packageSentinel, 'utf8');
  await fs.writeFile(manifestPath, manifestSentinel, 'utf8');

  try {
    await assert.rejects(runAddPage({ workspaceRoot: workspace, pageName: 'about' }));

    assert.equal(await fs.readFile(packageJsonPath, 'utf8'), packageSentinel);
    assert.equal(await fs.readFile(manifestPath, 'utf8'), manifestSentinel);
    assert.equal(fssync.existsSync(pageDir), false);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('add-page escapes display text for portable page names', async () => {
  const workspace = await createWorkspace({
    name: 'webstir-project',
    version: '1.0.0',
  });
  const pageName = 'Research & Development';

  try {
    await runAddPage({ workspaceRoot: workspace, pageName });

    const pageDir = path.join(workspace, 'src', 'frontend', 'pages', pageName);
    const html = await fs.readFile(path.join(pageDir, 'index.html'), 'utf8');
    const css = await fs.readFile(path.join(pageDir, 'index.css'), 'utf8');

    assert.ok(html.includes('<title>Research &amp; Development</title>'));
    assert.equal(html.includes('<title>Research & Development</title>'), false);
    assert.ok(css.startsWith('/* Research & Development Page Styles */\n'));
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
