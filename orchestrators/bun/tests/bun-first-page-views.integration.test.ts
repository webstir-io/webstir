import { afterEach, expect, test } from 'bun:test';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

import { packageRoot, repoRoot } from '../src/paths.ts';
import { copyDemoWorkspace, removeDemoWorkspace } from '../test-support/demo-workspace.ts';
import {
  appendWatchLogs,
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

test('Bun-first watch serves a page at the dynamic paths its views declare', async () => {
  const workspaceCopy = await copyDemoWorkspace('spa', 'webstir-bun-first-page-views-');
  const workspace = workspaceCopy.workspaceRoot;
  const addPageResult = Bun.spawnSync({
    cmd: [
      process.execPath,
      path.join(packageRoot, 'src', 'cli.ts'),
      'add-page',
      'about',
      '--workspace',
      workspace,
    ],
    cwd: repoRoot,
    env: process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(addPageResult.exitCode).toBe(0);

  const packageJsonPath = path.join(workspace, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
    webstir?: Record<string, unknown>;
  };
  packageJson.webstir = {
    ...packageJson.webstir,
    moduleManifest: {
      views: [
        { name: 'thing', path: '/things/:thing', page: 'about', renderMode: 'spa' },
        { name: 'thing-detail', path: '/things/:thing/:detail', page: 'about' },
      ],
    },
  };
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

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
  const stdoutBuffer = { text: '' };
  const stderrBuffer = { text: '' };
  const stdoutDrain = collectOutput(child.stdout, stdoutBuffer);
  const stderrDrain = collectOutput(child.stderr, stderrBuffer);

  try {
    await waitFor(async () => {
      const [about, thing, detail, tooDeep] = await Promise.all([
        fetch(`http://127.0.0.1:${port}/about`),
        fetch(`http://127.0.0.1:${port}/things/alpha`),
        fetch(`http://127.0.0.1:${port}/things/alpha/beta/`),
        fetch(`http://127.0.0.1:${port}/things/alpha/beta/gamma`),
      ]);
      expect(about.status).toBe(200);
      expect(thing.status).toBe(200);
      expect(await thing.text()).toContain('Content for the about page.');
      expect(detail.status).toBe(200);
      expect(await detail.text()).toContain('Content for the about page.');
      expect(tooDeep.status).toBe(404);
    }, 30_000);
  } catch (error) {
    throw appendWatchLogs(error, stdoutBuffer.text, stderrBuffer.text);
  } finally {
    child.kill('SIGTERM');
    await child.exited.catch(() => undefined);
    await Promise.allSettled([stdoutDrain, stderrDrain]);
    removeTrackedChild(childProcesses, child);
    await removeDemoWorkspace(workspaceCopy);
  }
}, 120_000);
