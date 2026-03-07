import { expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';

import { runBuild } from '../src/build.ts';
import type { BuildProvider, BuildTargetKind } from '../src/types.ts';

function createFakeProvider(kind: BuildTargetKind, calls: Array<{ kind: BuildTargetKind; env: Record<string, string | undefined> }>): BuildProvider {
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
          diagnostics: [],
        },
      };
    },
  };
}

test('runBuild composes frontend and backend providers for full workspaces', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'webstir-bun-build-'));
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

  expect(result.workspace.mode).toBe('full');
  expect(result.targets.map((target) => target.kind)).toEqual(['frontend', 'backend']);
  expect(calls.map((call) => call.kind)).toEqual(['frontend', 'backend']);
  expect(calls.every((call) => call.env.WEBSTIR_MODULE_MODE === 'build')).toBe(true);
  expect(calls.every((call) => call.env.CUSTOM_FLAG === 'on')).toBe(true);
});
