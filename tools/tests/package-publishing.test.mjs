import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const textDecoder = new TextDecoder();

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

/** Every workspace package, with its directory relative to the repo root. */
function workspacePackages() {
  const packages = [];
  for (const pattern of readJson('package.json').workspaces) {
    for (const dir of new Bun.Glob(pattern).scanSync({ cwd: repoRoot, onlyFiles: false })) {
      try {
        packages.push({ dir, manifest: readJson(path.join(dir, 'package.json')) });
      } catch {
        // A matched folder without a package.json is not a package.
      }
    }
  }
  return packages;
}

const published = workspacePackages().filter(({ manifest }) => manifest.private !== true);
const versionOf = new Map(published.map(({ manifest }) => [manifest.name, manifest.version]));

function run(command, args, cwd) {
  const result = Bun.spawnSync({ cmd: [command, ...args], cwd, stdout: 'pipe', stderr: 'pipe' });
  return {
    status: result.exitCode,
    stdout: textDecoder.decode(result.stdout),
    stderr: textDecoder.decode(result.stderr),
  };
}

// Changesets versions each release group together; every published package belongs to exactly one
// group, and nothing private is in one.
test('changeset groups cover exactly the published packages', () => {
  const config = readJson('.changeset/config.json');
  const grouped = config.fixed.flat();

  assert.equal(config.access, 'public');
  assert.deepEqual([...grouped].sort(), [...versionOf.keys()].sort());
  assert.equal(new Set(grouped).size, grouped.length);
  for (const group of config.fixed) {
    const versions = new Set(group.map((name) => versionOf.get(name)));
    assert.equal(versions.size, 1, `${group.join(', ')} are not on one version`);
  }
});

// A published package names the version of its sibling it was built against, never a workspace
// range npm cannot resolve.
test('published packages depend on their siblings at the current version', () => {
  for (const { dir, manifest } of published) {
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
      if (!versionOf.has(name)) continue;
      assert.equal(range, `^${versionOf.get(name)}`, `${dir}: ${name}`);
    }
  }
});

test('packed packages carry no workspace ranges', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'webstir-package-publishing-'));
  try {
    for (const { dir } of published.filter(({ dir }) => dir.startsWith('packages/'))) {
      const copy = path.join(tempRoot, dir);
      cpSync(path.join(repoRoot, dir), copy, { recursive: true });

      const pack = run('bun', ['pm', 'pack', '--ignore-scripts', '--quiet'], copy);
      assert.equal(pack.status, 0, pack.stderr);
      const tarball = path.join(copy, pack.stdout.trim());

      const manifest = run('tar', ['-xOf', tarball, 'package/package.json'], copy);
      assert.equal(manifest.status, 0, manifest.stderr);
      assert.doesNotMatch(manifest.stdout, /"workspace:/, dir);

      const listing = run('tar', ['-tf', tarball], copy);
      assert.equal(listing.status, 0, listing.stderr);
      assert.doesNotMatch(listing.stdout, /package\/package-lock\.json/, dir);
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

// Only the publish job can mint an npm token.
test('the release workflow grants id-token to the publish job alone', () => {
  const workflow = readFileSync(
    path.join(repoRoot, '.github/workflows/release-package.yml'),
    'utf8',
  );
  const jobs = workflow.split(/^ {2}(?=[a-z-]+:$)/m).slice(1);
  const withIdToken = jobs
    .filter((job) => /id-token:\s*write/.test(job))
    .map((job) => job.slice(0, job.indexOf(':')));
  assert.deepEqual(withIdToken, ['publish']);
  assert.match(workflow, /^permissions: \{\}$/m);
});
