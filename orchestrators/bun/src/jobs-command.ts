import type { JobDefinition, JobRecord } from '@webstir-io/webstir-backend/jobs';

import { buildBackendForCommand } from './backend-command.ts';

export interface JobsResult {
  readonly workspaceRoot: string;
  readonly ran?: string;
  readonly jobs?: readonly JobDefinition[];
  readonly queue?: readonly JobRecord[];
}

/** Lists the app's jobs and its queue, or runs one job now with `webstir jobs run <name>`. */
export async function runJobsCommand(options: {
  readonly workspaceRoot: string;
  readonly args: readonly string[];
  readonly payload?: string;
}): Promise<JobsResult> {
  const [action, name] = options.args;
  if (action !== undefined && action !== 'run') {
    throw new Error(
      `Unknown jobs action "${action}". Usage: webstir jobs [run <name> [--payload <json>]].`,
    );
  }
  if (action === 'run' && !name) {
    throw new Error('Usage: webstir jobs run <name> [--payload <json>] --workspace <path>.');
  }
  await buildBackendForCommand(options.workspaceRoot, 'jobs');
  const { jobs, listQueuedJobs, readJobs } = await import('@webstir-io/webstir-backend/jobs');
  if (action === 'run' && name) {
    let payload: unknown;
    try {
      payload = options.payload === undefined ? undefined : JSON.parse(options.payload);
    } catch {
      throw new Error(`--payload is not JSON: ${options.payload}`);
    }
    await jobs.run(name, payload);
    return { workspaceRoot: options.workspaceRoot, ran: name };
  }
  const { appDatabaseExists } = await import('@webstir-io/webstir-backend/db');
  return {
    workspaceRoot: options.workspaceRoot,
    jobs: readJobs(options.workspaceRoot),
    queue: appDatabaseExists() ? await listQueuedJobs() : [],
  };
}

export function formatJobsResult(result: JobsResult): string {
  if (result.ran) return `[webstir] ran job ${result.ran}`;
  const lines = ['[webstir] jobs'];
  const jobs = result.jobs ?? [];
  if (jobs.length === 0) lines.push('  none (src/backend/jobs/<name>/index.ts)');
  for (const job of jobs) lines.push(`  ${job.name}${job.schedule ? `  ${job.schedule}` : ''}`);
  const queue = result.queue ?? [];
  const counts = new Map<string, number>();
  for (const record of queue) counts.set(record.status, (counts.get(record.status) ?? 0) + 1);
  lines.push(
    `queue: ${['queued', 'running', 'done', 'failed'].map((status) => `${counts.get(status) ?? 0} ${status}`).join(', ')}`,
  );
  for (const failed of queue.filter((record) => record.status === 'failed')) {
    lines.push(
      `  failed ${failed.name} (${failed.id}) after ${failed.attempts} tries: ${failed.lastError?.split('\n')[0] ?? ''}`,
    );
  }
  return lines.join('\n');
}
