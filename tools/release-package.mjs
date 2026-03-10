#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  getFrameworkPackageByCanonicalDir,
  getFrameworkReleaseTag,
  getRepoRoot,
  normalizeRelativePath,
} from './framework-packages.mjs';

const repoRoot = getRepoRoot(import.meta.url);

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function usage() {
  console.error(`Usage: release-package.mjs <patch|minor|major|x.y.z> [--no-push] [--package-dir <dir>]

Runs the canonical monorepo package release helper for one configured publishable package.
The helper bumps the version, syncs any embedded framework snapshot when present, runs clean/build/test/smoke,
creates a package-scoped release commit and tag, and optionally pushes both upstream.`);
  process.exit(1);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function readPackageJson(packageDir) {
  return JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
}

function hasScript(packageJson, scriptName) {
  return Boolean(packageJson.scripts && Object.prototype.hasOwnProperty.call(packageJson.scripts, scriptName));
}

function parseArgs(argv) {
  if (argv.length === 0) {
    usage();
  }

  let bump = '';
  let noPush = false;
  let packageDir = process.cwd();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--no-push') {
      noPush = true;
      continue;
    }

    if (arg === '--package-dir') {
      packageDir = argv[index + 1] ?? '';
      if (!packageDir) {
        fail('missing value for --package-dir');
      }
      index += 1;
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      usage();
    }

    if (bump) {
      fail(`unexpected extra argument "${arg}"`);
    }

    bump = arg;
  }

  if (!/^(patch|minor|major|\d+\.\d+\.\d+)$/.test(bump)) {
    fail(`invalid bump "${bump}"`);
  }

  return {
    bump,
    noPush:
      noPush ||
      /^(?:yes|y|1|true)$/i.test(process.env.PUBLISH_NO_PUSH ?? ''),
    packageDir: path.resolve(packageDir),
  };
}

function ensureCleanGit() {
  const worktree = spawnSync('git', ['diff', '--quiet', '--ignore-submodules', 'HEAD'], { cwd: repoRoot });
  if (worktree.status !== 0) {
    fail('git worktree has uncommitted changes');
  }

  const index = spawnSync('git', ['diff', '--quiet', '--cached', '--ignore-submodules'], { cwd: repoRoot });
  if (index.status !== 0) {
    fail('git index has staged changes');
  }
}

const options = parseArgs(process.argv.slice(2));
const relativePackageDir = normalizeRelativePath(path.relative(repoRoot, options.packageDir));
const frameworkPackage = getFrameworkPackageByCanonicalDir(relativePackageDir);

if (!frameworkPackage) {
  fail(`"${relativePackageDir}" is not a configured release package in the monorepo`);
}

ensureCleanGit();

const packageJsonPath = path.join(options.packageDir, 'package.json');

if (!existsSync(packageJsonPath)) {
  fail(`package.json not found in ${relativePackageDir}`);
}

console.log(`› npm version ${options.bump} --no-git-tag-version`);
run('npm', ['version', options.bump, '--no-git-tag-version'], options.packageDir);

const packageJson = readPackageJson(options.packageDir);
const releaseTag = getFrameworkReleaseTag(frameworkPackage, packageJson.version);

for (const scriptName of ['clean', 'build', 'test', 'smoke']) {
  if (!hasScript(packageJson, scriptName)) {
    continue;
  }

  console.log(`› bun run ${scriptName}`);
  run('bun', ['run', scriptName], options.packageDir);
}

const filesToStage = [path.posix.join(relativePackageDir, 'package.json')];

console.log(`› git add ${filesToStage.join(' ')}`);
run('git', ['add', ...filesToStage], repoRoot);

console.log(`› git commit -m ${packageJson.name}@${packageJson.version}`);
run('git', ['commit', '-m', `${packageJson.name}@${packageJson.version}`], repoRoot);

console.log(`› git tag ${releaseTag}`);
run('git', ['tag', releaseTag], repoRoot);

if (options.noPush) {
  console.log('› Skipping git push (no-push).');
  console.log(`  To publish upstream later, run: git push && git push origin ${releaseTag}`);
  process.exit(0);
}

console.log('› git push');
run('git', ['push'], repoRoot);
console.log(`› git push origin ${releaseTag}`);
run('git', ['push', 'origin', releaseTag], repoRoot);
console.log(`› Release workflow will publish ${packageJson.name}@${packageJson.version} from tag ${releaseTag}.`);
