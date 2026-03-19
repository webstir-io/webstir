import { afterEach, expect, test } from 'bun:test';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

import { packageRoot, repoRoot } from '../src/paths.ts';
import { copyDemoWorkspace, removeDemoWorkspace } from '../test-support/demo-workspace.ts';
import { getFreePort, removeTrackedChild, stopTrackedChildren, waitFor } from '../test-support/watch.ts';

const childProcesses: Array<ReturnType<typeof Bun.spawn>> = [];

afterEach(async () => {
  await stopTrackedChildren(childProcesses);
});

test('CLI watch serves the SSG demo and rebuilds generated content after a markdown edit', async () => {
  const workspaceCopy = await copyDemoWorkspace('ssg/base', 'webstir-ssg-watch', {
    workspaceName: 'ssg-base',
  });
  const workspace = workspaceCopy.workspaceRoot;

  const port = await getFreePort();
  const child = Bun.spawn({
    cmd: [
      process.execPath,
      path.join(packageRoot, 'src', 'cli.ts'),
      'watch',
      '--workspace',
      workspace,
      '--port',
      String(port),
    ],
    cwd: repoRoot,
    env: process.env,
    stdout: 'ignore',
    stderr: 'ignore',
  });
  childProcesses.push(child);

  try {
    await waitFor(async () => {
      expect(await fetchText(port, '/')).toContain('Welcome to your Webstir site');
      expect(await fetchText(port, '/docs/hosting')).toContain('Deploying your site');
    }, 20_000);

    const contentPath = path.join(workspace, 'src', 'frontend', 'content', 'hosting.md');
    const originalContent = await readFile(contentPath, 'utf8');
    await writeFile(contentPath, originalContent.replace('Deploying your site', 'Hosting guide updated'), 'utf8');

    await waitFor(async () => {
      expect(await fetchText(port, '/docs/hosting')).toContain('Hosting guide updated');
    }, 20_000);
  } finally {
    child.kill('SIGTERM');
    await child.exited.catch(() => undefined);
    removeTrackedChild(childProcesses, child);
    await removeDemoWorkspace(workspaceCopy);
  }
}, 45_000);

async function fetchText(port: number, requestPath: string): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}${requestPath}`);
  if (!response.ok) {
    throw new Error(`Unexpected status: ${response.status}`);
  }

  return await response.text();
}
