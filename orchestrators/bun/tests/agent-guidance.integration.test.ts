import { expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';

import { assetsRoot, packageRoot, repoRoot } from '../src/paths.ts';

function runCli(args: readonly string[]) {
  const result = Bun.spawnSync({
    cmd: [process.execPath, path.join(packageRoot, 'src', 'cli.ts'), ...args],
    cwd: repoRoot,
    env: process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
    exitCode: result.exitCode,
  };
}

test('new app guidance is available in each supported scaffold mode', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webstir-agent-guidance-init-'));
  const expected = await readFile(
    path.join(assetsRoot, 'templates', 'shared', 'AGENTS.md'),
    'utf8',
  );
  try {
    for (const mode of ['full', 'api', 'spa', 'ssg']) {
      const workspace = path.join(root, mode);
      const result = runCli(['init', mode, workspace]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(
        `Read app instructions: ${path.join(workspace, 'AGENTS.md')}`,
      );
      expect(result.stdout).toContain(
        `Installed recipes and setup: ${path.join(assetsRoot, 'guides', 'README.md')}`,
      );
      expect(await readFile(path.join(workspace, 'AGENTS.md'), 'utf8')).toBe(expected);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('repair previews and restores missing instructions without changing app customization', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webstir-agent-guidance-repair-'));
  const workspace = path.join(root, 'site');
  try {
    expect(runCli(['init', 'ssg', workspace]).exitCode).toBe(0);
    const instructions = path.join(workspace, 'AGENTS.md');
    const customPage = path.join(workspace, 'src', 'frontend', 'pages', 'home', 'index.html');
    const customContent = '<h1>Application-owned content</h1>\n';
    const expected = await readFile(instructions, 'utf8');
    await writeFile(customPage, customContent);
    await rm(instructions);

    const preview = runCli(['repair', '--dry-run', '--json', '--workspace', workspace]);
    expect(preview.exitCode).toBe(0);
    expect(JSON.parse(preview.stdout).changes).toContain('AGENTS.md');
    expect(existsSync(instructions)).toBe(false);
    expect(await readFile(customPage, 'utf8')).toBe(customContent);

    const repair = runCli(['repair', '--json', '--workspace', workspace]);
    expect(repair.exitCode).toBe(0);
    expect(JSON.parse(repair.stdout).changes).toContain('AGENTS.md');
    expect(await readFile(instructions, 'utf8')).toBe(expected);
    expect(await readFile(customPage, 'utf8')).toBe(customContent);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('repair preserves user-authored instructions byte for byte', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webstir-agent-guidance-preserve-'));
  const workspace = path.join(root, 'site');
  try {
    expect(runCli(['init', 'ssg', workspace]).exitCode).toBe(0);
    const instructions = path.join(workspace, 'AGENTS.md');
    const customized = '# App-specific instructions\r\n\r\nKeep this exact content.\r\n';
    await writeFile(instructions, customized);
    await rm(path.join(workspace, 'Errors.404.html'));
    for (const flags of [['--dry-run'], []]) {
      const result = runCli(['repair', '--json', ...flags, '--workspace', workspace]);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).changes).not.toContain('AGENTS.md');
      expect(await readFile(instructions, 'utf8')).toBe(customized);
    }
    expect(existsSync(path.join(workspace, 'Errors.404.html'))).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('missing optional app instructions do not make an existing app unhealthy', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webstir-agent-guidance-health-'));
  const workspace = path.join(root, 'site');
  try {
    expect(runCli(['init', 'ssg', workspace]).exitCode).toBe(0);
    await rm(path.join(workspace, 'AGENTS.md'));

    const healthy = runCli(['doctor', '--json', '--workspace', workspace]);
    expect(healthy.exitCode).toBe(0);
    const diagnosis = JSON.parse(healthy.stdout);
    expect(diagnosis.healthy).toBe(true);
    expect(diagnosis.issues).toEqual([]);
    expect(diagnosis.repair.changes).toContain('AGENTS.md');
    expect(diagnosis.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'scaffold', status: 'pass' })]),
    );
    expect(existsSync(path.join(workspace, 'AGENTS.md'))).toBe(false);

    await rm(path.join(workspace, 'Errors.404.html'));
    const unhealthy = runCli(['doctor', '--json', '--workspace', workspace]);
    expect(unhealthy.exitCode).toBe(1);
    const drift = JSON.parse(unhealthy.stdout);
    expect(drift.healthy).toBe(false);
    expect(drift.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'scaffold_drift', changes: ['Errors.404.html'] }),
      ]),
    );
    expect(drift.repair.changes).toContain('AGENTS.md');
    expect(drift.repair.changes).toContain('Errors.404.html');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('agent validate still tests an existing app without optional instructions', {
  timeout: 15_000,
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webstir-agent-guidance-validate-'));
  const workspace = path.join(root, 'spa');
  try {
    expect(runCli(['init', 'spa', workspace]).exitCode).toBe(0);
    await symlink(
      path.join(packageRoot, 'node_modules'),
      path.join(workspace, 'node_modules'),
      'dir',
    );
    await rm(path.join(workspace, 'AGENTS.md'));
    const result = runCli(['agent', 'validate', '--json', '--workspace', workspace]);
    expect(result.exitCode).toBe(0);
    const validation = JSON.parse(result.stdout);
    expect(validation.success).toBe(true);
    expect(validation.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'doctor', status: 'completed' }),
        expect.objectContaining({ id: 'test', status: 'completed' }),
      ]),
    );
    expect(existsSync(path.join(workspace, 'AGENTS.md'))).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('existing instruction links and directories do not block unrelated scaffold repair', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webstir-agent-guidance-owned-'));
  try {
    const external = path.join(root, 'external.md');
    const content = '# Shared user instructions\n';
    await writeFile(external, content);

    for (const kind of ['symlink', 'dangling-symlink', 'directory']) {
      const workspace = path.join(root, kind);
      expect(runCli(['init', 'ssg', workspace]).exitCode).toBe(0);
      const instructions = path.join(workspace, 'AGENTS.md');
      await rm(instructions);
      if (kind === 'directory') {
        await mkdir(instructions);
      } else {
        await symlink(kind === 'symlink' ? external : path.join(root, 'missing.md'), instructions);
      }
      await rm(path.join(workspace, 'Errors.404.html'));

      const preview = runCli(['repair', '--dry-run', '--json', '--workspace', workspace]);
      expect(preview.exitCode).toBe(0);
      expect(JSON.parse(preview.stdout).changes).not.toContain('AGENTS.md');
      expect(existsSync(path.join(workspace, 'Errors.404.html'))).toBe(false);

      const repair = runCli(['repair', '--json', '--workspace', workspace]);
      expect(repair.exitCode).toBe(0);
      expect(JSON.parse(repair.stdout).changes).not.toContain('AGENTS.md');
      expect(existsSync(path.join(workspace, 'Errors.404.html'))).toBe(true);
      const preserved = await lstat(instructions);
      expect(kind === 'directory' ? preserved.isDirectory() : preserved.isSymbolicLink()).toBe(
        true,
      );
      expect(await readFile(external, 'utf8')).toBe(content);
      expect(runCli(['doctor', '--json', '--workspace', workspace]).exitCode).toBe(0);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('help locates the installed recipes and current starter instructions', async () => {
  const result = runCli(['--help']);
  const guide = path.join(assetsRoot, 'guides', 'README.md');
  const instructions = path.join(assetsRoot, 'templates', 'shared', 'AGENTS.md');
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain(`Recipes and coding-agent setup: ${guide}`);
  expect(result.stdout).toContain(`Starter app instructions: ${instructions}`);
  expect((await readFile(guide, 'utf8')).length).toBeGreaterThan(0);
  expect((await readFile(instructions, 'utf8')).length).toBeGreaterThan(0);
});

test('repair preserves removed starter tests while restoring required runtime files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webstir-agent-test-ownership-'));
  const workspace = path.join(root, 'full');
  try {
    expect(runCli(['init', 'full', workspace]).exitCode).toBe(0);
    await symlink(
      path.join(packageRoot, 'node_modules'),
      path.join(workspace, 'node_modules'),
      'dir',
    );
    const removedTests = [
      'src/backend/tests/progressive-enhancement.test.ts',
      'src/frontend/pages/home/tests/home.test.ts',
    ];
    for (const relativePath of removedTests) {
      await rm(path.join(workspace, relativePath));
    }
    const appTest = path.join(workspace, 'src', 'backend', 'tests', 'notes.test.ts');
    const appTestContent = '// Application-specific behavior checks belong here.\n';
    await writeFile(appTest, appTestContent);
    await rm(path.join(workspace, 'Errors.404.html'));

    for (const flags of [['--dry-run'], []]) {
      const result = runCli(['repair', '--json', ...flags, '--workspace', workspace]);
      expect(result.exitCode).toBe(0);
      const changes = JSON.parse(result.stdout).changes;
      expect(changes).toContain('Errors.404.html');
      for (const relativePath of removedTests) {
        expect(changes).not.toContain(relativePath);
        expect(existsSync(path.join(workspace, relativePath))).toBe(false);
      }
      expect(await readFile(appTest, 'utf8')).toBe(appTestContent);
    }
    expect(existsSync(path.join(workspace, 'Errors.404.html'))).toBe(true);
    const diagnosis = runCli(['doctor', '--json', '--workspace', workspace]);
    expect(diagnosis).toMatchObject({ exitCode: 0 });
    expect(JSON.parse(diagnosis.stdout).healthy).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
