import { expect, test } from 'bun:test';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

import { materializeRepoLocalWorkspaceDependencies } from '../src/external-workspace.ts';
import { copyDemoWorkspace, removeDemoWorkspace } from '../test-support/demo-workspace.ts';

test('a repo-local install with piped output finishes however much it prints', async () => {
  const copy = await copyDemoWorkspace('ssg/base', 'webstir-repo-local-install-');
  try {
    const packageJsonPath = path.join(copy.workspaceRoot, 'package.json');
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    // More than a pipe holds, so an install whose output is not read would stall.
    packageJson.scripts = {
      ...packageJson.scripts,
      postinstall: `bun -e "process.stdout.write('x'.repeat(2 ** 20))"`,
    };
    await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

    const outcome = await Promise.race([
      materializeRepoLocalWorkspaceDependencies(copy.workspaceRoot, { installStdio: 'pipe' }).then(
        () => 'installed',
      ),
      Bun.sleep(60_000).then(() => 'stalled'),
    ]);
    expect(outcome).toBe('installed');
  } finally {
    await removeDemoWorkspace(copy);
  }
}, 120_000);
