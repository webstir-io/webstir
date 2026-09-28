import path from 'node:path';

import { packageRoot, repoRoot } from '../src/paths.ts';

export interface CliResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs the webstir CLI without blocking. A blocking spawn in a test worker that also runs Chromium
 * has waited forever in CI for a child that had already finished.
 */
export async function runWebstir(
  args: readonly string[],
  options: { readonly cwd?: string; readonly env?: Record<string, string | undefined> } = {},
): Promise<CliResult> {
  const child = Bun.spawn({
    cmd: [process.execPath, path.join(packageRoot, 'src', 'cli.ts'), ...args],
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

export async function runWebstirOrThrow(
  args: readonly string[],
  options: { readonly cwd?: string; readonly env?: Record<string, string | undefined> } = {},
): Promise<CliResult> {
  const result = await runWebstir(args, options);
  if (result.exitCode !== 0) {
    throw new Error(
      `webstir ${args.join(' ')} failed with exit code ${result.exitCode}.\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`,
    );
  }
  return result;
}
