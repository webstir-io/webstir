import { spawnSync } from 'node:child_process';
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
      label: 'frontend tooling smoke',
      command: ['bun', 'run', '--filter', '@webstir-io/webstir-frontend', 'smoke'],
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
      return [
        ...requiredSteps,
        {
          label: 'bun orchestrator watch browser suite',
          command: ['bun', 'run', 'test:watch-browser'],
        },
      ];
    default:
      throw new Error(`Unknown check mode "${mode}". Expected one of: required, all.`);
  }
}

function runStep(step) {
  const result = spawnSync(step.command[0], step.command.slice(1), {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...(step.env ?? {}),
    },
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
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
