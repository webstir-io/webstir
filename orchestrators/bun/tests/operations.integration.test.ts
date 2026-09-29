import { expect, test } from 'bun:test';
import path from 'node:path';

import { packageRoot, repoRoot } from '../src/paths.ts';
import { runWebstir } from '../test-support/cli.ts';

async function runCli(args: readonly string[]): Promise<{
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}> {
  const processResult = await runWebstir(args, { cwd: repoRoot, env: process.env });

  return {
    stdout: processResult.stdout,
    stderr: processResult.stderr,
    exitCode: processResult.exitCode ?? -1,
  };
}

test('CLI operations emits a machine-readable operation catalog', async () => {
  const result = await runCli(['operations', '--json']);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');

  const parsed = JSON.parse(result.stdout) as {
    command: string;
    operations: Array<{
      id: string;
      supportsJson: boolean;
      stableForMcp: boolean;
    }>;
  };

  expect(parsed.command).toBe('operations');
  expect(parsed.operations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'inspect',
        supportsJson: true,
        stableForMcp: true,
      }),
      expect.objectContaining({
        id: 'frontend-inspect',
        supportsJson: true,
        stableForMcp: true,
      }),
      expect.objectContaining({
        id: 'doctor',
        supportsJson: true,
        stableForMcp: true,
      }),
      expect.objectContaining({
        id: 'repair',
        supportsJson: true,
        stableForMcp: true,
      }),
      expect.objectContaining({
        id: 'add-route',
        stableForMcp: true,
      }),
    ]),
  );
});
