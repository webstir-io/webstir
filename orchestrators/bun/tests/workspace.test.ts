import { expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';

import { isStaticApp } from '@webstir-io/module-contract/workspace';

import { createBuildPlan } from '../src/build-plan.ts';
import { normalizeRepoLocalDependencySpecs } from '../src/external-workspace.ts';
import { readWorkspaceDescriptor } from '../src/workspace.ts';

test('an app is its files: layers, build plan and static output follow from them', async () => {
  const cases = [
    { files: ['src/frontend/'], pages: true, server: false, plan: ['frontend'], static: true },
    {
      files: ['src/backend/index.ts'],
      pages: false,
      server: true,
      plan: ['backend'],
      static: false,
    },
    {
      files: ['src/frontend/', 'src/backend/index.ts'],
      pages: true,
      server: true,
      plan: ['frontend', 'backend'],
      static: false,
    },
    // Loaders for build-time views, with no server to run: still a static app.
    {
      files: ['src/frontend/', 'src/backend/module.ts'],
      pages: true,
      server: false,
      plan: ['frontend'],
      static: true,
    },
    {
      files: ['src/frontend/', 'src/backend/index.mjs'],
      pages: true,
      server: true,
      plan: ['frontend', 'backend'],
      static: false,
    },
    // A backend of functions or jobs alone is still built and run.
    {
      files: ['src/backend/jobs/nightly/index.ts'],
      pages: false,
      server: true,
      plan: ['backend'],
      static: false,
    },
    // A leftover mode never overrides the files.
    {
      files: ['src/frontend/'],
      mode: 'full',
      pages: true,
      server: false,
      plan: ['frontend'],
      static: true,
    },
  ];

  for (const entry of cases) {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'webstir-layers-'));
    try {
      await writeFile(
        path.join(workspace, 'package.json'),
        JSON.stringify({ name: 'app', ...(entry.mode ? { webstir: { mode: entry.mode } } : {}) }),
      );
      for (const file of entry.files) {
        const target = path.join(workspace, file);
        if (file.endsWith('/')) {
          await mkdir(target, { recursive: true });
        } else {
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, 'export {};\n');
        }
      }

      const { layers } = await readWorkspaceDescriptor(workspace);
      expect({ files: entry.files, layers }).toEqual({
        files: entry.files,
        layers: { pages: entry.pages, server: entry.server },
      });
      expect(createBuildPlan(layers)).toEqual(entry.plan);
      expect(isStaticApp(layers)).toBe(entry.static);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
});

test('an app with neither pages nor a server has nothing to build', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'webstir-layers-none-'));
  try {
    await writeFile(path.join(workspace, 'package.json'), JSON.stringify({ name: 'empty' }));
    await expect(readWorkspaceDescriptor(workspace)).rejects.toThrow(
      /has no pages \(src\/frontend\) and no server \(src\/backend\/index\.ts\)/,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('repo-local external workspace deps include unpublished transitive contracts', () => {
  const normalized = normalizeRepoLocalDependencySpecs({
    dependencies: {
      '@webstir-io/webstir-frontend': 'workspace:*',
      '@webstir-io/webstir-testing': 'workspace:*',
    },
  });

  expect(normalized.changed).toBe(true);
  expect(normalized.packageJson.dependencies?.['@webstir-io/webstir-frontend']).toContain(
    'packages/tooling/webstir-frontend',
  );
  expect(normalized.packageJson.dependencies?.['@webstir-io/module-contract']).toContain(
    'packages/contracts/module-contract',
  );
  expect(normalized.packageJson.dependencies?.['@webstir-io/webstir-testing']).toContain(
    'packages/tooling/webstir-testing',
  );
  expect(normalized.packageJson.dependencies?.['@webstir-io/testing-contract']).toContain(
    'packages/contracts/testing-contract',
  );
  expect(normalized.packageJson.overrides?.['@webstir-io/module-contract']).toContain(
    'packages/contracts/module-contract',
  );
  expect(normalized.packageJson.overrides?.['@webstir-io/testing-contract']).toContain(
    'packages/contracts/testing-contract',
  );
});
