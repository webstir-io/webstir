import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { materializeRepoLocalWorkspaceDependencies } from '../src/external-workspace.ts';
import { packageRoot, repoRoot } from '../src/paths.ts';
import { copyDemoWorkspace, removeDemoWorkspace } from '../test-support/demo-workspace.ts';

test('published app bundle carries no hot-update machinery', async () => {
  const copy = await copyDemoWorkspace('ssg/site', 'webstir-publish-app-bundle');
  const workspace = copy.workspaceRoot;

  try {
    await Promise.all(
      ['build', 'dist', 'node_modules'].map((name) =>
        rm(path.join(workspace, name), { recursive: true, force: true }),
      ),
    );
    await materializeRepoLocalWorkspaceDependencies(workspace, { installStdio: 'pipe' });
    runCli(workspace, ['publish']);

    const distRoot = path.join(workspace, 'dist', 'frontend');
    const html = await readFile(path.join(distRoot, 'index.html'), 'utf8');
    const appBundle = html.match(/\/app\/(app-[^"']+\.js)/)?.[1];
    expect(appBundle).toBeDefined();

    const appSource = await readFile(path.join(distRoot, 'app', appBundle ?? ''), 'utf8');
    // The registry and its window hooks live in the dev-only HMR client now.
    expect(appSource).not.toContain('__webstirDispose');
    expect(appSource).not.toContain('__webstirAccept');
    expect(appSource).not.toContain('__webstirRegisterHotModule');
    expect(html).not.toContain('/hmr.js');
    expect(existsSync(path.join(distRoot, 'hmr.js'))).toBe(false);
  } finally {
    await removeDemoWorkspace(copy);
  }
}, 180_000);

function runCli(workspace: string, args: string[]): void {
  const result = Bun.spawnSync({
    cmd: [
      process.execPath,
      path.join(packageRoot, 'src', 'cli.ts'),
      ...args,
      '--workspace',
      workspace,
    ],
    cwd: repoRoot,
    env: { ...process.env, WEBSTIR_BACKEND_TYPECHECK: 'skip' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `webstir ${args.join(' ')} failed with exit code ${result.exitCode}.\nstdout:\n${result.stdout.toString()}\n\nstderr:\n${result.stderr.toString()}`,
    );
  }
}
