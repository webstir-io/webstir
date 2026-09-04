#!/usr/bin/env bun

import os from 'node:os';
import path from 'node:path';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';

const scriptRoot = path.dirname(new URL(import.meta.url).pathname);
const packageRoot = path.resolve(scriptRoot, '..');
const repoRoot = path.resolve(packageRoot, '..', '..');
const moduleContractPackageRoot = path.join(repoRoot, 'packages', 'contracts', 'module-contract');
const testingContractPackageRoot = path.join(repoRoot, 'packages', 'contracts', 'testing-contract');
const backendPackageRoot = path.join(repoRoot, 'packages', 'tooling', 'webstir-backend');
const frontendPackageRoot = path.join(repoRoot, 'packages', 'tooling', 'webstir-frontend');
const testingPackageRoot = path.join(repoRoot, 'packages', 'tooling', 'webstir-testing');

async function main() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'webstir-package-install-'));
  const installRoot = path.join(tempRoot, 'install-root');
  const workspaceRoot = path.join(tempRoot, 'site');
  const existingTarballs = await listTarballs(packageRoot);
  const localPackageSpecs = {
    '@webstir-io/module-contract': `file:${moduleContractPackageRoot}`,
    '@webstir-io/testing-contract': `file:${testingContractPackageRoot}`,
    '@webstir-io/webstir-backend': `file:${backendPackageRoot}`,
    '@webstir-io/webstir-frontend': `file:${frontendPackageRoot}`,
    '@webstir-io/webstir-testing': `file:${testingPackageRoot}`,
  };
  let tarballPath = null;
  let keepWorkspace = false;

  try {
    await mkdir(installRoot, { recursive: true });
    tarballPath = await packPackageTarball();
    console.log(`[webstir][install-smoke] tarball ${tarballPath}`);

    await writeInstallRootManifest(installRoot, {
      webstirTarballPath: tarballPath,
      localPackageSpecs,
    });
    await run(['bun', 'install'], installRoot);

    const cliPath = path.join(installRoot, 'node_modules', '.bin', 'webstir');
    await assertExists(cliPath, 'installed CLI binary');

    await run([cliPath, 'init', 'full', workspaceRoot], installRoot);
    await assertPackageManagedBackendScaffold(workspaceRoot);

    await assertExists(
      path.join(workspaceRoot, 'package.json'),
      'scaffolded workspace package.json',
    );
    await assertPublishedDependencySpecs(installRoot, workspaceRoot, [
      '@webstir-io/webstir-frontend',
      '@webstir-io/webstir-backend',
      '@webstir-io/webstir-testing',
    ]);

    await writeWorkspaceLocalPackageOverrides(workspaceRoot, localPackageSpecs);
    await run(['bun', 'install'], workspaceRoot);
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

    console.log('[webstir][install-smoke] package install smoke passed');
  } catch (error) {
    keepWorkspace = (process.env.WEBSTIR_INSTALL_SMOKE_KEEP ?? '').toLowerCase() === '1';
    if (keepWorkspace) {
      console.error(`[webstir][install-smoke] preserving failed workspace at ${tempRoot}`);
    }
    throw error;
  } finally {
    if (tarballPath) {
      await cleanupGeneratedTarball(tarballPath, existingTarballs);
    }
    if (!keepWorkspace) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}

async function assertPublishedDependencySpecs(installRoot, workspaceRoot, packageNames) {
  const workspacePackageJson = JSON.parse(
    await readFile(path.join(workspaceRoot, 'package.json'), 'utf8'),
  );
  const dependencies = workspacePackageJson.dependencies ?? {};

  for (const packageName of packageNames) {
    const dependencySpec = dependencies[packageName];
    if (!dependencySpec) {
      throw new Error(
        `Expected scaffolded dependency ${packageName} in ${path.join(workspaceRoot, 'package.json')}`,
      );
    }
    if (dependencySpec === 'workspace:*') {
      throw new Error(`Expected published dependency for ${packageName}, received workspace:*`);
    }

    const installedVersion = await readInstalledPackageVersion(installRoot, packageName);
    if (dependencySpec !== `^${installedVersion}`) {
      throw new Error(
        `Expected ${packageName} dependency spec ^${installedVersion}, received ${dependencySpec}`,
      );
    }
  }
}

async function assertPackageManagedBackendScaffold(workspaceRoot) {
  const backendRoot = path.join(workspaceRoot, 'src', 'backend');
  const backendIndexPath = path.join(backendRoot, 'index.ts');
  const backendIndex = await readFile(backendIndexPath, 'utf8');

  if (!backendIndex.includes('createDefaultBunBackendBootstrap')) {
    throw new Error(`Expected package-managed Bun bootstrap helper in ${backendIndexPath}`);
  }
  if (backendIndex.includes('http.createServer')) {
    throw new Error(`Expected thinner backend entrypoint in ${backendIndexPath}`);
  }

  await assertMissing(path.join(backendRoot, 'server', 'bun.ts'), 'legacy Bun backend wrapper');
  await assertMissing(
    path.join(backendRoot, 'runtime'),
    'legacy backend runtime wrapper directory',
  );
  await assertExists(path.join(backendRoot, 'module.ts'), 'backend module definition');
}

async function writeWorkspaceLocalPackageOverrides(workspaceRoot, localPackageSpecs) {
  const packageJsonPath = path.join(workspaceRoot, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  packageJson.overrides = {
    ...(packageJson.overrides ?? {}),
    ...localPackageSpecs,
  };
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
}

async function writeInstallRootManifest(installRoot, options = {}) {
  const dependencies = { ...(options.localPackageSpecs ?? {}) };
  if (options.webstirTarballPath) {
    dependencies['@webstir-io/webstir'] = options.webstirTarballPath;
  }

  const packageJson = {
    name: 'webstir-package-smoke',
    private: true,
    ...(Object.keys(dependencies).length > 0 ? { dependencies } : {}),
    ...(options.localPackageSpecs
      ? {
          overrides: options.localPackageSpecs,
        }
      : {}),
  };

  await writeFile(
    path.join(installRoot, 'package.json'),
    `${JSON.stringify(packageJson, null, 2)}\n`,
    'utf8',
  );
}

async function packPackageTarball() {
  const output = await run(['bun', 'run', 'pack:local'], packageRoot);
  return resolvePackedTarballPath(output, packageRoot);
}

function resolvePackedTarballPath(output, root) {
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

async function readInstalledPackageVersion(installRoot, packageName) {
  const packageJsonPath = path.join(
    installRoot,
    'node_modules',
    ...packageName.split('/'),
    'package.json',
  );
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  if (!packageJson.version) {
    throw new Error(`Missing version in ${packageJsonPath}`);
  }

  return packageJson.version;
}

async function assertExists(targetPath, label) {
  try {
    await access(targetPath, fsConstants.F_OK);
  } catch {
    throw new Error(`Expected ${label} at ${targetPath}`);
  }
}

async function assertMissing(targetPath, label) {
  try {
    await access(targetPath, fsConstants.F_OK);
  } catch {
    return;
  }

  throw new Error(`Expected ${label} to be absent at ${targetPath}`);
}

async function listTarballs(root) {
  try {
    return new Set((await readdir(root)).filter((entry) => entry.endsWith('.tgz')));
  } catch {
    return new Set();
  }
}

async function cleanupGeneratedTarball(tarballPath, existingTarballs) {
  const tarballName = path.basename(tarballPath);
  if (existingTarballs.has(tarballName)) {
    return;
  }

  await rm(tarballPath, { force: true });
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
