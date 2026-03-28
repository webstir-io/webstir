import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  applyRuntimeFilter,
  describeRuntimeFilter,
  discoverTestManifest,
  normalizeRuntimeFilter,
} from '../dist/index.js';
import { createTempWorkspace, removeWorkspace, writeWorkspaceTest } from './support.js';

test('discoverTestManifest finds frontend and backend fixtures with compiled paths', async () => {
  const workspaceRoot = await createTempWorkspace('webstir-testing-discovery-');

  try {
    await writeWorkspaceTest(workspaceRoot, 'frontend', 'home', { testName: 'frontend home' });
    await writeWorkspaceTest(workspaceRoot, 'backend', 'api', { testName: 'backend api' });

    const manifest = await discoverTestManifest(workspaceRoot);

    assert.equal(manifest.workspaceRoot, workspaceRoot);
    assert.deepEqual(
      manifest.modules.map((module) => ({
        id: module.id,
        runtime: module.runtime,
        sourcePath: path.relative(workspaceRoot, module.sourcePath),
        compiledPath: path.relative(workspaceRoot, module.compiledPath ?? ''),
      })),
      [
        {
          id: 'backend/tests/api.test.ts',
          runtime: 'backend',
          sourcePath: 'src/backend/tests/api.test.ts',
          compiledPath: 'build/backend/tests/api.test.js',
        },
        {
          id: 'frontend/tests/home.test.ts',
          runtime: 'frontend',
          sourcePath: 'src/frontend/tests/home.test.ts',
          compiledPath: 'build/frontend/tests/home.test.js',
        },
      ],
    );
  } finally {
    await removeWorkspace(workspaceRoot);
  }
});

test('runtime filtering keeps only the requested runtime and reports skipped tests', async () => {
  const workspaceRoot = await createTempWorkspace('webstir-testing-runtime-filter-');

  try {
    await writeWorkspaceTest(workspaceRoot, 'frontend', 'home');
    await writeWorkspaceTest(workspaceRoot, 'backend', 'api');

    const manifest = await discoverTestManifest(workspaceRoot);
    const backendOnly = applyRuntimeFilter(manifest, normalizeRuntimeFilter('backend'));

    assert.equal(normalizeRuntimeFilter('all'), null);
    assert.equal(normalizeRuntimeFilter(' FRONTEND '), 'frontend');
    assert.equal(normalizeRuntimeFilter('invalid'), null);
    assert.deepEqual(
      backendOnly.modules.map((module) => module.id),
      ['backend/tests/api.test.ts'],
    );
    assert.equal(
      describeRuntimeFilter('backend', manifest.modules.length, backendOnly.modules.length),
      "Runtime filter 'backend' matched 1 test (1 skipped).",
    );
  } finally {
    await removeWorkspace(workspaceRoot);
  }
});
