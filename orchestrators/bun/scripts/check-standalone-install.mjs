#!/usr/bin/env bun

import os from 'node:os';
import path from 'node:path';
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';

const scriptRoot = path.dirname(new URL(import.meta.url).pathname);
const packageRoot = path.resolve(scriptRoot, '..');
const artifactsRoot = path.join(packageRoot, 'artifacts');
const repoRoot = path.resolve(packageRoot, '..', '..');
const backendPackageRoot = path.join(repoRoot, 'packages', 'tooling', 'webstir-backend');

async function main() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'webstir-standalone-install-'));
  const consumerRoot = path.join(tempRoot, 'consumer');
  const existingArtifacts = await listArtifacts(artifactsRoot);
  const existingBackendTarballs = await listArtifacts(backendPackageRoot);
  let tarballPath = null;
  let backendTarballPath = null;
  let keepWorkspace = false;

  try {
    await mkdir(consumerRoot, { recursive: true });
    await writeFile(
      path.join(consumerRoot, 'package.json'),
      `${JSON.stringify({ name: 'webstir-standalone-smoke', private: true }, null, 2)}\n`,
      'utf8',
    );

    tarballPath = await packStandaloneTarball();
    console.log(`[webstir][install-smoke] tarball ${tarballPath}`);
    backendTarballPath = await packPackageTarball(backendPackageRoot);
    console.log(`[webstir][install-smoke] backend tarball ${backendTarballPath}`);

    await run(['bun', 'add', tarballPath], consumerRoot);

    const cliPath = path.join(consumerRoot, 'node_modules', '.bin', 'webstir');
    await assertExists(cliPath, 'installed CLI binary');

    await run([cliPath, 'init', 'full', 'site'], consumerRoot);

    const workspaceRoot = path.join(consumerRoot, 'site');
    await assertExists(
      path.join(workspaceRoot, 'package.json'),
      'scaffolded workspace package.json',
    );

    await run(['bun', 'install'], workspaceRoot);
    await installLocalBackendTarball(workspaceRoot, backendTarballPath);
    await assertExists(
      path.join(workspaceRoot, 'node_modules', '.bin', 'webstir-backend-deploy'),
      'workspace deploy runner binary',
    );
    await run([cliPath, 'build', '--workspace', workspaceRoot], workspaceRoot);

    await assertExists(
      path.join(workspaceRoot, 'build', 'backend', 'index.js'),
      'backend build output',
    );
    await assertExists(path.join(workspaceRoot, 'build', 'frontend'), 'frontend build output');
    await assertExists(
      path.join(workspaceRoot, '.webstir', 'backend-outputs.json'),
      'backend outputs cache',
    );
    await assertExists(
      path.join(workspaceRoot, '.webstir', 'backend-manifest-digest.json'),
      'backend manifest digest',
    );
    await assertExists(
      path.join(workspaceRoot, '.webstir', 'frontend-manifest.json'),
      'frontend manifest',
    );

    console.log('[webstir][install-smoke] standalone install smoke passed');
  } catch (error) {
    keepWorkspace = (process.env.WEBSTIR_INSTALL_SMOKE_KEEP ?? '').toLowerCase() === '1';
    if (keepWorkspace) {
      console.error(`[webstir][install-smoke] preserving failed workspace at ${tempRoot}`);
    }
    throw error;
  } finally {
    if (tarballPath) {
      await cleanupGeneratedTarball(tarballPath, existingArtifacts);
    }
    if (backendTarballPath) {
      await cleanupGeneratedTarball(backendTarballPath, existingBackendTarballs);
    }
    if (!keepWorkspace) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}

async function packStandaloneTarball() {
  const output = await run(['bun', 'run', 'pack:standalone'], packageRoot);
  const tarballPath = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.endsWith('-standalone.tgz'))
    .at(-1);

  if (!tarballPath) {
    throw new Error(`Unable to determine standalone tarball path from pack output:\n${output}`);
  }

  return path.resolve(packageRoot, tarballPath);
}

async function packPackageTarball(root) {
  const output = await run(['bun', 'pm', 'pack'], root);
  const tarballPath = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.tgz'))
    .at(-1);

  if (!tarballPath) {
    throw new Error(`Unable to determine package tarball path from pack output:\n${output}`);
  }

  return path.resolve(root, tarballPath);
}

async function installLocalBackendTarball(workspaceRoot, backendTarballPath) {
  await run(['bun', 'remove', '@webstir-io/webstir-backend'], workspaceRoot);
  await run(['bun', 'add', backendTarballPath], workspaceRoot);
}

async function assertExists(targetPath, label) {
  try {
    await access(targetPath, fsConstants.F_OK);
  } catch {
    throw new Error(`Expected ${label} at ${targetPath}`);
  }
}

async function listArtifacts(root) {
  try {
    return new Set(await readdir(root));
  } catch {
    return new Set();
  }
}

async function cleanupGeneratedTarball(tarballPath, existingArtifacts) {
  const tarballName = path.basename(tarballPath);
  if (existingArtifacts.has(tarballName)) {
    return;
  }

  await rm(tarballPath, { force: true });

  const remaining = await listArtifacts(artifactsRoot);
  if (remaining.size === 0) {
    await rm(artifactsRoot, { recursive: true, force: true });
  }
}

async function run(command, cwd) {
  const proc = Bun.spawn({
    cmd: command,
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    const detail = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
    throw new Error(
      `Command failed (${exitCode}): ${command.join(' ')}${detail ? `\n${detail}` : ''}`,
    );
  }

  return stdout;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
