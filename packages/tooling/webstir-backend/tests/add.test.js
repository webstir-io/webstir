import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { backendProvider, runAddJob, runAddRoute, runUpdateRouteContract } from '../dist/index.js';

async function createTempWorkspace(prefix = 'webstir-backend-add-') {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function copyAssetByTarget(workspace, targetPath) {
  const assets = await backendProvider.getScaffoldAssets();
  const asset = assets.find((entry) => entry.targetPath === targetPath);
  assert.ok(asset, `expected scaffold asset ${targetPath}`);
  const destination = path.join(workspace, targetPath);
  await ensureDir(path.dirname(destination));
  await fs.copyFile(asset.sourcePath, destination);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

test('runAddRoute writes manifest metadata without scaffolding server-specific files', async () => {
  const workspace = await createTempWorkspace();

  await fs.writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify(
      {
        name: '@demo/api',
        version: '1.0.0',
        type: 'module',
        webstir: { mode: 'api', moduleManifest: {} },
      },
      null,
      2,
    ),
    'utf8',
  );

  const result = await runAddRoute({
    workspaceRoot: workspace,
    name: 'accounts',
    method: 'POST',
    path: '/api/accounts',
    summary: 'List accounts',
    description: 'Returns the current account list',
    tags: ['accounts', 'api', 'accounts'],
    interaction: 'mutation',
    sessionMode: 'required',
    sessionWrite: true,
    formUrlEncoded: true,
    formCsrf: true,
    fragmentTarget: 'accounts-panel',
    fragmentMode: 'replace',
    paramsSchema: 'zod:AccountParams@src/shared/contracts/accounts.ts',
    responseSchema: 'AccountList@src/shared/contracts/accounts.ts',
    responseStatus: '201',
  });

  assert.equal(result.subject, 'route');
  assert.ok(result.changes.includes('package.json'));
  assert.deepEqual(result.changes, ['package.json']);

  const pkg = await readJson(path.join(workspace, 'package.json'));
  assert.deepEqual(pkg.webstir.moduleManifest.routes, [
    {
      name: 'accounts',
      method: 'POST',
      path: '/api/accounts',
      summary: 'List accounts',
      description: 'Returns the current account list',
      tags: ['accounts', 'api'],
      interaction: 'mutation',
      session: {
        mode: 'required',
        write: true,
      },
      form: {
        contentType: 'application/x-www-form-urlencoded',
        csrf: true,
      },
      fragment: {
        target: 'accounts-panel',
        mode: 'replace',
      },
      input: {
        params: {
          kind: 'zod',
          name: 'AccountParams',
          source: 'src/shared/contracts/accounts.ts',
        },
      },
      output: {
        body: {
          kind: 'zod',
          name: 'AccountList',
          source: 'src/shared/contracts/accounts.ts',
        },
        status: 201,
      },
    },
  ]);
});

test('runAddRoute preserves interaction, session, form, and fragment metadata', async () => {
  const workspace = await createTempWorkspace('webstir-backend-add-route-metadata-');

  await fs.writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify(
      {
        name: '@demo/api',
        version: '1.0.0',
        type: 'module',
        webstir: { mode: 'api', moduleManifest: {} },
      },
      null,
      2,
    ),
    'utf8',
  );

  const result = await runAddRoute({
    workspaceRoot: workspace,
    name: 'session-sign-in',
    method: 'POST',
    path: '/session/sign-in',
    interaction: 'mutation',
    sessionMode: 'required',
    sessionWrite: true,
    formUrlEncoded: true,
    formCsrf: true,
    fragmentTarget: 'session-panel',
    fragmentSelector: '#session-panel',
    fragmentMode: 'replace',
  });

  assert.equal(result.subject, 'route');
  assert.deepEqual(result.changes, ['package.json']);

  const pkg = await readJson(path.join(workspace, 'package.json'));
  assert.deepEqual(pkg.webstir.moduleManifest.routes, [
    {
      name: 'session-sign-in',
      method: 'POST',
      path: '/session/sign-in',
      interaction: 'mutation',
      session: {
        mode: 'required',
        write: true,
      },
      form: {
        contentType: 'application/x-www-form-urlencoded',
        csrf: true,
      },
      fragment: {
        target: 'session-panel',
        selector: '#session-panel',
        mode: 'replace',
      },
    },
  ]);
});

test('runAddJob writes a job scaffold and preserves description in a valid manifest', async () => {
  const workspace = await createTempWorkspace('webstir-backend-add-job-');

  await copyAssetByTarget(workspace, path.join('src', 'backend', 'index.ts'));
  await fs.writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify(
      {
        name: '@demo/api',
        version: '1.0.0',
        type: 'module',
        webstir: { mode: 'api', moduleManifest: {} },
      },
      null,
      2,
    ),
    'utf8',
  );

  const result = await runAddJob({
    workspaceRoot: workspace,
    name: 'nightly',
    schedule: '0 0 * * *',
    description: 'Nightly maintenance run',
    priority: '5',
  });

  assert.equal(result.subject, 'job');
  assert.ok(result.changes.includes('package.json'));
  assert.ok(result.changes.includes('src/backend/jobs/nightly/index.ts'));

  const pkg = await readJson(path.join(workspace, 'package.json'));
  assert.deepEqual(pkg.webstir.moduleManifest.jobs, [
    {
      name: 'nightly',
      schedule: '0 0 * * *',
      description: 'Nightly maintenance run',
      priority: 5,
    },
  ]);

  const buildResult = await backendProvider.build({
    workspaceRoot: workspace,
    env: {
      WEBSTIR_MODULE_MODE: 'build',
      WEBSTIR_BACKEND_TYPECHECK: 'skip',
      PATH: process.env.PATH ?? '',
    },
    incremental: false,
  });

  assert.deepEqual(buildResult.manifest.module?.jobs, [
    {
      name: 'nightly',
      schedule: '0 0 * * *',
      description: 'Nightly maintenance run',
      priority: 5,
    },
  ]);
});

test('runUpdateRouteContract merges advanced metadata onto an existing route', async () => {
  const workspace = await createTempWorkspace('webstir-backend-update-route-contract-');

  await fs.writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify(
      {
        name: '@demo/api',
        version: '1.0.0',
        type: 'module',
        webstir: {
          mode: 'api',
          moduleManifest: {
            routes: [
              {
                name: 'session-sign-in',
                method: 'POST',
                path: '/session/sign-in',
                summary: 'Sign in',
                interaction: 'mutation',
              },
            ],
          },
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  const result = await runUpdateRouteContract({
    workspaceRoot: workspace,
    method: 'POST',
    path: '/session/sign-in',
    sessionMode: 'required',
    sessionWrite: true,
    formUrlEncoded: true,
    formCsrf: true,
    fragmentTarget: 'session-panel',
    fragmentSelector: '#session-panel',
    fragmentMode: 'replace',
    responseSchema: 'SessionSignInResponse@src/shared/contracts/session.ts',
    responseStatus: 200,
  });

  assert.equal(result.subject, 'route');
  assert.deepEqual(result.changes, ['package.json']);

  const pkg = await readJson(path.join(workspace, 'package.json'));
  assert.deepEqual(pkg.webstir.moduleManifest.routes, [
    {
      name: 'session-sign-in',
      method: 'POST',
      path: '/session/sign-in',
      summary: 'Sign in',
      interaction: 'mutation',
      session: {
        mode: 'required',
        write: true,
      },
      form: {
        contentType: 'application/x-www-form-urlencoded',
        csrf: true,
      },
      fragment: {
        target: 'session-panel',
        selector: '#session-panel',
        mode: 'replace',
      },
      output: {
        body: {
          kind: 'zod',
          name: 'SessionSignInResponse',
          source: 'src/shared/contracts/session.ts',
        },
        status: 200,
      },
    },
  ]);
});
