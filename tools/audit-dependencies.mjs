#!/usr/bin/env bun

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const decoder = new TextDecoder();

const transportFailurePatterns = [
  /audit request failed/i,
  /connectionclosed/i,
  /fetch failed/i,
  /socket hang up/i,
  /\btimeout\b/i,
  /\beai_again\b/i,
  /\beconn(?:aborted|refused|reset)\b/i,
  /\benetunreach\b/i,
];

export function isAuditTransportFailure(output) {
  return transportFailurePatterns.some((pattern) => pattern.test(output));
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function runAudit() {
  const result = Bun.spawnSync({
    cmd: ['bun', 'audit', '--audit-level=high'],
    cwd: repoRoot,
    stdin: 'inherit',
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env,
  });
  return {
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout ? decoder.decode(result.stdout) : '',
    stderr: result.stderr ? decoder.decode(result.stderr) : '',
  };
}

async function main() {
  const retryDelays = [0, 2_000, 5_000];

  for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
    if (retryDelays[attempt] > 0) {
      await sleep(retryDelays[attempt]);
    }

    const result = runAudit();
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    if (result.exitCode === 0) {
      return;
    }

    const output = `${result.stdout}\n${result.stderr}`;
    const shouldRetry = isAuditTransportFailure(output) && attempt < retryDelays.length - 1;
    if (!shouldRetry) {
      process.exit(result.exitCode);
    }

    console.error(
      `[webstir][audit] registry transport failed; retrying (${attempt + 2}/${retryDelays.length})`,
    );
  }
}

function isCliInvocation() {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint && path.resolve(entrypoint) === fileURLToPath(import.meta.url));
}

if (isCliInvocation()) {
  await main();
}
