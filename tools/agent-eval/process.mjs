import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';

// Separate process groups ensure the time limit also stops agent-spawned servers.
export function execute(command, args, { cwd, env = process.env, timeoutMs, log, input } = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    let timedOut = false;
    let tail = '';
    const output = log ? createWriteStream(log, { flags: 'a' }) : null;
    const child = spawn(command, args, {
      cwd,
      env,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const capture = (data) => {
      tail = (tail + data.toString()).slice(-16000);
      output?.write(data);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    let timer;
    let killTimer;
    if (timeoutMs)
      timer = setTimeout(() => {
        timedOut = true;
        killGroup(child.pid, 'SIGTERM');
        killTimer = setTimeout(() => killGroup(child.pid, 'SIGKILL'), 2000);
      }, timeoutMs);
    child.on('error', (error) => {
      tail += error.message;
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      killGroup(child.pid, 'SIGKILL');
      output?.end();
      resolve({ code, signal, timedOut, elapsedMs: Date.now() - start, tail });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
export function killGroup(pid, signal = 'SIGTERM') {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}
export function score({ setupError, agent, checks = [], expected = [], evaluatorError }) {
  if (setupError) return 'environment_error';
  if (agent?.timedOut) return 'timeout';
  if (agent?.code !== 0) return 'agent_error';
  if (evaluatorError) return 'environment_error';
  if (checks.some((check) => !check.passed)) return 'task_failure';
  if (
    !expected.length ||
    expected.some((name) => !checks.some((check) => check.name === name && check.passed))
  )
    return 'task_failure';
  return 'passed';
}
export function summarize(records) {
  const counts = { passed: 0, task_failure: 0, timeout: 0, environment_error: 0, agent_error: 0 };
  for (const record of records) counts[record.outcome]++;
  const correct = records
    .filter((record) => record.outcome === 'passed')
    .map((record) => record.agent.elapsedMs)
    .sort((a, b) => a - b);
  return {
    runs: records.length,
    counts,
    completionRate: records.length ? counts.passed / records.length : 0,
    correctElapsedMs: correct,
    humanInterventions: records.reduce((sum, record) => sum + (record.humanInterventions ?? 0), 0),
  };
}
