#!/usr/bin/env bun
import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { execute, score, summarize } from './process.mjs';
import { grade } from './grade.mjs';
import { assertFreshRuns, fingerprint, install, outsideRepository, prepare } from './setup.mjs';
import { ACCEPTANCE, PROTOCOL_VERSION, TASKS, taskPrompt } from './tasks.mjs';

const { values } = parseArgs({
  options: {
    codex: { type: 'string', default: 'codex' },
    package: { type: 'string' },
    output: { type: 'string' },
    label: { type: 'string' },
    model: { type: 'string', default: 'gpt-6-astra' },
    task: { type: 'string', default: 'all' },
    repeats: { type: 'string', default: '3' },
    'budget-seconds': { type: 'string', default: '480' },
    effort: { type: 'string', default: 'high' },
    dependencies: { type: 'string' },
    mode: { type: 'string', default: 'run' },
    'run-dir': { type: 'string' },
    'agent-result': { type: 'string' },
  },
});
if (!values.package || !values.output || !values.label)
  throw new Error(
    'Required: --package <version|tarball> --output <external-directory> --label <baseline|candidate>. Modes: run, prepare, grade, self-check.',
  );
if (!/^[a-z0-9-]+$/i.test(values.label))
  throw new Error('Label must contain letters, digits, or hyphens.');
if (!['run', 'prepare', 'grade', 'self-check'].includes(values.mode))
  throw new Error('Unknown mode.');
const repeats = Number(values.repeats);
const budgetMs = Number(values['budget-seconds']) * 1000;
if (!Number.isInteger(repeats) || repeats < 1 || !Number.isFinite(budgetMs) || budgetMs < 1000)
  throw new Error('Repeats and time budget must be positive.');
const tasks = values.task === 'all' ? ['build', 'extend', 'repair'] : [values.task];
if (tasks.some((task) => !TASKS.includes(task))) throw new Error('Unknown task.');
const output = await outsideRepository(path.resolve(values.output));
const campaign = path.join(output, values.label);
{
  const targetDirectories = tasks.flatMap((task) =>
    Array.from({ length: values.mode === 'self-check' ? 1 : repeats }, (_, index) =>
      values['run-dir']
        ? path.resolve(values['run-dir'])
        : path.join(campaign, `${task}-${index + 1}`),
    ),
  );
  await assertFreshRuns(targetDirectories, { grading: values.mode === 'grade' });
}
await mkdir(campaign, { recursive: true });
const dependencies = values.dependencies
  ? JSON.parse(await readFile(values.dependencies, 'utf8'))
  : {};
const settings = {
  protocol: PROTOCOL_VERSION,
  fingerprint: await fingerprint(),
  package: values.package,
  model: values.model,
  reasoningEffort: values.effort,
  budgetMs,
  sandbox: 'workspace-write',
  networkAccess: true,
  codex: values.codex,
  tools: 'Codex CLI built-in tools; consumer packages; shell; no configured MCP servers',
  dependencies,
};
const settingsPath = path.join(campaign, 'settings.json');
try {
  const frozen = JSON.parse(await readFile(settingsPath, 'utf8'));
  if (JSON.stringify(frozen) !== JSON.stringify(settings))
    throw new Error(
      'Campaign settings or evaluator changed. Use a new label; do not mix protocols.',
    );
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}
const codex = await execute(values.codex, ['--version'], { timeoutMs: 10000 });
const bun = await execute('bun', ['--version'], { timeoutMs: 10000 });
let installation;
let installationError;
try {
  installation = await install(path.join(campaign, 'installed'), values.package, dependencies);
} catch (error) {
  installationError = error.message;
}
const records = [];
for (const task of tasks) {
  for (let repeat = 1; repeat <= (values.mode === 'self-check' ? 1 : repeats); repeat++) {
    const directory = values['run-dir']
      ? path.resolve(values['run-dir'])
      : path.join(campaign, `${task}-${repeat}`);
    await outsideRepository(directory);
    const evidence = path.join(directory, 'evidence');
    const workspace = path.join(directory, 'app');
    const resultPath = path.join(evidence, 'result.json');
    const record = {
      task,
      repeat,
      ...settings,
      startedAt: new Date().toISOString(),
      versions: installation?.versions ?? {},
      runtime: { codex: codex.tail.trim(), bun: bun.tail.trim() },
      humanInterventions: 0,
      retries: 0,
    };
    try {
      if (installationError) throw new Error(installationError);
      if (values.mode !== 'grade') {
        try {
          await access(workspace);
          throw new Error(`Run workspace already exists: ${workspace}`);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        await prepare({
          task,
          workspace,
          cli: installation.cli,
          evidence,
          dependencies,
          pristine: values.mode === 'self-check',
        });
        const prompt = taskPrompt(task, installation.cli);
        await writeFile(path.join(evidence, 'prompt.txt'), prompt);
        if (values.mode === 'prepare') {
          await writeFile(
            path.join(evidence, 'prepared.json'),
            `${JSON.stringify(record, null, 2)}\n`,
          );
          console.log(
            JSON.stringify({
              prepared: directory,
              workspace,
              prompt: path.join(evidence, 'prompt.txt'),
              cli: installation.cli,
            }),
          );
          continue;
        }
        if (values.mode === 'self-check') record.agent = { code: 0, elapsedMs: 0, timedOut: false };
        else
          record.agent = await execute(
            values.codex,
            [
              'exec',
              '--ignore-user-config',
              '--ephemeral',
              '--json',
              '-m',
              values.model,
              '-c',
              `model_reasoning_effort="${values.effort}"`,
              '-s',
              'workspace-write',
              '-c',
              'sandbox_workspace_write.network_access=true',
              '--skip-git-repo-check',
              '-C',
              workspace,
              '-',
            ],
            {
              cwd: workspace,
              timeoutMs: budgetMs,
              log: path.join(evidence, 'agent.jsonl'),
              input: prompt,
              env: {
                ...process.env,
                PATH: `${path.dirname(installation.cli)}:${process.env.PATH}`,
              },
            },
          );
      } else {
        if (!values['agent-result'])
          throw new Error(
            'Grade mode requires --agent-result with {code,timedOut,elapsedMs}; agent completion cannot be inferred.',
          );
        Object.assign(
          record,
          JSON.parse(await readFile(path.join(evidence, 'prepared.json'), 'utf8')),
        );
        record.agent = JSON.parse(await readFile(values['agent-result'], 'utf8'));
      }
      if (record.agent.code === 0 && !record.agent.timedOut)
        Object.assign(record, await grade({ workspace, cli: installation.cli, task, evidence }));
    } catch (error) {
      if (!record.agent) record.setupError = error.message;
      else record.evaluatorError = error.message;
    }
    record.outcome = score({ ...record, expected: ACCEPTANCE[task] });
    record.finishedAt = new Date().toISOString();
    await mkdir(evidence, { recursive: true });
    await writeFile(resultPath, `${JSON.stringify(record, null, 2)}\n`);
    records.push(record);
    console.log(
      JSON.stringify({
        task,
        repeat,
        outcome: record.outcome,
        checks: record.checks,
        result: resultPath,
      }),
    );
  }
}
if (records.length) {
  const summary = summarize(records);
  await writeFile(
    path.join(campaign, `summary-${values.task}.json`),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  console.log(JSON.stringify(summary));
  if (summary.counts.passed !== summary.runs) process.exitCode = 1;
}
