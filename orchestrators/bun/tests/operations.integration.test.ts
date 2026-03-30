import { expect, test } from 'bun:test';
import path from 'node:path';

import { packageRoot, repoRoot } from '../src/paths.ts';

function decodeOutput(buffer: Uint8Array | undefined): string {
  return new TextDecoder().decode(buffer ?? new Uint8Array());
}

async function runCli(args: readonly string[]): Promise<{
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}> {
  const processResult = Bun.spawnSync({
    cmd: [process.execPath, path.join(packageRoot, 'src', 'cli.ts'), ...args],
    cwd: repoRoot,
    env: process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return {
    stdout: decodeOutput(processResult.stdout),
    stderr: decodeOutput(processResult.stderr),
    exitCode: processResult.exitCode,
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
