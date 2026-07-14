import { test } from 'bun:test';
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

test('runAddRoute defaults full workspace route definitions to the public api namespace', async () => {
  const workspace = await createTempWorkspace('webstir-backend-add-route-full-');

  await fs.writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify(
      {
        name: '@demo/full',
        version: '1.0.0',
        type: 'module',
        webstir: { mode: 'full', moduleManifest: {} },
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
  });

  assert.equal(result.target, 'POST /api/accounts');

  const pkg = await readJson(path.join(workspace, 'package.json'));
  assert.deepEqual(pkg.webstir.moduleManifest.routes, [
    {
      name: 'accounts',
      method: 'POST',
      path: '/api/accounts',
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

test('route metadata operations reject a symlinked workspace manifest', async () => {
  const workspace = await createTempWorkspace('webstir-backend-route-manifest-symlink-');
  const externalRoot = await createTempWorkspace('webstir-backend-route-manifest-symlink-outside-');
  const externalPackageJsonPath = path.join(externalRoot, 'package.json');
  const packageJson = `${JSON.stringify(
    {
      name: '@demo/api',
      version: '1.0.0',
      type: 'module',
      webstir: {
        mode: 'api',
        moduleManifest: {
          routes: [{ name: 'health', method: 'GET', path: '/api/health' }],
        },
      },
    },
    null,
    2,
  )}\n`;
  await fs.writeFile(externalPackageJsonPath, packageJson, 'utf8');
  await fs.symlink(externalPackageJsonPath, path.join(workspace, 'package.json'), 'file');

  await assert.rejects(
    runAddRoute({ workspaceRoot: workspace, name: 'status' }),
    /workspace manifest path through symbolic link/,
  );
  await assert.rejects(
    runUpdateRouteContract({
      workspaceRoot: workspace,
      method: 'GET',
      path: '/api/health',
      summary: 'Health status',
    }),
    /workspace manifest path through symbolic link/,
  );

  assert.equal(await fs.readFile(externalPackageJsonPath, 'utf8'), packageJson);
});

test('route metadata operations reject a non-regular workspace manifest', async () => {
  const workspace = await createTempWorkspace('webstir-backend-route-manifest-directory-');
  const packageJsonPath = path.join(workspace, 'package.json');
  await fs.mkdir(packageJsonPath);

  await assert.rejects(
    runAddRoute({ workspaceRoot: workspace, name: 'status' }),
    /workspace manifest path; path is not a regular file/,
  );
  await assert.rejects(
    runUpdateRouteContract({
      workspaceRoot: workspace,
      method: 'GET',
      path: '/api/health',
      summary: 'Health status',
    }),
    /workspace manifest path; path is not a regular file/,
  );
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
    name: '  nightly  ',
    schedule: 'rate(5 minutes)',
    description: 'Nightly maintenance run',
    priority: '5',
  });

  assert.equal(result.subject, 'job');
  assert.ok(result.changes.includes('package.json'));
  assert.ok(result.changes.includes('src/backend/jobs/nightly/index.ts'));

  const jobSource = await fs.readFile(
    path.join(workspace, 'src', 'backend', 'jobs', 'nightly', 'index.ts'),
    'utf8',
  );
  assert.match(jobSource, /fileURLToPath\(import\.meta\.url\)/);
  assert.match(jobSource, /path\.resolve\(entrypointPath\)/);
  assert.doesNotMatch(jobSource, /process\.argv\?\.\[1\]/);
  assert.doesNotMatch(jobSource, /catch \{/);

  const pkg = await readJson(path.join(workspace, 'package.json'));
  assert.deepEqual(pkg.webstir.moduleManifest.jobs, [
    {
      name: 'nightly',
      schedule: 'rate(5 minutes)',
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
      schedule: 'rate(5 minutes)',
      description: 'Nightly maintenance run',
      priority: 5,
    },
  ]);
});

test('runAddJob rejects unsafe path segments before mutating the workspace', async () => {
  const workspace = await createTempWorkspace('webstir-backend-add-job-containment-');
  const externalRoot = await createTempWorkspace('webstir-backend-add-job-outside-');
  const packageJsonPath = path.join(workspace, 'package.json');
  const sentinelPath = path.join(externalRoot, 'sentinel.txt');
  const packageJson = `${JSON.stringify(
    {
      name: '@demo/api',
      version: '1.0.0',
      type: 'module',
      webstir: { mode: 'api', moduleManifest: {} },
    },
    null,
    2,
  )}\n`;
  await fs.writeFile(packageJsonPath, packageJson, 'utf8');
  await fs.writeFile(sentinelPath, 'outside-sentinel', 'utf8');

  const jobsRoot = path.join(workspace, 'src', 'backend', 'jobs');
  const traversalName = path.relative(jobsRoot, externalRoot).split(path.sep).join('/');
  const invalidNames = [
    '',
    '   ',
    '.',
    '..',
    traversalName,
    traversalName.replaceAll('/', '\\'),
    `bad\0name`,
    'bad\nname',
    'nightly\n',
    '\tnightly',
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
  ];

  for (const name of invalidNames) {
    await assert.rejects(
      runAddJob({ workspaceRoot: workspace, name }),
      /Missing job name|Invalid job name/,
    );
  }

  assert.equal(await fs.readFile(packageJsonPath, 'utf8'), packageJson);
  assert.equal(await fs.readFile(sentinelPath, 'utf8'), 'outside-sentinel');
  assert.equal(await pathExists(path.join(externalRoot, 'index.ts')), false);
  assert.equal(await pathExists(jobsRoot), false);
});

test('runAddJob rejects a symlinked job path without touching its target or manifest', async () => {
  const workspace = await createTempWorkspace('webstir-backend-add-job-symlink-');
  const externalRoot = await createTempWorkspace('webstir-backend-add-job-symlink-outside-');
  const packageJsonPath = path.join(workspace, 'package.json');
  const sentinelPath = path.join(externalRoot, 'sentinel.txt');
  const packageJson = `${JSON.stringify(
    {
      name: '@demo/api',
      version: '1.0.0',
      type: 'module',
      webstir: { mode: 'api', moduleManifest: {} },
    },
    null,
    2,
  )}\n`;
  await fs.writeFile(packageJsonPath, packageJson, 'utf8');
  await fs.writeFile(sentinelPath, 'outside-sentinel', 'utf8');

  const backendRoot = path.join(workspace, 'src', 'backend');
  const jobsRoot = path.join(backendRoot, 'jobs');
  await fs.mkdir(backendRoot, { recursive: true });
  await fs.symlink(externalRoot, jobsRoot, 'dir');

  await assert.rejects(runAddJob({ workspaceRoot: workspace, name: 'nightly' }), /symbolic link/);

  assert.equal(await fs.readFile(packageJsonPath, 'utf8'), packageJson);
  assert.equal(await fs.readFile(sentinelPath, 'utf8'), 'outside-sentinel');
  assert.equal(await pathExists(path.join(externalRoot, 'nightly', 'index.ts')), false);
});

test('runAddJob rejects an existing job before reading a symlinked job file', async () => {
  const workspace = await createTempWorkspace('webstir-backend-add-job-existing-');
  const externalRoot = await createTempWorkspace('webstir-backend-add-job-existing-outside-');
  const packageJsonPath = path.join(workspace, 'package.json');
  const externalJobPath = path.join(externalRoot, 'index.ts');
  const jobDirectory = path.join(workspace, 'src', 'backend', 'jobs', 'nightly');
  const packageJson = `${JSON.stringify(
    {
      name: '@demo/api',
      version: '1.0.0',
      type: 'module',
      webstir: { mode: 'api', moduleManifest: {} },
    },
    null,
    2,
  )}\n`;
  await fs.writeFile(packageJsonPath, packageJson, 'utf8');
  await fs.writeFile(externalJobPath, 'outside-job-sentinel', 'utf8');
  await fs.mkdir(jobDirectory, { recursive: true });
  await fs.symlink(externalJobPath, path.join(jobDirectory, 'index.ts'), 'file');

  await assert.rejects(runAddJob({ workspaceRoot: workspace, name: 'nightly' }), /already exists/);

  assert.equal(await fs.readFile(packageJsonPath, 'utf8'), packageJson);
  assert.equal(await fs.readFile(externalJobPath, 'utf8'), 'outside-job-sentinel');
});

test('runAddJob rejects a symlinked manifest before creating the jobs root', async () => {
  const workspace = await createTempWorkspace('webstir-backend-add-job-manifest-symlink-');
  const externalRoot = await createTempWorkspace(
    'webstir-backend-add-job-manifest-symlink-outside-',
  );
  const externalPackageJsonPath = path.join(externalRoot, 'package.json');
  const sentinelPath = path.join(externalRoot, 'sentinel.txt');
  const jobsRoot = path.join(workspace, 'src', 'backend', 'jobs');
  const packageJson = `${JSON.stringify(
    {
      name: '@demo/api',
      version: '1.0.0',
      type: 'module',
      webstir: { mode: 'api', moduleManifest: {} },
    },
    null,
    2,
  )}\n`;
  await fs.writeFile(externalPackageJsonPath, packageJson, 'utf8');
  await fs.writeFile(sentinelPath, 'outside-sentinel', 'utf8');
  await fs.symlink(externalPackageJsonPath, path.join(workspace, 'package.json'), 'file');

  await assert.rejects(runAddJob({ workspaceRoot: workspace, name: 'nightly' }), /symbolic link/);

  assert.equal(await fs.readFile(externalPackageJsonPath, 'utf8'), packageJson);
  assert.equal(await fs.readFile(sentinelPath, 'utf8'), 'outside-sentinel');
  assert.equal(await pathExists(jobsRoot), false);
});

test('runAddJob rejects malformed package metadata before creating the jobs root', async () => {
  const workspace = await createTempWorkspace('webstir-backend-add-job-malformed-manifest-');
  const packageJsonPath = path.join(workspace, 'package.json');
  const jobsRoot = path.join(workspace, 'src', 'backend', 'jobs');
  const packageSentinel = '{ deliberately invalid package JSON }\n';
  await fs.writeFile(packageJsonPath, packageSentinel, 'utf8');

  await assert.rejects(runAddJob({ workspaceRoot: workspace, name: 'nightly' }));

  assert.equal(await fs.readFile(packageJsonPath, 'utf8'), packageSentinel);
  assert.equal(await pathExists(jobsRoot), false);
});

test('runAddJob rejects a missing package manifest before creating the jobs root', async () => {
  const workspace = await createTempWorkspace('webstir-backend-add-job-missing-manifest-');
  const jobsRoot = path.join(workspace, 'src', 'backend', 'jobs');

  await assert.rejects(
    runAddJob({ workspaceRoot: workspace, name: 'nightly' }),
    /package\.json not found/,
  );

  assert.equal(await pathExists(jobsRoot), false);
});

test('runAddJob rejects malformed rate schedules before writing files', async () => {
  const workspace = await createTempWorkspace('webstir-backend-add-job-rate-');

  await assert.rejects(
    runAddJob({
      workspaceRoot: workspace,
      name: 'nightly',
      schedule: 'rate(0 seconds)',
    }),
    /Expected rate\(<positive integer> second\(s\)\|minute\(s\)\|hour\(s\)\)/,
  );
});

async function pathExists(filePath) {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

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
