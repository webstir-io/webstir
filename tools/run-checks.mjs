import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

export function buildCheckPlan(mode) {
  const requiredSteps = [
    {
      label: 'repo tool contracts',
      command: ['bun', 'run', 'test:tools'],
    },
    {
      label: 'module contract',
      command: ['bun', 'run', '--filter', '@webstir-io/module-contract', 'test'],
    },
    {
      label: 'testing contract',
      command: ['bun', 'run', '--filter', '@webstir-io/testing-contract', 'test'],
    },
    {
      label: 'backend tooling tests',
      command: ['bun', 'run', '--filter', '@webstir-io/webstir-backend', 'test'],
    },
    {
      label: 'backend tooling smoke',
      command: ['bun', 'run', '--filter', '@webstir-io/webstir-backend', 'smoke'],
      env: {
        WEBSTIR_BACKEND_SMOKE_FASTIFY_RUN: 'skip',
      },
    },
    {
      label: 'frontend tooling tests',
      command: ['bun', 'run', '--filter', '@webstir-io/webstir-frontend', 'test'],
    },
    {
      label: 'testing tooling',
      command: ['bun', 'run', '--filter', '@webstir-io/webstir-testing', 'test'],
    },
    {
      label: 'bun asset sources',
      command: ['bun', 'run', '--filter', '@webstir-io/webstir', 'check:assets'],
    },
    {
      label: 'bun orchestrator required suite',
      command: ['bun', 'run', '--filter', '@webstir-io/webstir', 'test'],
    },
  ];

  switch (mode) {
    case 'required':
      return requiredSteps;
    case 'all':
    case 'with-watch-browser':
      return [
        ...requiredSteps,
        {
          label: 'bun orchestrator watch browser tests',
          command: ['bun', 'run', 'test:watch-browser'],
        },
      ];
    default:
      throw new Error(`Unknown check mode "${mode}". Expected one of: required, with-watch-browser.`);
  }
}

function runStep(step) {
  const result = Bun.spawnSync({
    cmd: step.command,
    cwd: repoRoot,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      ...(step.env ?? {}),
    },
  });

  if (result.exitCode !== 0) {
    process.exit(result.exitCode ?? 1);
  }
}

function isCliInvocation() {
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    return false;
  }

  return path.resolve(entrypoint) === fileURLToPath(import.meta.url);
}

if (isCliInvocation()) {
  const mode = process.argv[2] ?? 'required';
  const plan = buildCheckPlan(mode);

  for (const step of plan) {
    console.log(`[webstir][checks] ${step.label}`);
    runStep(step);
  }
}
