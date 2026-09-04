#!/usr/bin/env bun

import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  frameworkPackages,
  getReleaseGroupByName,
  getRepoRoot,
  parseReleaseSetTag,
} from './framework-packages.mjs';

const defaultRepoRoot = getRepoRoot(import.meta.url);
const registryBaseUrl = 'https://registry.npmjs.org';
const dependencyFields = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

function fail(message) {
  throw new Error(message);
}

function usage() {
  console.error(`Usage:
  release-set.mjs --plan (--tag <release-set/group/vX.Y.Z> | --group <name> --version <X.Y.Z>)
  release-set.mjs --publish (--tag <release-set/group/vX.Y.Z> | --group <name> --version <X.Y.Z>) --commit <sha>

--plan validates and prints the release set without network or package publication.
--publish builds once, publishes in dependency order, and verifies registry and install state.`);
  process.exit(1);
}

function readManifest(repoRoot, frameworkPackage) {
  const manifestPath = path.join(repoRoot, frameworkPackage.canonicalDir, 'package.json');
  return {
    ...frameworkPackage,
    manifestPath,
    manifest: JSON.parse(readFileSync(manifestPath, 'utf8')),
  };
}

function internalDependencyNames(manifest, knownPackageNames) {
  const dependencies = [];
  for (const field of dependencyFields) {
    for (const dependencyName of Object.keys(manifest[field] ?? {})) {
      if (knownPackageNames.has(dependencyName)) {
        dependencies.push(dependencyName);
      }
    }
  }
  return [...new Set(dependencies)];
}

export function createReleasePlan({ repoRoot = defaultRepoRoot, groupName, version }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    fail(`invalid release version "${version}"`);
  }

  const group = getReleaseGroupByName(groupName);
  if (!group) {
    fail(`unknown release group "${groupName}"`);
  }

  const packageByName = new Map(
    frameworkPackages.map((frameworkPackage) => [
      frameworkPackage.packageName,
      readManifest(repoRoot, frameworkPackage),
    ]),
  );
  const knownPackageNames = new Set(packageByName.keys());
  const groupPackageNames = new Set(group.packageNames);

  for (const packageName of group.packageNames) {
    const entry = packageByName.get(packageName);
    if (!entry) {
      fail(`release group ${group.name} references unknown package ${packageName}`);
    }
    if (entry.manifest.version !== version) {
      fail(
        `${packageName} is ${entry.manifest.version}; run release:prepare so every ${group.name} package is ${version}`,
      );
    }

    for (const field of dependencyFields) {
      for (const [dependencyName, dependencyRange] of Object.entries(entry.manifest[field] ?? {})) {
        if (groupPackageNames.has(dependencyName) && dependencyRange !== `^${version}`) {
          fail(
            `${packageName} ${field}.${dependencyName} is ${dependencyRange}; expected ^${version}`,
          );
        }
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const buildPackages = [];

  function visit(packageName) {
    if (visited.has(packageName)) {
      return;
    }
    if (visiting.has(packageName)) {
      fail(`internal package dependency cycle includes ${packageName}`);
    }

    const entry = packageByName.get(packageName);
    if (!entry) {
      fail(`unknown internal package ${packageName}`);
    }

    visiting.add(packageName);
    for (const dependencyName of internalDependencyNames(entry.manifest, knownPackageNames)) {
      visit(dependencyName);
    }
    visiting.delete(packageName);
    visited.add(packageName);
    buildPackages.push(entry);
  }

  for (const packageName of group.packageNames) {
    visit(packageName);
  }

  const publishPackages = buildPackages.filter((entry) => groupPackageNames.has(entry.packageName));
  return { group, version, buildPackages, publishPackages };
}

export function classifyRegistryVersion({
  exactStatus,
  exactBody,
  packumentStatus,
  packumentBody,
  version,
}) {
  const exactPresent = exactStatus === 200;
  const packumentVersion = packumentStatus === 200 ? packumentBody?.versions?.[version] : undefined;
  const packumentPresent = Boolean(packumentVersion);

  if (!exactPresent && !packumentPresent) {
    return { kind: 'missing' };
  }
  if (!exactPresent || !packumentPresent) {
    return {
      kind: 'partial',
      metadata: packumentVersion ?? exactBody,
      detail: exactPresent
        ? 'exact-version metadata exists but the package index does not expose it'
        : 'the package index exposes the version but exact-version metadata is missing',
    };
  }
  return {
    kind: 'published',
    metadata: packumentVersion,
  };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function requestRegistryJson(url, label) {
  const delays = [0, 1_000, 3_000, 7_000];
  let lastError;

  for (const delay of delays) {
    if (delay > 0) {
      await sleep(delay);
    }
    let response;
    try {
      response = await fetch(url, {
        headers: {
          accept: 'application/json',
          'cache-control': 'no-cache',
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      lastError = error;
      continue;
    }

    if (response.status === 404) {
      return { status: 404, body: null };
    }
    if (response.status === 401 || response.status === 403) {
      fail(`${label} returned ${response.status}; authorization failed`);
    }
    if (response.status === 429 || response.status >= 500) {
      lastError = new Error(`${label} returned ${response.status}`);
      continue;
    }
    if (!response.ok) {
      fail(`${label} returned unexpected HTTP ${response.status}`);
    }

    try {
      return { status: response.status, body: await response.json() };
    } catch (error) {
      lastError = new Error(`${label} returned invalid JSON: ${error.message}`);
    }
  }

  fail(
    `${label} remained unavailable after ${delays.length} attempts: ${lastError?.message ?? lastError}`,
  );
}

async function readRegistryVersionState(packageName, version) {
  const encodedName = encodeURIComponent(packageName);
  const [exact, packument] = await Promise.all([
    requestRegistryJson(
      `${registryBaseUrl}/${encodedName}/${encodeURIComponent(version)}`,
      `${packageName}@${version} exact metadata`,
    ),
    requestRegistryJson(`${registryBaseUrl}/${encodedName}`, `${packageName} package index`),
  ]);

  return classifyRegistryVersion({
    exactStatus: exact.status,
    exactBody: exact.body,
    packumentStatus: packument.status,
    packumentBody: packument.body,
    version,
  });
}

function assertPublishedMetadata(packageName, version, commit, state) {
  if (state.kind === 'partial') {
    fail(
      `${packageName}@${version} remained partially visible: ${state.detail}; do not republish it, retry after the registry converges`,
    );
  }
  if (state.kind !== 'published') {
    fail(`${packageName}@${version} is not visible in the registry`);
  }
  if (state.metadata?.gitHead !== commit) {
    fail(
      `${packageName}@${version} belongs to gitHead ${state.metadata?.gitHead ?? 'unknown'}, not ${commit}`,
    );
  }
  if (!state.metadata?.dist?.attestations?.provenance) {
    fail(`${packageName}@${version} is missing npm provenance`);
  }
}

async function waitForPublishedPackage(packageName, version, commit) {
  let state;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    state = await readRegistryVersionState(packageName, version);
    if (state.kind === 'published') {
      assertPublishedMetadata(packageName, version, commit, state);
      return;
    }
    if (attempt < 12) {
      await sleep(Math.min(1_000 * attempt, 5_000));
    }
  }
  assertPublishedMetadata(packageName, version, commit, state);
}

async function waitForRegistryConvergence(packageName, version) {
  let state = await readRegistryVersionState(packageName, version);
  for (let attempt = 1; state.kind === 'partial' && attempt < 12; attempt += 1) {
    await sleep(Math.min(1_000 * attempt, 5_000));
    state = await readRegistryVersionState(packageName, version);
  }
  return state;
}

function run(command, args, cwd, { quiet = false } = {}) {
  const result = Bun.spawnSync({
    cmd: [command, ...args],
    cwd,
    stdin: 'inherit',
    stdout: quiet ? 'pipe' : 'inherit',
    stderr: quiet ? 'pipe' : 'inherit',
    env: process.env,
  });
  return result;
}

function runChecked(command, args, cwd, options) {
  const result = run(command, args, cwd, options);
  if (result.exitCode !== 0) {
    const stderr = result.stderr ? new TextDecoder().decode(result.stderr).trim() : '';
    fail(`${command} ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`);
  }
}

function assertReleaseCommit(repoRoot, commit) {
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    fail(`invalid release commit "${commit}"`);
  }
  const result = run('git', ['rev-parse', 'HEAD'], repoRoot, { quiet: true });
  const head = result.stdout ? new TextDecoder().decode(result.stdout).trim() : '';
  if (result.exitCode !== 0 || head !== commit) {
    fail(`release commit ${commit} does not match checked-out HEAD ${head || 'unknown'}`);
  }
}

function assertCleanReleaseCheckout(repoRoot) {
  const result = run('git', ['status', '--porcelain=v1', '--untracked-files=all'], repoRoot, {
    quiet: true,
  });
  const status = result.stdout ? new TextDecoder().decode(result.stdout).trim() : '';
  if (result.exitCode !== 0) {
    fail('could not verify that the release checkout is clean');
  }
  if (status) {
    fail(`release checkout changed outside commit:\n${status}`);
  }
}

function buildAndPackRelease(plan, repoRoot) {
  console.log('[webstir][release] building package graph once');
  for (const entry of plan.buildPackages) {
    const scriptName = entry.releaseBuildScript ?? 'build';
    console.log(`  build ${entry.packageName} (${scriptName})`);
    runChecked('bun', ['run', '--filter', entry.packageName, scriptName], repoRoot);
  }

  console.log('[webstir][release] validating publish tarballs');
  for (const entry of plan.publishPackages) {
    runChecked('npm', ['pack', '--dry-run', '--json'], path.join(repoRoot, entry.canonicalDir), {
      quiet: true,
    });
    console.log(`  packed ${entry.packageName}@${plan.version}`);
  }
}

async function verifyCleanInstall(plan) {
  const installRoot = mkdtempSync(path.join(os.tmpdir(), 'webstir-release-install-'));
  writeFileSync(
    path.join(installRoot, 'package.json'),
    `${JSON.stringify({ private: true }, null, 2)}\n`,
    'utf8',
  );

  try {
    let installed = false;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const result = run(
        'npm',
        [
          'install',
          '--ignore-scripts',
          '--package-lock=false',
          `${plan.group.installPackage}@${plan.version}`,
        ],
        installRoot,
      );
      if (result.exitCode === 0) {
        installed = true;
        break;
      }
      if (attempt < 4) {
        await sleep(2_000 * attempt);
      }
    }
    if (!installed) {
      fail(`fresh installation of ${plan.group.installPackage}@${plan.version} failed`);
    }

    for (const packageName of plan.group.packageNames) {
      const manifestPath = path.join(
        installRoot,
        'node_modules',
        ...packageName.split('/'),
        'package.json',
      );
      const installedManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (installedManifest.version !== plan.version) {
        fail(
          `fresh install resolved ${packageName}@${installedManifest.version}; expected ${plan.version}`,
        );
      }
    }
  } finally {
    rmSync(installRoot, { recursive: true, force: true });
  }
}

async function publishReleasePlan(plan, repoRoot, commit) {
  assertReleaseCommit(repoRoot, commit);
  assertCleanReleaseCheckout(repoRoot);
  const missingPackages = [];

  console.log('[webstir][release] checking immutable registry state');
  for (const entry of plan.publishPackages) {
    const state = await waitForRegistryConvergence(entry.packageName, plan.version);
    if (state.kind === 'missing') {
      missingPackages.push(entry);
      console.log(`  publish ${entry.packageName}@${plan.version}`);
      continue;
    }
    assertPublishedMetadata(entry.packageName, plan.version, commit, state);
    console.log(`  resume: ${entry.packageName}@${plan.version} already verified`);
  }

  buildAndPackRelease(plan, repoRoot);
  assertCleanReleaseCheckout(repoRoot);

  for (const entry of missingPackages) {
    console.log(`[webstir][release] publishing ${entry.packageName}@${plan.version}`);
    const result = run(
      'npm',
      ['publish', '--provenance', '--access', 'public'],
      path.join(repoRoot, entry.canonicalDir),
    );
    if (result.exitCode !== 0) {
      try {
        await waitForPublishedPackage(entry.packageName, plan.version, commit);
      } catch (error) {
        fail(
          `npm publish failed for ${entry.packageName}@${plan.version}, and registry verification did not confirm publication: ${error.message}`,
        );
      }
      continue;
    }
    await waitForPublishedPackage(entry.packageName, plan.version, commit);
  }

  for (const entry of plan.publishPackages) {
    await waitForPublishedPackage(entry.packageName, plan.version, commit);
  }
  await verifyCleanInstall(plan);
  console.log(
    `[webstir][release] verified ${plan.group.name}@${plan.version}: registry, provenance, gitHead, and fresh install`,
  );
}

function parseArgs(argv) {
  const options = {
    mode: '',
    groupName: '',
    version: '',
    tag: '',
    commit: '',
    githubOutput: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--plan' || arg === '--publish') {
      if (options.mode) {
        usage();
      }
      options.mode = arg.slice(2);
      continue;
    }
    const keyByArg = {
      '--group': 'groupName',
      '--version': 'version',
      '--tag': 'tag',
      '--commit': 'commit',
      '--github-output': 'githubOutput',
    };
    const key = keyByArg[arg];
    if (!key || !argv[index + 1]) {
      usage();
    }
    options[key] = argv[index + 1];
    index += 1;
  }

  if (options.tag) {
    if (options.groupName || options.version) {
      usage();
    }
    const parsed = parseReleaseSetTag(options.tag);
    if (!parsed) {
      fail(`unsupported release-set tag "${options.tag}"`);
    }
    options.groupName = parsed.group.name;
    options.version = parsed.version;
  }

  if (!options.mode || !options.groupName || !options.version) {
    usage();
  }
  if (options.mode === 'publish' && !options.commit) {
    usage();
  }
  return options;
}

function printablePlan(plan) {
  return {
    group: plan.group.name,
    version: plan.version,
    buildPackages: plan.buildPackages.map((entry) => entry.packageName),
    publishPackages: plan.publishPackages.map((entry) => entry.packageName),
    installPackage: plan.group.installPackage,
  };
}

function isCliInvocation() {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint && path.resolve(entrypoint) === fileURLToPath(import.meta.url));
}

if (isCliInvocation()) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const plan = createReleasePlan({
      groupName: options.groupName,
      version: options.version,
    });
    console.log(JSON.stringify(printablePlan(plan), null, 2));

    if (options.githubOutput) {
      appendFileSync(
        options.githubOutput,
        `release_group=${plan.group.name}\nrelease_version=${plan.version}\n`,
        'utf8',
      );
    }

    if (options.mode === 'publish') {
      await publishReleasePlan(plan, defaultRepoRoot, options.commit);
    }
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
