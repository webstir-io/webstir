import { afterEach, expect, test } from 'bun:test';
import path from 'node:path';
import { readFile, rm, writeFile } from 'node:fs/promises';

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

test('CLI watch serves the full demo, proxies /api, and rebuilds frontend and backend changes', async () => {
  const workspaceCopy = await copyDemoWorkspace('full', 'webstir-full-watch');
  const workspace = workspaceCopy.workspaceRoot;
  await Promise.all([
    rm(path.join(workspace, 'build'), { recursive: true, force: true }),
    rm(path.join(workspace, 'dist'), { recursive: true, force: true }),
    rm(path.join(workspace, 'node_modules'), { recursive: true, force: true })
  ]);

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
      expect(stdoutBuffer.text).toContain('[webstir] backend ready at');
      expect(stdoutBuffer.text).toContain('[webstir] watch starting');
    }, 30_000);

    await waitFor(async () => {
      expect(await fetchText(port, '/')).toContain('Home');
      expect(await fetchText(port, '/api')).toContain('API server running');
    }, 10_000);

    const frontendPath = path.join(workspace, 'src', 'frontend', 'pages', 'home', 'index.html');
    const originalFrontend = await readFile(frontendPath, 'utf8');
    await writeFile(frontendPath, originalFrontend.replace('Home', 'Full Home'), 'utf8');

    await waitFor(async () => {
      expect(await fetchText(port, '/')).toContain('Full Home');
    }, 20_000);

    const backendPath = path.join(workspace, 'src', 'backend', 'index.ts');
    const originalBackend = await readFile(backendPath, 'utf8');
    await writeFile(backendPath, originalBackend.replaceAll('API server running', 'Full API changed'), 'utf8');

    await waitFor(async () => {
      expect(stdoutBuffer.text).toContain('backend restarted at');
      expect(await fetchText(port, '/api')).toContain('Full API changed');
    }, 20_000);
  } catch (error) {
    throw appendWatchLogs(error, stdoutBuffer.text, stderrBuffer.text);
  } finally {
    child.kill('SIGTERM');
    await child.exited.catch(() => undefined);
    await Promise.allSettled([stdoutDrain, stderrDrain]);
    removeTrackedChild(childProcesses, child);
    await removeDemoWorkspace(workspaceCopy);
  }
}, 60_000);

async function fetchText(port: number, requestPath: string): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}${requestPath}`);
  if (!response.ok) {
    throw new Error(`Unexpected status: ${response.status}`);
  }

  return await response.text();
}
