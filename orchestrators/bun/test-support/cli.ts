import path from 'node:path';

import { packageRoot, repoRoot } from '../src/paths.ts';

export interface CliResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs a command without blocking. A blocking spawn (`spawnSync`, `execSync`) in a `bun test`
 * worker has waited forever in CI for a child that had already exited, so tests never use one.
 */
export async function runCommand(
  cmd: readonly string[],
  options: { readonly cwd?: string; readonly env?: Record<string, string | undefined> } = {},
): Promise<CliResult> {
  const child = Bun.spawn({
    cmd: [...cmd],
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

/** Runs the webstir CLI without blocking; see `runCommand`. */
export function runWebstir(
  args: readonly string[],
  options: { readonly cwd?: string; readonly env?: Record<string, string | undefined> } = {},
): Promise<CliResult> {
  return runCommand([process.execPath, path.join(packageRoot, 'src', 'cli.ts'), ...args], options);
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
