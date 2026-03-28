import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export const EVENT_PREFIX = 'WEBSTIR_TEST ';
export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function createTempWorkspace(prefix = 'webstir-testing-workspace-') {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.writeFile(
    path.join(workspaceRoot, 'package.json'),
    JSON.stringify(
      {
        name: '@demo/webstir-testing-workspace',
        version: '0.0.0',
        type: 'module',
      },
      null,
      2,
    ),
    'utf8',
  );
  return workspaceRoot;
}

export async function removeWorkspace(workspaceRoot) {
  await fs.rm(workspaceRoot, { recursive: true, force: true });
}

export async function writeWorkspaceTest(
  workspaceRoot,
  runtime,
  stem,
  { pass = true, testName = `${runtime} ${stem}` } = {},
) {
  const sourcePath = path.join(workspaceRoot, 'src', runtime, 'tests', `${stem}.test.ts`);
  const buildPath = path.join(workspaceRoot, 'build', runtime, 'tests', `${stem}.test.js`);

  await fs.mkdir(path.dirname(sourcePath), { recursive: true });
  await fs.mkdir(path.dirname(buildPath), { recursive: true });
  await fs.writeFile(sourcePath, `// source fixture for ${testName}\n`, 'utf8');
  await fs.writeFile(buildPath, makeCompiledTestSource(testName, pass), 'utf8');

  return { sourcePath, buildPath };
}

export function runEntrypoint(entrypoint, args, { env = {} } = {}) {
  return spawnSync('bun', [entrypoint, ...args], {
    cwd: packageRoot,
    env: {
      ...process.env,
      ...env,
    },
    encoding: 'utf8',
  });
}

export function runCli(args, options) {
  return runEntrypoint('dist/cli.js', args, options);
}

export function startCli(args, { env = {} } = {}) {
  const child = spawn('bun', ['dist/cli.js', ...args], {
    cwd: packageRoot,
    env: {
      ...process.env,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  return child;
}

export function parseEvents(stdout) {
  return stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith(EVENT_PREFIX))
    .map((line) => JSON.parse(line.slice(EVENT_PREFIX.length)));
}

export function collectCliEvents(child) {
  const state = {
    stdout: '',
    stderr: '',
    events: [],
  };
  let stdoutBuffer = '';

  child.stdout.on('data', (chunk) => {
    state.stdout += chunk;
    stdoutBuffer += chunk;

    while (true) {
      const newlineIndex = stdoutBuffer.indexOf('\n');
      if (newlineIndex < 0) {
        break;
      }

      const line = stdoutBuffer.slice(0, newlineIndex);
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (!line.startsWith(EVENT_PREFIX)) {
        continue;
      }

      state.events.push(JSON.parse(line.slice(EVENT_PREFIX.length)));
    }
  });

  child.stderr.on('data', (chunk) => {
    state.stderr += chunk;
  });

  return {
    get stdout() {
      return state.stdout;
    },
    get stderr() {
      return state.stderr;
    },
    get events() {
      return state.events;
    },
    async waitForEvent(predicate, timeoutMs = 5000) {
      const start = Date.now();

      while (Date.now() - start < timeoutMs) {
        const match = state.events.find(predicate);
        if (match) {
          return match;
        }

        await delay(25);
      }

      throw new Error(
        `Timed out waiting for event.\nstdout:\n${state.stdout}\nstderr:\n${state.stderr}`,
      );
    },
  };
}

export async function stopChild(child) {
  if (!child.killed) {
    child.kill('SIGINT');
  }

  await onceExit(child);
}

function onceExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }

    child.once('exit', () => resolve());
  });
}

function makeCompiledTestSource(testName, pass) {
  const assertion = pass ? 'assert.isTrue(true);' : 'assert.equal(1, 2);';
  return `const { test, assert } = require('@webstir-io/webstir-testing');

test(${JSON.stringify(testName)}, () => {
  ${assertion}
});
`;
}
