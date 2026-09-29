import { expect, test } from 'bun:test';
import path from 'node:path';

import { packageRoot, repoRoot } from '../src/paths.ts';
import { copyDemoWorkspace, removeDemoWorkspace } from '../test-support/demo-workspace.ts';
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

test('CLI frontend-inspect reports frontend pages and feature flags for a full workspace', async () => {
  const copiedWorkspace = await copyDemoWorkspace('full', 'webstir-frontend-inspect-full-');

  try {
    const result = await runCli([
      'frontend-inspect',
      '--json',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');

    const parsed = JSON.parse(result.stdout) as {
      command: string;
      workspace: { mode: string; root: string };
      frontend: {
        packageJson: { enable: { known: { clientNav: boolean } } };
        pages: Array<{ name: string; htmlExists: boolean }>;
        appShell: { templateExists: boolean };
      };
    };

    expect(parsed.command).toBe('frontend-inspect');
    expect(parsed.workspace.layers).toEqual({ pages: true, server: true });
    expect(parsed.workspace.root).toBe(copiedWorkspace.workspaceRoot);
    expect(parsed.frontend.packageJson.enable.known.clientNav).toBe(true);
    expect(parsed.frontend.appShell.templateExists).toBe(true);
    expect(parsed.frontend.pages).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'home', htmlExists: true })]),
    );
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI frontend-inspect rejects backend-only workspaces', async () => {
  const copiedWorkspace = await copyDemoWorkspace('api', 'webstir-frontend-inspect-api-');

  try {
    const result = await runCli(['frontend-inspect', '--workspace', copiedWorkspace.workspaceRoot]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('frontend-inspect needs pages');
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});
