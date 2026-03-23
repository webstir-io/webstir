import { afterEach, expect, test } from 'bun:test';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

import { packageRoot, repoRoot } from '../src/paths.ts';
import { copyDemoWorkspace, removeDemoWorkspace } from '../test-support/demo-workspace.ts';
import {
  collectOutput,
  getFreePort,
  removeTrackedChild,
  stopTrackedChildren,
  waitFor,
} from '../test-support/watch.ts';

const childProcesses: Array<ReturnType<typeof Bun.spawn>> = [];

afterEach(async () => {
  await stopTrackedChildren(childProcesses);
});

test('CLI watch serves the SPA demo and rebuilds after a source edit', async () => {
  const workspaceCopy = await copyDemoWorkspace('spa', 'webstir-watch');
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
    stdout: 'pipe',
    stderr: 'pipe',
  });
  childProcesses.push(child);

  try {
    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (!response.ok) {
        throw new Error(`Unexpected status: ${response.status}`);
      }

      const html = await response.text();
      expect(html).toContain('data-bun-dev-server-script');
      expect(html).toContain('<main>');
      expect(html).toContain('Home');
    }, 20000);

    const sourceHtmlPath = path.join(workspace, 'src', 'frontend', 'pages', 'home', 'index.html');
    const originalHtml = await readFile(sourceHtmlPath, 'utf8');
    await writeFile(sourceHtmlPath, originalHtml.replace('Home', 'Watched Home'));

    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (!response.ok) {
        throw new Error(`Unexpected status: ${response.status}`);
      }

      const html = await response.text();
      expect(html).toContain('Watched Home');
    }, 20000);
  } finally {
    child.kill('SIGTERM');
    await child.exited.catch(() => undefined);
    removeTrackedChild(childProcesses, child);
    await removeDemoWorkspace(workspaceCopy);
  }
}, 30000);

test('CLI watch rejects the removed --frontend-runtime flag', async () => {
  const workspaceCopy = await copyDemoWorkspace('spa', 'webstir-watch');
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
      '--frontend-runtime=bun',
    ],
    cwd: repoRoot,
    env: process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  childProcesses.push(child);
  const stderrBuffer = { text: '' };
  const stderrDrain = collectOutput(child.stderr, stderrBuffer);

  try {
    expect(await child.exited).toBe(1);
    await stderrDrain;
    expect(stderrBuffer.text).toContain('Unknown option "--frontend-runtime=bun".');
  } finally {
    child.kill('SIGTERM');
    await child.exited.catch(() => undefined);
    await Promise.allSettled([stderrDrain]);
    removeTrackedChild(childProcesses, child);
    await removeDemoWorkspace(workspaceCopy);
  }
}, 30_000);
