import { afterEach, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { packageRoot, repoRoot } from '../src/paths.ts';
import { runWebstir } from '../test-support/cli.ts';
import { copyDemoWorkspace, removeDemoWorkspace } from '../test-support/demo-workspace.ts';
import {
  appendWatchLogs,
  collectOutput,
  getFreePort,
  removeTrackedChild,
  stopTrackedChildren,
  waitFor,
  type SpawnedProcess,
} from '../test-support/watch.ts';

const childProcesses: SpawnedProcess[] = [];

afterEach(async () => {
  await stopTrackedChildren(childProcesses);
});

const GREETING = 'Hello from a sibling module';

// An app's server entry, its jobs and its TypeScript migrations import the app's own modules; a
// development build carries those in as publish does.
async function writeAppWithSiblingImports(workspace: string): Promise<void> {
  const backend = path.join(workspace, 'src', 'backend');
  await mkdir(path.join(backend, 'shared'), { recursive: true });
  await mkdir(path.join(backend, 'jobs', 'greet'), { recursive: true });
  await mkdir(path.join(backend, 'migrations'), { recursive: true });
  await writeFile(
    path.join(backend, 'shared', 'greeting.ts'),
    `export const greeting = ${JSON.stringify(GREETING)};\n`,
  );
  await writeFile(
    path.join(backend, 'index.ts'),
    [
      "import http from 'node:http';",
      "import { greeting } from './shared/greeting.js';",
      'const port = Number(process.env.PORT || 4321);',
      'http',
      "  .createServer((_, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(greeting); })",
      "  .listen(port, '0.0.0.0', () => console.log(`API server running at http://localhost:${port}`));",
      '',
    ].join('\n'),
  );
  await writeFile(
    path.join(backend, 'jobs', 'greet', 'index.ts'),
    "import { greeting } from '../../shared/greeting.js';\nconsole.log(greeting);\n",
  );
  await writeFile(
    path.join(backend, 'migrations', '0001_greet.ts'),
    [
      "import { greeting } from '../shared/greeting.js';",
      'export async function up(): Promise<void> {',
      '  if (!greeting) throw new Error("the sibling module did not load");',
      '}',
      '',
    ].join('\n'),
  );
}

async function builtFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await builtFiles(full)));
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

async function danglingImports(buildRoot: string): Promise<string[]> {
  const dangling: string[] = [];
  for (const file of await builtFiles(buildRoot)) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(/(?:from\s*|import\s*\(?\s*)["'](\.\.?\/[^"']+)["']/g)) {
      const target = path.resolve(path.dirname(file), match[1] as string);
      if (!existsSync(target)) dangling.push(`${path.relative(buildRoot, file)} -> ${match[1]}`);
    }
  }
  return dangling.sort();
}

test('a development build carries in the app’s own imports: nothing is left dangling, and the server entry runs', async () => {
  const copy = await copyDemoWorkspace('api', 'webstir-dev-build-imports');
  const workspace = copy.workspaceRoot;
  try {
    await writeAppWithSiblingImports(workspace);
    const env = { ...process.env, WEBSTIR_BACKEND_TYPECHECK: 'skip' };

    const built = await runWebstir(['build', '--workspace', workspace], { env });
    expect(built.exitCode, built.stderr).toBe(0);
    expect(await danglingImports(path.join(workspace, 'build', 'backend'))).toEqual([]);

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
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    childProcesses.push(child);
    const stdout = { text: '' };
    const stderr = { text: '' };
    const drains = [collectOutput(child.stdout, stdout), collectOutput(child.stderr, stderr)];
    try {
      await waitFor(async () => {
        const response = await fetch(`http://127.0.0.1:${port}/`);
        expect(await response.text()).toBe(GREETING);
      }, 30_000);
      expect(await danglingImports(path.join(workspace, 'build', 'backend'))).toEqual([]);
    } catch (error) {
      throw appendWatchLogs(error, stdout.text, stderr.text);
    } finally {
      child.kill('SIGTERM');
      await child.exited.catch(() => undefined);
      await Promise.allSettled(drains);
      removeTrackedChild(childProcesses, child);
    }
    // Stopped the moment it answered, while watch was still starting: the server went with it.
    const stillAnswering = await fetch(`http://127.0.0.1:${port}/`).then(
      () => true,
      () => false,
    );
    expect(stillAnswering).toBe(false);
  } finally {
    await removeDemoWorkspace(copy);
  }
}, 120_000);
