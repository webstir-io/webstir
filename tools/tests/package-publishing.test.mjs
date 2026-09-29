import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

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

// Never a blocking spawn: in a bun test worker one has waited forever for a child that had exited.
async function run(command, args, cwd) {
  const child = Bun.spawn({ cmd: [command, ...args], cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { status, stdout, stderr };
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

// A published package names a sibling npm can resolve, never a workspace range: within its release
// group, exactly the version it ships with; from another group, a range the current version meets
// (a release of one group leaves the other's ranges alone).
test('published packages depend on their siblings at versions that exist', () => {
  const groupOf = new Map(
    readJson('.changeset/config.json').fixed.flatMap((group, index) =>
      group.map((name) => [name, index]),
    ),
  );
  for (const { dir, manifest } of published) {
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
      if (!versionOf.has(name)) continue;
      if (groupOf.get(name) === groupOf.get(manifest.name)) {
        assert.equal(range, `^${versionOf.get(name)}`, `${dir}: ${name}`);
      } else {
        assert.match(range, /^\^\d+\.\d+\.\d+$/, `${dir}: ${name}`);
        assert.ok(Bun.semver.satisfies(versionOf.get(name), range), `${dir}: ${name} ${range}`);
      }
    }
  }
});

test('packed packages carry no workspace ranges', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'webstir-package-publishing-'));
  try {
    for (const { dir } of published.filter(({ dir }) => dir.startsWith('packages/'))) {
      const copy = path.join(tempRoot, dir);
      cpSync(path.join(repoRoot, dir), copy, { recursive: true });

      const pack = await run('bun', ['pm', 'pack', '--ignore-scripts', '--quiet'], copy);
      assert.equal(pack.status, 0, pack.stderr);
      const tarball = path.join(copy, pack.stdout.trim());

      const manifest = await run('tar', ['-xOf', tarball, 'package/package.json'], copy);
      assert.equal(manifest.status, 0, manifest.stderr);
      assert.doesNotMatch(manifest.stdout, /"workspace:/, dir);

      const listing = await run('tar', ['-tf', tarball], copy);
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

// Every change with a changeset ships: the version job sets the release pull request it just
// opened or updated to squash auto-merge, using that pull request's number and the release token.
test('the release workflow auto-merges the Version packages pull request', () => {
  const workflow = Bun.YAML.parse(
    readFileSync(path.join(repoRoot, '.github/workflows/release-package.yml'), 'utf8'),
  );
  const steps = workflow.jobs.version.steps;
  const version = steps.find((step) => step.uses?.startsWith('changesets/action/version@'));
  assert.ok(version, 'the version job runs changesets/action/version');
  assert.equal(version.id, 'version');
  assert.equal(version.with['github-token'], '${{ secrets.RELEASE_PR_TOKEN }}');

  const merge = steps[steps.indexOf(version) + 1];
  assert.ok(merge, 'a step follows the version step');
  assert.equal(merge.if, "steps.version.outputs.pr-number != ''");
  assert.equal(merge.env.PR_NUMBER, '${{ steps.version.outputs.pr-number }}');
  assert.equal(merge.env.GH_TOKEN, '${{ secrets.RELEASE_PR_TOKEN }}');
  assert.match(merge.run, /^gh pr merge "\$PR_NUMBER" .*--auto/);
  assert.match(merge.run, /--squash/);
});
