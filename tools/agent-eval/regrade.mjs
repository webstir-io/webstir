#!/usr/bin/env bun
import { createHash } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { grade } from './grade.mjs';
import { score, summarize } from './process.mjs';
import { fingerprint, repository } from './setup.mjs';
import { ACCEPTANCE, PROTOCOL_VERSION } from './tasks.mjs';

const EXCLUDED = new Set([
  'node_modules',
  'build',
  'dist',
  '.webstir',
  '.git',
  'data',
  '.tmp',
  '.cache',
]);
const SOURCE_FINGERPRINT = '517060c1d57c919f96ddbe8e5fc1c326d268658256df85fa8f3b9af47d95c58e';
const REASON =
  'Use the Filter combobox accessible role/name instead of exact label text, which incorrectly included implicit-label select options.';
const { values } = parseArgs({
  options: {
    input: { type: 'string' },
    output: { type: 'string' },
    prefix: { type: 'string', default: 'baseline-' },
    'expected-runs': { type: 'string' },
    run: { type: 'string' },
  },
});
if (!values.input || !values.output || !values['expected-runs'])
  throw new Error(
    'Required: --input <original-campaign-parent> --output <new-external-directory> --expected-runs <count>. Optional --prefix baseline- or --run campaign/run.',
  );
const expectedRuns = Number(values['expected-runs']);
if (!Number.isInteger(expectedRuns) || expectedRuns < 1)
  throw new Error('Expected run count must be positive.');
const input = await realpath(path.resolve(values.input));
const output = await canonicalDestination(values.output);
const repositoryRoot = await realpath(repository);
if (output === repositoryRoot || output.startsWith(`${repositoryRoot}${path.sep}`))
  throw new Error('Regrade output must be outside the monorepo.');
if (output === input || output.startsWith(`${input}${path.sep}`))
  throw new Error('Regrade output must be outside the original campaign directory tree.');
try {
  await lstat(output);
  throw new Error(`Refusing to reuse regrade output: ${output}`);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const selections = [];
for (const campaign of (await readdir(input)).sort()) {
  if (!campaign.startsWith(values.prefix)) continue;
  const campaignPath = path.join(input, campaign);
  if (!(await lstat(campaignPath)).isDirectory()) continue;
  for (const run of (await readdir(campaignPath)).sort()) {
    if (values.run && `${campaign}/${run}` !== values.run) continue;
    const directory = path.join(campaignPath, run);
    const resultPath = path.join(directory, 'evidence/result.json');
    try {
      const original = JSON.parse(await readFile(resultPath, 'utf8'));
      if (original.fingerprint !== SOURCE_FINGERPRINT)
        throw new Error(`Unexpected original protocol: ${resultPath}`);
      if (!ACCEPTANCE[original.task]) throw new Error(`Unknown recorded task: ${resultPath}`);
      selections.push({ campaign, run, directory, resultPath, original });
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
  }
}
if (selections.length !== expectedRuns)
  throw new Error(
    `Expected ${expectedRuns} completed records, found ${selections.length}. Wait for all selected runs before regrading.`,
  );
await mkdir(output, { recursive: true });
const correctedFingerprint = await fingerprint();
const results = [];
for (const selection of selections) {
  const { campaign, run, directory, resultPath, original } = selection;
  const destination = path.join(output, campaign, run);
  const workspace = path.join(destination, 'app');
  const evidence = path.join(destination, 'evidence');
  await mkdir(evidence, { recursive: true });
  const record = {
    protocol: PROTOCOL_VERSION,
    fingerprint: correctedFingerprint,
    task: original.task,
    repeat: original.repeat,
    package: original.package,
    versions: original.versions,
    runtime: original.runtime,
    agent: original.agent,
    humanInterventions: original.humanInterventions,
    retries: original.retries,
    setupError: original.setupError,
    evaluatorError: original.evaluatorError,
    original: { resultPath, fingerprint: original.fingerprint, result: original },
    correction: { reason: REASON, sourceFingerprint: original.fingerprint, correctedFingerprint },
    gradingStartedAt: new Date().toISOString(),
  };
  try {
    record.artifact = {
      algorithm: 'sha256',
      scope:
        'All app files except root runtime/build/cache directories and node_modules; symlinks hash their target text.',
      excludedRootDirectories: [...EXCLUDED],
      originalBefore: await sourceHash(path.join(directory, 'app')),
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    record.artifact = { unavailable: 'Original setup did not create an app artifact.' };
  }
  if (original.agent?.code === 0 && !original.agent?.timedOut && !original.setupError) {
    const source = path.join(directory, 'app');
    try {
      const before = await sourceHash(source);
      await cp(source, workspace, {
        recursive: true,
        filter: (file) => !EXCLUDED.has(path.relative(source, file).split(path.sep)[0]),
      });
      await symlink(
        await realpath(path.join(source, 'node_modules')),
        path.join(workspace, 'node_modules'),
        'dir',
      );
      try {
        await cp(
          path.join(directory, 'evidence/fixture.json'),
          path.join(evidence, 'fixture.json'),
        );
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const cloned = await sourceHash(workspace);
      if (cloned !== before)
        throw new Error('Cloned source/config differs from the original immutable artifact.');
      const cli = path.join(input, campaign, 'installed/node_modules/.bin/webstir');
      const graded = await grade({ task: original.task, workspace, evidence, cli });
      record.checks = graded.checks;
      record.evaluatorError = graded.evaluatorError;
      const originalAfter = await sourceHash(source);
      const clonedAfter = await sourceHash(workspace);
      record.artifact = {
        algorithm: 'sha256',
        scope:
          'All app files except root runtime/build/cache directories and node_modules; symlinks hash their target text.',
        excludedRootDirectories: [...EXCLUDED],
        originalBefore: before,
        cloneBefore: cloned,
        originalAfter,
        cloneAfter: clonedAfter,
      };
      if (originalAfter !== before || clonedAfter !== before)
        throw new Error(
          'App source/config changed during regrading; this result cannot establish completion.',
        );
    } catch (error) {
      record.evaluatorError = error.message;
    }
  }
  record.outcome = score({ ...record, expected: ACCEPTANCE[record.task] });
  record.gradingFinishedAt = new Date().toISOString();
  await writeFile(path.join(evidence, 'result.json'), `${JSON.stringify(record, null, 2)}\n`);
  results.push(record);
  console.log(
    JSON.stringify({
      run: `${campaign}/${run}`,
      outcome: record.outcome,
      originalOutcome: original.outcome,
      artifact: record.artifact,
      checks: record.checks,
    }),
  );
}
const summary = {
  protocol: PROTOCOL_VERSION,
  fingerprint: correctedFingerprint,
  correction: REASON,
  ...summarize(results),
};
await writeFile(path.join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary));
if (summary.counts.passed !== summary.runs) process.exitCode = 1;

async function sourceHash(directory) {
  const hash = createHash('sha256');
  async function visit(relative = '') {
    for (const entry of (
      await readdir(path.join(directory, relative), { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!relative && EXCLUDED.has(entry.name)) continue;
      const name = path.join(relative, entry.name);
      const full = path.join(directory, name);
      if (entry.isDirectory()) {
        hash.update(`directory\0${name}\0`);
        await visit(name);
      } else if (entry.isSymbolicLink()) hash.update(`link\0${name}\0${await readlink(full)}\0`);
      else if (entry.isFile()) {
        hash.update(`file\0${name}\0`);
        hash.update(await readFile(full));
        hash.update('\0');
      } else throw new Error(`Unsupported source artifact: ${name}`);
    }
  }
  await visit();
  return hash.digest('hex');
}

async function canonicalDestination(requested) {
  let ancestor = path.resolve(requested);
  const suffix = [];
  for (;;) {
    try {
      return path.join(await realpath(ancestor), ...suffix.reverse());
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    suffix.push(path.basename(ancestor));
    ancestor = path.dirname(ancestor);
  }
}
