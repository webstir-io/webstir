import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { runAddRoute } from '../dist/add.js';
import { loadBackendModuleManifest } from '../dist/manifest/pipeline.js';
import { loadModuleRuntime } from '../dist/runtime/core.js';
import { reconcileRouteSessionMetadata } from '../dist/runtime/route-metadata.js';

async function createWorkspace(moduleSource) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-route-metadata-'));
  const buildRoot = path.join(root, 'build', 'backend');
  await fs.mkdir(buildRoot, { recursive: true });
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'route-metadata',
      version: '1.0.0',
      type: 'module',
      webstir: { mode: 'api' },
    }),
    'utf8',
  );
  await runAddRoute({
    workspaceRoot: root,
    name: 'account',
    method: 'POST',
    path: '/api/account',
    sessionMode: 'required',
  });
  await fs.writeFile(path.join(buildRoot, 'module.mjs'), moduleSource, 'utf8');
  return { root, buildRoot };
}

function inlineModule(definition) {
  return `export const module = { manifest: {}, routes: [{ definition: ${JSON.stringify(definition)}, handler: () => ({ status: 200, body: 'handler ran' }) }] };`;
}

test('add-route session metadata is applied to the matching inline handler in inspect and runtime', async () => {
  const { root, buildRoot } = await createWorkspace(
    inlineModule({ name: 'account', method: 'POST', path: '/api/account' }),
  );
  try {
    const diagnostics = [];
    const inspected = await loadBackendModuleManifest({
      workspaceRoot: root,
      buildRoot,
      entryPoints: ['index.js'],
      diagnostics,
    });
    assert.deepEqual(inspected.routes[0].session, { mode: 'required' });
    assert.equal(diagnostics.filter((d) => d.severity === 'warn').length, 0);

    const runtime = await loadModuleRuntime({
      importMetaUrl: pathToFileURL(path.join(buildRoot, 'index.js')).href,
      candidates: ['module.mjs'],
      workspaceRoot: root,
    });
    assert.deepEqual(runtime.routes[0].definition.session, { mode: 'required' });
    assert.deepEqual(runtime.warnings, []);

    // Without a workspace root the runtime keeps the inline definition untouched.
    const unreconciled = await loadModuleRuntime({
      importMetaUrl: pathToFileURL(path.join(buildRoot, 'index.js')).href,
      candidates: ['module.mjs'],
    });
    assert.equal(unreconciled.routes[0].definition.session, undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('conflicting session modes resolve to required and report a warning', async () => {
  const { root, buildRoot } = await createWorkspace(
    inlineModule({
      name: 'account',
      method: 'POST',
      path: '/api/account',
      session: { mode: 'optional', write: true },
    }),
  );
  try {
    const diagnostics = [];
    const inspected = await loadBackendModuleManifest({
      workspaceRoot: root,
      buildRoot,
      entryPoints: ['index.js'],
      diagnostics,
    });
    assert.deepEqual(inspected.routes[0].session, { mode: 'required', write: true });
    const warnings = diagnostics.filter((d) => d.severity === 'warn').map((d) => d.message);
    assert.equal(warnings.length, 1);
    assert.match(
      warnings[0],
      /POST \/api\/account declares session\.mode 'optional' in module\.ts but session\.mode 'required' in package\.json/,
    );

    const runtime = await loadModuleRuntime({
      importMetaUrl: pathToFileURL(path.join(buildRoot, 'index.js')).href,
      candidates: ['module.mjs'],
      workspaceRoot: root,
    });
    assert.deepEqual(runtime.routes[0].definition.session, { mode: 'required', write: true });
    assert.equal(runtime.warnings.length, 1);
    assert.match(runtime.warnings[0], /using 'required'/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('reconcileRouteSessionMetadata leaves routes alone without a declared session', () => {
  const inline = { name: 'x', method: 'GET', path: '/x', session: { mode: 'optional' } };
  const result = reconcileRouteSessionMetadata(inline, { name: 'x', method: 'GET', path: '/x' });
  assert.equal(result.definition, inline);
  assert.deepEqual(result.warnings, []);

  const filled = reconcileRouteSessionMetadata(
    { name: 'y', method: 'GET', path: '/y' },
    { session: { mode: 'required', write: true } },
  );
  assert.deepEqual(filled.definition.session, { mode: 'required', write: true });
  assert.deepEqual(filled.warnings, []);
});

test('a package-level optional mode cannot loosen an inline form.session requirement', async () => {
  const { root, buildRoot } = await createWorkspace(
    inlineModule({
      name: 'account',
      method: 'POST',
      path: '/api/account',
      form: { contentType: 'application/x-www-form-urlencoded', session: { mode: 'required' } },
    }),
  );
  try {
    // Flip the CLI-authored declaration to optional to create the conflict.
    const pkgPath = path.join(root, 'package.json');
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
    pkg.webstir.moduleManifest.routes[0].session = { mode: 'optional' };
    await fs.writeFile(pkgPath, JSON.stringify(pkg), 'utf8');

    const diagnostics = [];
    const inspected = await loadBackendModuleManifest({
      workspaceRoot: root,
      buildRoot,
      entryPoints: ['index.js'],
      diagnostics,
    });
    assert.deepEqual(inspected.routes[0].session, { mode: 'required' });
    assert.deepEqual(inspected.routes[0].form.session, { mode: 'required' });
    const warnings = diagnostics.filter((d) => d.severity === 'warn').map((d) => d.message);
    assert.equal(warnings.length, 1);
    assert.match(
      warnings[0],
      /declares form\.session\.mode 'required' in module\.ts but session\.mode 'optional' in package\.json/,
    );

    const runtime = await loadModuleRuntime({
      importMetaUrl: pathToFileURL(path.join(buildRoot, 'index.js')).href,
      candidates: ['module.mjs'],
      workspaceRoot: root,
    });
    assert.deepEqual(runtime.routes[0].definition.session, { mode: 'required' });
    assert.equal(runtime.warnings.length, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('matching inline form.session and package-level modes reconcile without a warning', () => {
  const inline = {
    name: 'x',
    method: 'POST',
    path: '/x',
    form: { session: { mode: 'required', write: true } },
  };
  const result = reconcileRouteSessionMetadata(inline, { session: { mode: 'required' } });
  assert.deepEqual(result.definition.session, { mode: 'required' });
  assert.deepEqual(result.definition.form.session, { mode: 'required', write: true });
  assert.deepEqual(result.warnings, []);
});
