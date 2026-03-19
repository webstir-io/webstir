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

test('CLI watch serves the API demo, restarts after a successful rebuild, and survives a failed rebuild', async () => {
  const workspaceCopy = await copyDemoWorkspace('api', 'webstir-api-watch');
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
    env: {
      ...process.env,
      WEBSTIR_BACKEND_TYPECHECK: 'skip',
    },
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
      expect(await fetchText(port)).toContain('API server running');
    }, 20_000);

    const sourcePath = path.join(workspace, 'src', 'backend', 'index.ts');
    const originalSource = await readFile(sourcePath, 'utf8');
    await writeFile(sourcePath, originalSource.replace('API server running', 'API server changed'), 'utf8');

    await waitFor(async () => {
      expect(await fetchText(port)).toContain('API server changed');
    }, 20_000);

    await writeFile(sourcePath, "import http from 'node:http';\nconst broken = ;\n", 'utf8');
    await waitFor(async () => {
      expect(stderrBuffer.text).toContain('backend rebuild failed; keeping the current runtime process');
    }, 20_000);

    const exitState = await Promise.race([
      child.exited.then(() => 'exited'),
      Bun.sleep(250).then(() => 'running'),
    ]);

    expect(exitState).toBe('running');
    expect(await fetchText(port)).toContain('API server changed');
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

async function fetchText(port: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/`);
  if (!response.ok) {
    throw new Error(`Unexpected status: ${response.status}`);
  }

  return await response.text();
}
