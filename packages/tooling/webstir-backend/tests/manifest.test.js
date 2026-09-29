import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { backendProvider } from '../dist/index.js';
import { scaffoldAssets } from './support/scaffold.js';

async function createTempWorkspace(prefix = 'webstir-backend-manifest-') {
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

function getLocalBinPath() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkgRoot = path.resolve(here, '..');
  return path.join(pkgRoot, 'node_modules', '.bin');
}

async function seedBackendEntry(workspace) {
  const assets = scaffoldAssets();
  for (const asset of assets) {
    if (!asset.targetPath.endsWith(path.join('backend', 'index.ts'))) continue;
    const target = path.join(workspace, asset.targetPath);
    await copyFile(asset.sourcePath, target);
  }
}

test('manifest loader honors package overrides', async () => {
  const workspace = await createTempWorkspace();
  await seedBackendEntry(workspace);

  const pkgJson = {
    name: '@demo/backend',
    version: '1.0.0',
    type: 'module',
    webstir: {
      moduleManifest: {
        contractVersion: '1.0.0',
        name: '@demo/custom',
        version: '2.0.0',
        kind: 'backend',
        capabilities: ['db'],
      },
    },
  };
  await fs.writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify(pkgJson, null, 2),
    'utf8',
  );

  const env = {
    WEBSTIR_MODULE_MODE: 'build',
    // A throwaway workspace has no node_modules to type-check against.
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
    PATH: `${getLocalBinPath()}${path.delimiter}${process.env.PATH ?? ''}`,
  };

  const result = await backendProvider.build({ workspaceRoot: workspace, env, incremental: false });
  const moduleManifest = result.manifest.module;

  assert.equal(moduleManifest?.name, '@demo/custom');
  assert.equal(moduleManifest?.version, '2.0.0');
  assert.deepEqual(moduleManifest?.capabilities, ['db']);
});

test('manifest loader falls back to package name/version when no overrides present', async () => {
  const workspace = await createTempWorkspace();
  await seedBackendEntry(workspace);

  const pkgJson = {
    name: '@demo/fallback',
    version: '4.5.6',
    type: 'module',
  };
  await fs.writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify(pkgJson, null, 2),
    'utf8',
  );

  const env = {
    WEBSTIR_MODULE_MODE: 'build',
    // A throwaway workspace has no node_modules to type-check against.
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
    PATH: `${getLocalBinPath()}${path.delimiter}${process.env.PATH ?? ''}`,
  };

  const result = await backendProvider.build({ workspaceRoot: workspace, env, incremental: false });
  const moduleManifest = result.manifest.module;

  assert.equal(moduleManifest?.name, '@demo/fallback');
  assert.equal(moduleManifest?.version, '4.5.6');
});

test('manifest loader merges compiled module definition metadata', async () => {
  const workspace = await createTempWorkspace();
  await seedBackendEntry(workspace);

  const moduleSource = `export const module = {
  manifest: {
    contractVersion: '1.0.0',
    name: '@demo/with-module',
    version: '9.9.9',
    kind: 'backend',
    capabilities: ['search'],
    routes: [],
    views: []
  }
};
`;

  await fs.writeFile(path.join(workspace, 'src', 'backend', 'module.ts'), moduleSource, 'utf8');
  await fs.writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify({ name: '@demo/fallback-package', version: '0.0.1', type: 'module' }, null, 2),
    'utf8',
  );

  const env = {
    WEBSTIR_MODULE_MODE: 'build',
    // A throwaway workspace has no node_modules to type-check against.
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
    PATH: `${getLocalBinPath()}${path.delimiter}${process.env.PATH ?? ''}`,
  };

  const result = await backendProvider.build({ workspaceRoot: workspace, env, incremental: false });
  const moduleManifest = result.manifest.module;

  assert.equal(moduleManifest?.name, '@demo/with-module');
  assert.equal(moduleManifest?.version, '9.9.9');
  assert.deepEqual(moduleManifest?.capabilities, ['search']);
  assert.deepEqual(moduleManifest?.capabilities, ['search']);
});

test('manifest loader merges package routes with compiled module routes without duplicating overlaps', async () => {
  const workspace = await createTempWorkspace();
  await seedBackendEntry(workspace);

  const moduleSource = `export const module = {
  manifest: {
    contractVersion: '1.0.0',
    name: '@demo/with-routes',
    version: '1.2.3',
    kind: 'backend',
    capabilities: ['http'],
    routes: [
      {
        name: 'builtInRoute',
        method: 'GET',
        path: '/demo/built-in',
        summary: 'Built-in route'
      },
      {
        name: 'overlapRoute',
        method: 'GET',
        path: '/demo/overlap',
        summary: 'Built-in overlap route'
      }
    ],
    views: []
  }
};
`;

  await fs.writeFile(path.join(workspace, 'src', 'backend', 'module.ts'), moduleSource, 'utf8');
  await fs.writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify(
      {
        name: '@demo/routes-package',
        version: '0.0.1',
        type: 'module',
        webstir: {
          moduleManifest: {
            routes: [
              {
                name: 'overlapRouteFromPackage',
                method: 'GET',
                path: '/demo/overlap',
                summary: 'Package overlap route',
              },
              {
                name: 'packageOnlyRoute',
                method: 'POST',
                path: '/demo/package-only',
                summary: 'Package-only route',
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

  const env = {
    WEBSTIR_MODULE_MODE: 'build',
    // A throwaway workspace has no node_modules to type-check against.
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
    PATH: `${getLocalBinPath()}${path.delimiter}${process.env.PATH ?? ''}`,
  };

  const result = await backendProvider.build({ workspaceRoot: workspace, env, incremental: false });
  const moduleManifest = result.manifest.module;

  assert.deepEqual(
    moduleManifest?.routes?.map((route) => ({
      name: route.name,
      method: route.method,
      path: route.path,
    })),
    [
      { name: 'builtInRoute', method: 'GET', path: '/demo/built-in' },
      { name: 'overlapRoute', method: 'GET', path: '/demo/overlap' },
      { name: 'packageOnlyRoute', method: 'POST', path: '/demo/package-only' },
    ],
  );
});

test('manifest loader merges package jobs with compiled module jobs without duplicating names', async () => {
  const workspace = await createTempWorkspace();
  await seedBackendEntry(workspace);

  const moduleSource = `export const module = {
  manifest: {
    contractVersion: '1.0.0',
    name: '@demo/with-jobs',
    version: '1.2.3',
    kind: 'backend',
    jobs: [
      {
        name: 'nightly',
        schedule: '0 0 * * *'
      }
    ],
    routes: [],
    views: []
  }
};
`;

  await fs.writeFile(path.join(workspace, 'src', 'backend', 'module.ts'), moduleSource, 'utf8');
  await fs.writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify(
      {
        name: '@demo/jobs-package',
        version: '0.0.1',
        type: 'module',
        webstir: {
          moduleManifest: {
            jobs: [
              {
                name: 'nightly',
                schedule: 'rate(1 hour)',
              },
              {
                name: 'session-cleanup',
                schedule: 'rate(5 minutes)',
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

  const env = {
    WEBSTIR_MODULE_MODE: 'build',
    // A throwaway workspace has no node_modules to type-check against.
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
    PATH: `${getLocalBinPath()}${path.delimiter}${process.env.PATH ?? ''}`,
  };

  const result = await backendProvider.build({ workspaceRoot: workspace, env, incremental: false });
  const moduleManifest = result.manifest.module;

  assert.deepEqual(
    moduleManifest?.jobs?.map((job) => ({
      name: job.name,
      schedule: job.schedule,
    })),
    [
      { name: 'nightly', schedule: '0 0 * * *' },
      { name: 'session-cleanup', schedule: 'rate(5 minutes)' },
    ],
  );
});

test('manifest loader falls back to module exports from the compiled index entry', async () => {
  const workspace = await createTempWorkspace();
  await ensureDir(path.join(workspace, 'src', 'backend'));

  const indexSource = `export const module = {
  manifest: {
    contractVersion: '1.0.0',
    name: '@demo/index-module',
    version: '3.2.1',
    kind: 'backend',
    capabilities: ['http'],
    routes: [
      {
        name: 'indexEntryRoute',
        method: 'GET',
        path: '/demo/index-entry',
        summary: 'Route surfaced from index.ts'
      }
    ],
    views: []
  }
};
`;

  await fs.writeFile(path.join(workspace, 'src', 'backend', 'index.ts'), indexSource, 'utf8');
  await fs.writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify(
      { name: '@demo/index-fallback-package', version: '0.0.1', type: 'module' },
      null,
      2,
    ),
    'utf8',
  );

  const env = {
    WEBSTIR_MODULE_MODE: 'build',
    // A throwaway workspace has no node_modules to type-check against.
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
    PATH: `${getLocalBinPath()}${path.delimiter}${process.env.PATH ?? ''}`,
  };

  const result = await backendProvider.build({ workspaceRoot: workspace, env, incremental: false });
  const moduleManifest = result.manifest.module;

  assert.equal(moduleManifest?.name, '@demo/index-module');
  assert.equal(moduleManifest?.version, '3.2.1');
  assert.deepEqual(moduleManifest?.capabilities, ['http']);
  assert.deepEqual(
    moduleManifest?.routes?.map((route) => route.path),
    ['/demo/index-entry'],
  );
});

test('views.json lists the views the module renders and its GET routes, not package page routes', async () => {
  const workspace = await createTempWorkspace();
  await seedBackendEntry(workspace);
  await fs.writeFile(
    path.join(workspace, 'src', 'backend', 'module.ts'),
    `export const module = {
  manifest: { contractVersion: '1.0.0', name: '@demo/views', version: '1.0.0', kind: 'backend' },
  views: [{ definition: { name: 'clients', path: '/clients', page: 'clients' }, load: () => ({}) }],
  routes: [
    { definition: { name: 'download', method: 'GET', path: '/clients/:id/pdf' }, handler: () => ({}) },
    { definition: { name: 'save', method: 'POST', path: '/clients' }, handler: () => ({}) },
  ]
};
`,
    'utf8',
  );
  const env = {
    WEBSTIR_MODULE_MODE: 'build',
    // A throwaway workspace has no node_modules to type-check against.
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
    PATH: `${getLocalBinPath()}${path.delimiter}${process.env.PATH ?? ''}`,
  };

  await fs.writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify({
      name: '@demo/views',
      version: '1.0.0',
      type: 'module',
      webstir: {
        moduleManifest: { views: [{ name: 'record', path: '/records/:id', page: 'record' }] },
      },
    }),
    'utf8',
  );
  await backendProvider.build({ workspaceRoot: workspace, env, incremental: false });
  const listed = JSON.parse(
    await fs.readFile(path.join(workspace, 'build', 'backend', 'views.json'), 'utf8'),
  );
  assert.deepEqual(listed, [
    { name: 'clients', path: '/clients', page: 'clients' },
    { name: 'download', path: '/clients/:id/pdf', method: 'GET' },
  ]);

  await fs.writeFile(
    path.join(workspace, 'src', 'backend', 'module.ts'),
    `export const module = { manifest: { contractVersion: '1.0.0', name: '@demo/views', version: '1.0.0', kind: 'backend' } };\n`,
    'utf8',
  );
  const result = await backendProvider.build({ workspaceRoot: workspace, env, incremental: false });
  assert.deepEqual(result.manifest.module?.views, [
    { name: 'record', path: '/records/:id', page: 'record' },
  ]);
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(workspace, 'build', 'backend', 'views.json'), 'utf8')),
    [],
    'a page route in package.json is served by the frontend, so the backend does not claim it',
  );
});
