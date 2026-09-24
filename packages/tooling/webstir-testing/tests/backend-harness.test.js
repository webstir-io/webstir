import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createBackendTestHarness } from '../dist/backend/harness.js';
import { createTempWorkspace, removeWorkspace } from './support.js';

const HARNESS_ENV_KEYS = [
  'WEBSTIR_WORKSPACE_ROOT',
  'WEBSTIR_BACKEND_TEST_ENTRY',
  'WEBSTIR_BACKEND_TEST_PORT',
  'API_BASE_URL',
];

async function withHarnessEnv(values, run) {
  const previous = Object.fromEntries(HARNESS_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of HARNESS_ENV_KEYS) {
    delete process.env[key];
  }
  Object.assign(process.env, values);

  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('backend harness retries on a fresh port when the server reports EADDRINUSE', async () => {
  const workspaceRoot = await createTempWorkspace('webstir-testing-harness-port-');
  const entry = path.join(workspaceRoot, 'server.mjs');
  const attemptsLog = path.join(workspaceRoot, 'attempts.log');

  await writeFile(
    entry,
    `import { appendFileSync, existsSync } from 'node:fs';
import http from 'node:http';

const logPath = ${JSON.stringify(attemptsLog)};
const firstAttempt = !existsSync(logPath);
appendFileSync(logPath, process.env.PORT + '\\n');

if (firstAttempt) {
  console.error('error: listen EADDRINUSE: address already in use 127.0.0.1:' + process.env.PORT);
  process.exit(1);
}

http
  .createServer((_request, response) => response.end(process.env.PORT))
  .listen(Number(process.env.PORT), '127.0.0.1', () => console.log('API server running'));
`,
    'utf8',
  );

  let harness;
  try {
    await withHarnessEnv(
      { WEBSTIR_WORKSPACE_ROOT: workspaceRoot, WEBSTIR_BACKEND_TEST_ENTRY: entry },
      async () => {
        harness = await createBackendTestHarness();
      },
    );

    const attempts = (await readFile(attemptsLog, 'utf8')).trim().split('\n').map(Number);
    assert.equal(attempts.length, 2);
    assert.equal(harness.context.port, attempts[1]);

    const response = await harness.context.request('/');
    assert.equal(await response.text(), String(harness.context.port));
  } finally {
    await harness?.stop();
    await removeWorkspace(workspaceRoot);
  }
});
