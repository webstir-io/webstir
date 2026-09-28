import { expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';

import { runBuild } from '../src/build.ts';
import { runPublish } from '../src/publish.ts';
import type { BuildProvider, BuildTargetKind } from '../src/types.ts';
import { acquireWorkspaceWatchLock } from '../src/workspace-lock.ts';

function createFakeProvider(
  kind: BuildTargetKind,
  calls: Array<{ kind: BuildTargetKind; env: Record<string, string | undefined> }>,
  options: {
    readonly diagnosticsForMode?: (
      mode: string | undefined,
    ) => Array<{ severity: 'error' | 'warn' | 'info'; message: string }>;
  } = {},
): BuildProvider {
  return {
    resolveWorkspace({ workspaceRoot }) {
      return {
        sourceRoot: path.join(workspaceRoot, 'src', kind),
        buildRoot: path.join(workspaceRoot, 'build', kind),
        testsRoot: path.join(workspaceRoot, 'tests', kind),
      };
    },
    async build({ workspaceRoot, env }) {
      calls.push({ kind, env });
      const diagnostics = options.diagnosticsForMode?.(env.WEBSTIR_MODULE_MODE);
      return {
        artifacts: [
          {
            path: path.join(workspaceRoot, 'build', kind, 'index.js'),
            type: 'bundle',
          },
        ],
        manifest: {
          entryPoints: ['index.js'],
          staticAssets: [],
          diagnostics: diagnostics ?? [],
        },
      };
    },
  };
}

/** An app's layers are its files: pages are src/frontend, a server is src/backend/index.ts. */
async function writeLayers(
  workspace: string,
  layers: { readonly pages: boolean; readonly server: boolean },
): Promise<void> {
  if (layers.pages) await mkdir(path.join(workspace, 'src', 'frontend'), { recursive: true });
  if (layers.server) {
    await mkdir(path.join(workspace, 'src', 'backend'), { recursive: true });
    await writeFile(path.join(workspace, 'src', 'backend', 'index.ts'), 'export {};\n');
  }
}

test('runBuild composes frontend and backend providers for full workspaces', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'webstir-build-'));
  await writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify(
      {
        name: 'full-workspace',
      },
      null,
      2,
    ),
  );
  await writeLayers(workspace, { pages: true, server: true });

  const calls: Array<{ kind: BuildTargetKind; env: Record<string, string | undefined> }> = [];
  const providers: Record<BuildTargetKind, BuildProvider> = {
    frontend: createFakeProvider('frontend', calls, {
      diagnosticsForMode: () => [{ severity: 'warn', message: 'nonfatal warning' }],
    }),
    backend: createFakeProvider('backend', calls),
  };

  const result = await runBuild({
    workspaceRoot: workspace,
    env: {
      CUSTOM_FLAG: 'on',
    },
    loadProvider: async (kind) => providers[kind],
  });

  expect(result.mode).toBe('build');
  expect(result.workspace.layers).toEqual({ pages: true, server: true });
  expect(result.targets.map((target) => target.kind)).toEqual(['frontend', 'backend']);
  expect(calls.map((call) => call.kind)).toEqual(['frontend', 'backend']);
  expect(calls.every((call) => call.env.WEBSTIR_MODULE_MODE === 'build')).toBe(true);
  expect(calls.every((call) => call.env.CUSTOM_FLAG === 'on')).toBe(true);
  expect(result.targets[0]?.result.manifest.diagnostics).toEqual([
    { severity: 'warn', message: 'nonfatal warning' },
  ]);
});

test('runPublish prebuilds frontend targets before publish and reports dist output', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'webstir-publish-'));
  await writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify(
      {
        name: 'spa-workspace',
      },
      null,
      2,
    ),
  );
  await writeLayers(workspace, { pages: true, server: false });

  const calls: Array<{ kind: BuildTargetKind; env: Record<string, string | undefined> }> = [];
  const frontend = createFakeProvider('frontend', calls);

  const result = await runPublish({
    workspaceRoot: workspace,
    loadProvider: async () => frontend,
  });

  expect(result.mode).toBe('publish');
  expect(result.targets).toHaveLength(1);
  expect(result.targets[0]?.kind).toBe('frontend');
  expect(result.targets[0]?.outputRoot).toBe(path.join(workspace, 'dist', 'frontend'));
  expect(calls).toHaveLength(2);
  expect(calls.map((call) => call.env.WEBSTIR_MODULE_MODE)).toEqual(['build', 'publish']);
});

test('runBuild fails when a provider reports fatal diagnostics', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'webstir-build-fatal-'));
  await writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify(
      {
        name: 'spa-workspace',
      },
      null,
      2,
    ),
  );
  await writeLayers(workspace, { pages: true, server: false });

  const calls: Array<{ kind: BuildTargetKind; env: Record<string, string | undefined> }> = [];

  await expect(
    runBuild({
      workspaceRoot: workspace,
      loadProvider: async () =>
        createFakeProvider('frontend', calls, {
          diagnosticsForMode: () => [{ severity: 'error', message: 'broken manifest' }],
        }),
    }),
  ).rejects.toThrow(/frontend build reported 1 error diagnostic/);

  expect(calls).toHaveLength(1);
  expect(calls[0]?.env.WEBSTIR_MODULE_MODE).toBe('build');
});

test('runBuild refuses while watch owns the workspace', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'webstir-build-watch-lock-'));
  await writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify(
      {
        name: 'spa-workspace',
      },
      null,
      2,
    ),
  );
  await writeLayers(workspace, { pages: true, server: false });

  const calls: Array<{ kind: BuildTargetKind; env: Record<string, string | undefined> }> = [];
  const lock = await acquireWorkspaceWatchLock(workspace);

  try {
    await expect(
      runBuild({
        workspaceRoot: workspace,
        loadProvider: async () => createFakeProvider('frontend', calls),
      }),
    ).rejects.toThrow(/webstir watch is active/);
    expect(calls).toHaveLength(0);
  } finally {
    await lock.release();
  }
});

test('runPublish fails when the frontend prebuild reports fatal diagnostics', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'webstir-publish-fatal-'));
  await writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify(
      {
        name: 'spa-workspace',
      },
      null,
      2,
    ),
  );
  await writeLayers(workspace, { pages: true, server: false });

  const calls: Array<{ kind: BuildTargetKind; env: Record<string, string | undefined> }> = [];

  await expect(
    runPublish({
      workspaceRoot: workspace,
      loadProvider: async () =>
        createFakeProvider('frontend', calls, {
          diagnosticsForMode: (mode) =>
            mode === 'build' ? [{ severity: 'error', message: 'broken prebuild' }] : [],
        }),
    }),
  ).rejects.toThrow(/frontend prebuild reported 1 error diagnostic/);

  expect(calls).toHaveLength(1);
  expect(calls[0]?.env.WEBSTIR_MODULE_MODE).toBe('build');
});

test('runPublish refuses while watch owns the workspace', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'webstir-publish-watch-lock-'));
  await writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify(
      {
        name: 'spa-workspace',
      },
      null,
      2,
    ),
  );
  await writeLayers(workspace, { pages: true, server: false });

  const calls: Array<{ kind: BuildTargetKind; env: Record<string, string | undefined> }> = [];
  const lock = await acquireWorkspaceWatchLock(workspace);

  try {
    await expect(
      runPublish({
        workspaceRoot: workspace,
        loadProvider: async () => createFakeProvider('frontend', calls),
      }),
    ).rejects.toThrow(/webstir watch is active/);
    expect(calls).toHaveLength(0);
  } finally {
    await lock.release();
  }
});

test('runPublish removes the published output of a layer the app no longer has', async () => {
  for (const layers of [
    { pages: false, server: true },
    { pages: true, server: false },
  ]) {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'webstir-publish-retired-'));
    await writeFile(path.join(workspace, 'package.json'), JSON.stringify({ name: 'app' }));
    await writeLayers(workspace, layers);
    // What an earlier publish, with both layers, left behind.
    await mkdir(path.join(workspace, 'dist', 'frontend'), { recursive: true });
    await writeFile(path.join(workspace, 'dist', 'frontend', 'index.html'), '<main>old</main>');
    await mkdir(path.join(workspace, 'build', 'backend'), { recursive: true });
    await writeFile(path.join(workspace, 'build', 'backend', 'index.js'), 'export {};');

    const calls: Array<{ kind: BuildTargetKind; env: Record<string, string | undefined> }> = [];
    await runPublish({
      workspaceRoot: workspace,
      loadProvider: async (kind) => createFakeProvider(kind, calls),
    });

    expect({ layers, pages: existsSync(path.join(workspace, 'dist', 'frontend')) }).toEqual({
      layers,
      pages: layers.pages,
    });
    expect({
      layers,
      server: existsSync(path.join(workspace, 'build', 'backend', 'index.js')),
    }).toEqual({ layers, server: layers.server });
  }
});
