import { expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';

import { createBuildPlan } from '../src/build-plan.ts';
import { parseWorkspaceMode, readWorkspaceDescriptor } from '../src/workspace.ts';

test('createBuildPlan maps supported workspace modes to build targets', () => {
  expect(createBuildPlan('spa')).toEqual(['frontend']);
  expect(createBuildPlan('ssg')).toEqual(['frontend']);
  expect(createBuildPlan('api')).toEqual(['backend']);
  expect(createBuildPlan('full')).toEqual(['frontend', 'backend']);
});

test('parseWorkspaceMode rejects unsupported modes', () => {
  expect(() => parseWorkspaceMode('legacy')).toThrow(/Unsupported webstir\.mode/);
});

test('readWorkspaceDescriptor resolves workspace name and mode', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'webstir-workspace-'));
  await writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify(
      {
        name: 'sample-workspace',
        webstir: {
          mode: 'full',
        },
      },
      null,
      2
    )
  );

  const descriptor = await readWorkspaceDescriptor(workspace);

  expect(descriptor.name).toBe('sample-workspace');
  expect(descriptor.mode).toBe('full');
  expect(descriptor.root).toBe(path.resolve(workspace));
});
