import { expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';

import { runBuild } from '../src/build.ts';
import { runPublish } from '../src/publish.ts';
import type { BuildProvider, BuildTargetKind } from '../src/types.ts';

function createFakeProvider(
  kind: BuildTargetKind,
  calls: Array<{ kind: BuildTargetKind; env: Record<string, string | undefined> }>,
  options: {
    readonly diagnosticsForMode?: (mode: string | undefined) => Array<{ severity: 'error' | 'warn' | 'info'; message: string }>;
  } = {}
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

test('runBuild composes frontend and backend providers for full workspaces', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'webstir-build-'));
  await writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify(
      {
        name: 'full-workspace',
        webstir: {
          mode: 'full',
        },
      },
      null,
      2
    )
  );

  const calls: Array<{ kind: BuildTargetKind; env: Record<string, string | undefined> }> = [];
  const providers: Record<BuildTargetKind, BuildProvider> = {
    frontend: createFakeProvider('frontend', calls),
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
  expect(result.workspace.mode).toBe('full');
  expect(result.targets.map((target) => target.kind)).toEqual(['frontend', 'backend']);
  expect(calls.map((call) => call.kind)).toEqual(['frontend', 'backend']);
  expect(calls.every((call) => call.env.WEBSTIR_MODULE_MODE === 'build')).toBe(true);
  expect(calls.every((call) => call.env.CUSTOM_FLAG === 'on')).toBe(true);
});

test('runPublish prebuilds frontend targets before publish and reports dist output', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'webstir-publish-'));
  await writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify(
      {
        name: 'spa-workspace',
        webstir: {
          mode: 'spa',
        },
      },
      null,
      2
    )
  );

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
        webstir: {
          mode: 'spa',
        },
      },
      null,
      2
    )
  );

  const calls: Array<{ kind: BuildTargetKind; env: Record<string, string | undefined> }> = [];

  await expect(
    runBuild({
      workspaceRoot: workspace,
      loadProvider: async () =>
        createFakeProvider('frontend', calls, {
          diagnosticsForMode: () => [{ severity: 'error', message: 'broken manifest' }],
        }),
    })
  ).rejects.toThrow(/frontend build reported 1 error diagnostic/);

  expect(calls).toHaveLength(1);
  expect(calls[0]?.env.WEBSTIR_MODULE_MODE).toBe('build');
});

test('runPublish fails when the frontend prebuild reports fatal diagnostics', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'webstir-publish-fatal-'));
  await writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify(
      {
        name: 'spa-workspace',
        webstir: {
          mode: 'spa',
        },
      },
      null,
      2
    )
  );

  const calls: Array<{ kind: BuildTargetKind; env: Record<string, string | undefined> }> = [];

  await expect(
    runPublish({
      workspaceRoot: workspace,
      loadProvider: async () =>
        createFakeProvider('frontend', calls, {
          diagnosticsForMode: (mode) =>
            mode === 'build' ? [{ severity: 'error', message: 'broken prebuild' }] : [],
        }),
    })
  ).rejects.toThrow(/frontend prebuild reported 1 error diagnostic/);

  expect(calls).toHaveLength(1);
  expect(calls[0]?.env.WEBSTIR_MODULE_MODE).toBe('build');
});
