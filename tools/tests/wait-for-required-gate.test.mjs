import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = path.join(repoRoot, 'scripts', 'wait-for-required-gate.sh');

// A stand-in for `gh api` that answers from the environment: each commit's tree, parent and
// Required Gate result, the merged pull request heads, and whether the head contains the parent.
const STUB = `#!/usr/bin/env bash
key() { echo "$1" | tr -c 'a-zA-Z0-9\\n' '_'; }
case "$2" in
  */git/commits/*)
    sha="\${2##*/}"
    if [ "$4" = '.parents[0].sha // ""' ]; then echo parent; exit; fi
    v="TREE_$(key "$sha")"; echo "\${!v}" ;;
  */compare/*) echo "\${COMPARE:-ahead}" ;;
  */pulls) [ "$HEADS" = error ] && { echo '{"message":"Resource not accessible"}'; exit 1; }
    echo "$HEADS" | tr ' ' '\\n' | sed '/^$/d' ;;
  */check-runs*) sha="\${2#*/commits/}"; sha="\${sha%%/*}"; v="GATE_$(key "$sha")"; echo "\${!v:-pending}" ;;
esac
`;

// Never a blocking spawn: in a bun test worker one has waited forever for a child that had exited.
async function run({ heads, trees, gates, compare }) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'webstir-gate-'));
  try {
    writeFileSync(path.join(dir, 'gh'), STUB);
    chmodSync(path.join(dir, 'gh'), 0o755);
    const env = {
      ...process.env,
      PATH: `${dir}${path.delimiter}${process.env.PATH}`,
      HEADS: heads,
      COMPARE: compare ?? 'ahead',
    };
    for (const [sha, tree] of Object.entries(trees)) env[`TREE_${sha}`] = tree;
    for (const [sha, gate] of Object.entries(gates)) env[`GATE_${sha}`] = gate;
    const child = Bun.spawn({
      cmd: ['bash', script, 'owner/repo', 'merge'],
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { status, stdout, stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const { name, heads, trees, gates, compare, passes, via } of [
  {
    name: 'a merged head with the same content that passed counts for the merge',
    heads: 'head',
    trees: { merge: 't1', head: 't1' },
    gates: {},
    passes: true,
    via: /merged pull request's head/,
  },
  {
    name: 'a head with different content does not count; the merge commit own gate does',
    heads: 'head',
    trees: { merge: 't1', head: 't2' },
    gates: { head: 'success', merge: 'success' },
    passes: true,
    via: /Required Gate passed on merge$/m,
  },
  {
    name: 'a head missing some of main at merge time does not count, whatever its tree',
    heads: 'head',
    trees: { merge: 't1', head: 't1' },
    gates: { merge: 'failure' },
    compare: 'diverged',
    passes: false,
    via: /concluded failure on merge/,
  },
  {
    name: 'a failed pull request lookup warns and waits for the merge commit own gate',
    heads: 'error',
    trees: { merge: 't1' },
    gates: { merge: 'success' },
    passes: true,
    via: /::warning::Could not list the pull request[\s\S]*Required Gate passed on merge$/m,
  },
  {
    name: 'a head that failed does not count',
    heads: 'head',
    trees: { merge: 't1', head: 't1' },
    gates: { head: 'failure', merge: 'failure' },
    passes: false,
    via: /concluded failure on merge/,
  },
  {
    name: 'a commit no pull request merged waits for its own gate',
    heads: '',
    trees: { merge: 't1' },
    gates: { merge: 'success' },
    passes: true,
    via: /Required Gate passed on merge$/m,
  },
]) {
  test(`wait-for-required-gate: ${name}`, async () => {
    // The head's own gate result defaults to success unless the case says otherwise.
    const result = await run({ heads, trees, compare, gates: { head: 'success', ...gates } });
    assert.equal(result.status === 0, passes, result.stderr);
    assert.match(`${result.stdout}${result.stderr}`, via);
  });
}
