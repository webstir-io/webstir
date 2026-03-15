#!/usr/bin/env bun

import os from 'node:os';
import path from 'node:path';
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';

const scriptRoot = path.dirname(new URL(import.meta.url).pathname);
const packageRoot = path.resolve(scriptRoot, '..');
const repoRoot = path.resolve(packageRoot, '..', '..');
const outputRoot = path.join(packageRoot, 'artifacts');

const internalPackages = [
  ['@webstir-io/module-contract', path.join(repoRoot, 'packages', 'contracts', 'module-contract')],
  ['@webstir-io/testing-contract', path.join(repoRoot, 'packages', 'contracts', 'testing-contract')],
  ['@webstir-io/webstir-frontend', path.join(repoRoot, 'packages', 'tooling', 'webstir-frontend')],
  ['@webstir-io/webstir-backend', path.join(repoRoot, 'packages', 'tooling', 'webstir-backend')],
  ['@webstir-io/webstir-testing', path.join(repoRoot, 'packages', 'tooling', 'webstir-testing')],
];

async function main() {
  await run(['bun', 'run', 'build:deps'], packageRoot);
  await run(['node', 'scripts/sync-assets.mjs'], packageRoot);

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'webstir-standalone-pack-'));
  const tarballRoot = path.join(tempRoot, 'tarballs');
  const stageRoot = path.join(tempRoot, 'stage');

  await mkdir(tarballRoot, { recursive: true });
  await mkdir(stageRoot, { recursive: true });
  await mkdir(outputRoot, { recursive: true });

  try {
    const tarballs = new Map();
    for (const [name, cwd] of internalPackages) {
      tarballs.set(name, await packPackage(cwd, tarballRoot));
    }

    await cp(path.join(packageRoot, 'assets'), path.join(stageRoot, 'assets'), { recursive: true });
    await cp(path.join(packageRoot, 'src'), path.join(stageRoot, 'src'), { recursive: true });
    await cp(path.join(packageRoot, 'README.md'), path.join(stageRoot, 'README.md'));

    const packageJson = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
    const originalDependencies = { ...packageJson.dependencies };
    packageJson.dependencies = Object.fromEntries(
      Object.entries(originalDependencies).map(([name, version]) => {
        const tarballPath = tarballs.get(name);
        if (!tarballPath) {
          return [name, version];
        }

        return [name, `file:${path.relative(stageRoot, tarballPath).split(path.sep).join('/')}`];
      })
    );
    packageJson.bundledDependencies = Object.keys(packageJson.dependencies);
    packageJson.files = ['assets', 'src', 'README.md'];
    delete packageJson.scripts;
    delete packageJson.devDependencies;

    await writeFile(path.join(stageRoot, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

    await run(['bun', 'install'], stageRoot);
    packageJson.dependencies = originalDependencies;
    await writeFile(path.join(stageRoot, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
    const tarballName = (await run(['bun', 'pm', 'pack'], stageRoot))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.endsWith('.tgz'))
      .at(-1);

    if (!tarballName) {
      throw new Error('Failed to locate standalone tarball output.');
    }

    const standaloneName = tarballName.replace(/\.tgz$/, '-standalone.tgz');
    const destination = path.join(outputRoot, standaloneName);
    await rm(destination, { force: true });
    await rename(path.join(stageRoot, tarballName), destination);
    console.log(destination);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function packPackage(cwd, outputDir) {
  const tarballName = (await run(['bun', 'pm', 'pack'], cwd))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.tgz'))
    .at(-1);

  if (!tarballName) {
    throw new Error(`Failed to pack ${cwd}`);
  }

  const source = path.join(cwd, tarballName);
  const destination = path.join(outputDir, tarballName);
  await rename(source, destination);
  return destination;
}

async function run(command, cwd) {
  const [program, ...args] = command;

  try {
    return await Bun.$.cwd(cwd)`${program} ${args}`.text();
  } catch (error) {
    const exitCode =
      typeof error === 'object' &&
      error !== null &&
      'exitCode' in error &&
      typeof error.exitCode === 'number'
        ? error.exitCode
        : null;
    if (exitCode === null) {
      throw error;
    }

    throw new Error(`Command failed (${exitCode}): ${program} ${args.join(' ')}`, {
      cause: error,
    });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
