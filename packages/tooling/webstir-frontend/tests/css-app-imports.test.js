import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function loadProviderOrSkip(t) {
  try {
    const mod = await import('../dist/index.js');
    return mod.frontendProvider;
  } catch (err) {
    console.warn(
      '[frontend-tests] Skipping provider integration: optional dependency unavailable:',
      err?.message ?? err,
    );
    t?.diagnostic?.('skip: missing optional dependency');
    return null;
  }
}

async function createWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-frontend-css-'));
  const appDir = path.join(root, 'src', 'frontend', 'app');
  const stylesDir = path.join(appDir, 'styles');
  const pageDir = path.join(root, 'src', 'frontend', 'pages', 'home');
  await fs.mkdir(stylesDir, { recursive: true });
  await fs.mkdir(pageDir, { recursive: true });

  await fs.writeFile(
    path.join(appDir, 'app.html'),
    '<!DOCTYPE html><html><head><title>App</title></head><body><main></main></body></html>',
    'utf8',
  );
  await fs.writeFile(
    path.join(appDir, 'app.css'),
    ['@layer reset, base;', '@import "./styles/base.css";'].join('\n'),
    'utf8',
  );
  await fs.writeFile(
    path.join(stylesDir, 'base.css'),
    '@layer base { body { background: blue; } }',
    'utf8',
  );
  await fs.writeFile(
    path.join(pageDir, 'index.html'),
    '<head></head><main><section>Home</section></main>',
    'utf8',
  );
  await fs.writeFile(path.join(pageDir, 'index.css'), '@import "@app/app.css";', 'utf8');

  return root;
}

async function publishWorkspace(workspace, frontendProvider) {
  await frontendProvider.build({
    workspaceRoot: workspace,
    env: { WEBSTIR_MODULE_MODE: 'publish' },
    incremental: false,
  });

  const distRoot = path.join(workspace, 'dist', 'frontend');
  const manifest = JSON.parse(await fs.readFile(path.join(distRoot, 'manifest.json'), 'utf8'));
  const appCssFile = manifest.shared?.css;
  assert.match(appCssFile ?? '', /^app-[a-f0-9]+\.css$/i);
  return {
    css: await fs.readFile(path.join(distRoot, 'app', appCssFile), 'utf8'),
    distRoot,
  };
}

async function createRecursiveImportWorkspace() {
  const root = await createWorkspace();
  const appDir = path.join(root, 'src', 'frontend', 'app');
  const stylesDir = path.join(appDir, 'styles');
  const sldsDir = path.join(stylesDir, 'slds');
  const primitivesDir = path.join(sldsDir, 'primitives');
  await fs.mkdir(primitivesDir, { recursive: true });

  await fs.writeFile(
    path.join(appDir, 'app.css'),
    ['@layer tokens, base, primitives, utilities;', '@import "./styles/slds/slds.css";'].join('\n'),
    'utf8',
  );
  await fs.writeFile(
    path.join(sldsDir, 'slds.css'),
    [
      '@import "./tokens.css" layer(tokens);',
      '@import "./base.css" layer(base);',
      '@import "./primitives.css" layer(primitives);',
      '@import "./utilities.css" layer(utilities);',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(sldsDir, 'tokens.css'), ':root { --slds-panel: #123456; }', 'utf8');
  await fs.writeFile(path.join(sldsDir, 'base.css'), 'body { color: var(--slds-panel); }', 'utf8');
  await fs.writeFile(
    path.join(sldsDir, 'primitives.css'),
    [
      '@import "./primitives/surface.css" supports(display: grid);',
      '@import "./primitives/responsive.css" screen and (min-width: 40rem);',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(
    path.join(primitivesDir, 'surface.css'),
    '@import "./depth.css"; .surface { display: grid; }',
    'utf8',
  );
  await fs.writeFile(path.join(primitivesDir, 'depth.css'), '.depth { box-shadow: none; }', 'utf8');
  await fs.writeFile(
    path.join(primitivesDir, 'responsive.css'),
    '.responsive { display: block; }',
    'utf8',
  );
  await fs.writeFile(path.join(sldsDir, 'utilities.css'), '.utility { margin: 0; }', 'utf8');

  return root;
}

test('development app.css import URLs include a cache-busting version', async (t) => {
  const frontendProvider = await loadProviderOrSkip(t);
  if (!frontendProvider) return;
  const workspace = await createWorkspace();

  try {
    await frontendProvider.build({
      workspaceRoot: workspace,
      env: { WEBSTIR_MODULE_MODE: 'build' },
      incremental: false,
    });

    const appCssPath = path.join(workspace, 'build', 'frontend', 'app', 'app.css');
    assert.equal(fssync.existsSync(appCssPath), true, `expected ${appCssPath}`);

    const appCss = await fs.readFile(appCssPath, 'utf8');
    assert.match(appCss, /@import\s+["']\.\/styles\/base\.css\?v=[a-f0-9]+["'];/i);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('production app CSS recursively inlines relative imports with qualifiers', async (t) => {
  const frontendProvider = await loadProviderOrSkip(t);
  if (!frontendProvider) return;
  const workspace = await createRecursiveImportWorkspace();

  try {
    const { css, distRoot } = await publishWorkspace(workspace, frontendProvider);

    assert.match(css, /--slds-panel:#123456/);
    assert.match(css, /body\{color:var\(--slds-panel\)\}/);
    assert.match(css, /\.surface\{display:grid\}/);
    assert.match(css, /\.depth\{box-shadow:none\}/);
    assert.match(css, /\.responsive\{display:block\}/);
    assert.match(css, /\.utility\{margin:0\}/);
    assert.match(css, /@layer tokens\{/);
    assert.match(css, /@layer base\{/);
    assert.match(css, /@layer primitives\{/);
    assert.match(css, /@layer utilities\{/);
    assert.match(css, /@supports\s*\(display:grid\)/);
    assert.match(css, /@media screen and \(min-width:40rem\)/);
    assert.doesNotMatch(css, /@import\s/i);

    const emittedSldsDir = path.join(distRoot, 'app', 'styles', 'slds');
    const emittedSldsFile = (await fs.readdir(emittedSldsDir)).find((file) =>
      /^slds-[a-f0-9]+\.css$/i.test(file),
    );
    assert.ok(emittedSldsFile, 'expected a hashed SLDS stylesheet asset');
    const emittedSlds = await fs.readFile(path.join(emittedSldsDir, emittedSldsFile), 'utf8');
    assert.match(emittedSlds, /--slds-panel:#123456/);
    assert.match(emittedSlds, /\.depth\{box-shadow:none\}/);
    assert.doesNotMatch(emittedSlds, /@import\s/i);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('production app CSS rejects circular local imports', async (t) => {
  const frontendProvider = await loadProviderOrSkip(t);
  if (!frontendProvider) return;
  const workspace = await createWorkspace();
  const stylesDir = path.join(workspace, 'src', 'frontend', 'app', 'styles');

  try {
    await fs.writeFile(path.join(stylesDir, 'base.css'), '@import "./cycle.css";', 'utf8');
    await fs.writeFile(path.join(stylesDir, 'cycle.css'), '@import "./base.css";', 'utf8');

    await assert.rejects(
      publishWorkspace(workspace, frontendProvider),
      /Circular CSS @import.*base\.css.*cycle\.css.*base\.css/i,
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('production app CSS rejects imports outside the app styles root', async (t) => {
  const frontendProvider = await loadProviderOrSkip(t);
  if (!frontendProvider) return;
  const workspace = await createWorkspace();
  const appDir = path.join(workspace, 'src', 'frontend', 'app');
  const stylesDir = path.join(appDir, 'styles');

  try {
    await fs.writeFile(path.join(appDir, 'outside.css'), '.outside { color: red; }', 'utf8');
    await fs.writeFile(path.join(stylesDir, 'base.css'), '@import "../outside.css";', 'utf8');

    await assert.rejects(
      publishWorkspace(workspace, frontendProvider),
      /CSS @import escapes the permitted stylesheet root.*outside\.css/i,
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
