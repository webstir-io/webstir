import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function demoRoot(name) {
  return path.join(repoRoot, 'examples', 'demos', name);
}

function webstirCommand(...args) {
  return ['bun', 'run', 'webstir', '--', ...args];
}

export function buildAgentTaskBenchmarkPlan() {
  return [
    {
      label: 'full recipe: doctor',
      command: webstirCommand('doctor', '--json', '--workspace', demoRoot('full')),
    },
    {
      label: 'full recipe: backend-inspect',
      command: webstirCommand('backend-inspect', '--json', '--workspace', demoRoot('full')),
    },
    {
      label: 'full recipe: test',
      command: webstirCommand('test', '--workspace', demoRoot('full')),
    },
    {
      label: 'full recipe: publish',
      command: webstirCommand('publish', '--workspace', demoRoot('full')),
    },
    {
      label: 'auth-crud recipe: backend-inspect',
      command: webstirCommand('backend-inspect', '--json', '--workspace', demoRoot('auth-crud')),
    },
    {
      label: 'auth-crud recipe: test',
      command: webstirCommand('test', '--workspace', demoRoot('auth-crud')),
    },
    {
      label: 'dashboard recipe: backend-inspect',
      command: webstirCommand('backend-inspect', '--json', '--workspace', demoRoot('dashboard')),
    },
    {
      label: 'dashboard recipe: test',
      command: webstirCommand('test', '--workspace', demoRoot('dashboard')),
    },
  ];
}

function runStep(step) {
  const result = Bun.spawnSync({
    cmd: step.command,
    cwd: repoRoot,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: process.env,
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
  for (const step of buildAgentTaskBenchmarkPlan()) {
    console.log(`[webstir][bench] ${step.label}`);
    runStep(step);
  }
}
