import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { packageRoot, repoRoot } from '../src/paths.ts';

test('real compiler failures retain source diagnostics in CLI and agent validation', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'webstir-typecheck-diagnostic-'));
  try {
    await mkdir(path.join(workspace, 'src/backend'), { recursive: true });
    await writeFile(
      path.join(workspace, 'package.json'),
      JSON.stringify({ name: 'invalid-types', type: 'module', webstir: { mode: 'api' } }),
    );
    await writeFile(
      path.join(workspace, 'src/backend/tsconfig.json'),
      JSON.stringify({
        compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true, types: [] },
        include: ['index.ts'],
      }),
    );
    await writeFile(
      path.join(workspace, 'src/backend/index.ts'),
      "export const count: number = 'invalid';\n",
    );

    const build = runCli(['build', '--workspace', workspace]);
    expect(build.exitCode).toBe(1);
    expect(build.stderr).toContain('Type checking failed');
    expect(build.stderr).toMatch(/src\/backend\/index\.ts\(1,14\): error TS2322/);
    expect(build.stderr).toContain("Type 'string' is not assignable to type 'number'.");
    expect(build.stderr).not.toContain('\u001b[');
    expect(`${build.stdout}${build.stderr}`).not.toContain('private-environment-marker');

    const validation = runCli(['agent', 'validate', '--json', '--workspace', workspace]);
    expect(validation.exitCode).toBe(1);
    const result = JSON.parse(validation.stdout) as {
      success: boolean;
      doctor: { healthy: boolean; issues: Array<{ code: string; message: string }> };
      steps: Array<{ id: string; status: string }>;
    };
    expect(result.success).toBe(false);
    expect(result.doctor.healthy).toBe(false);
    const error = result.doctor.issues.find((issue) => issue.code === 'backend_inspect_failed');
    expect(error?.message).toMatch(/src\/backend\/index\.ts\(1,14\): error TS2322/);
    expect(result.steps).toContainEqual(expect.objectContaining({ id: 'test', status: 'skipped' }));
    expect(validation.stdout).not.toContain('private-environment-marker');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

function runCli(args: string[]) {
  const result = Bun.spawnSync({
    cmd: [process.execPath, path.join(packageRoot, 'src/cli.ts'), ...args],
    cwd: repoRoot,
    env: {
      ...process.env,
      WEBSTIR_BACKEND_TYPECHECK: 'true',
      WEBSTIR_DIAGNOSTIC_TEST_SECRET: 'private-environment-marker',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}
