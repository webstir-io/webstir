import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** What a job receives besides its payload. */
export interface JobContext {
  readonly name: string;
  /** 1 for the first try, counting up with each retry of a queued job. */
  readonly attempt: number;
}

export type JobRunner = (payload: unknown, context: JobContext) => unknown;

export interface JobDefinition {
  readonly name: string;
  readonly schedule?: string;
  readonly description?: string;
}

/** The app's jobs: each built `jobs/<name>/index.js`, with its schedule from package.json. */
export function readJobs(workspaceRoot: string): JobDefinition[] {
  const root = path.join(workspaceRoot, 'build', 'backend', 'jobs');
  if (!existsSync(root)) return [];
  const manifest = readManifestJobs(workspaceRoot);
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(jobModulePath(workspaceRoot, entry.name)))
    .map((entry) => ({ name: entry.name, ...manifest.get(entry.name) }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function jobModulePath(workspaceRoot: string, name: string): string {
  return path.join(workspaceRoot, 'build', 'backend', 'jobs', name, 'index.js');
}

export function hasJob(workspaceRoot: string, name: string): boolean {
  return /^[A-Za-z0-9][\w-]*$/.test(name) && existsSync(jobModulePath(workspaceRoot, name));
}

export async function loadJobRunner(workspaceRoot: string, name: string): Promise<JobRunner> {
  if (!hasJob(workspaceRoot, name)) {
    throw new Error(`there is no job "${name}"; add src/backend/jobs/${name}/index.ts`);
  }
  const module = (await import(pathToFileURL(jobModulePath(workspaceRoot, name)).href)) as {
    run?: JobRunner;
    default?: JobRunner;
  };
  const run = module.run ?? module.default;
  if (typeof run !== 'function') {
    throw new Error(`job "${name}" exports no run() function (src/backend/jobs/${name}/index.ts)`);
  }
  return run;
}

function readManifestJobs(workspaceRoot: string): Map<string, Omit<JobDefinition, 'name'>> {
  const jobs = new Map<string, Omit<JobDefinition, 'name'>>();
  try {
    const pkg = JSON.parse(readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8')) as {
      webstir?: { moduleManifest?: { jobs?: unknown } };
    };
    const declared = pkg.webstir?.moduleManifest?.jobs;
    for (const job of Array.isArray(declared) ? declared : []) {
      const record = job as Record<string, unknown>;
      if (typeof record?.name !== 'string') continue;
      jobs.set(record.name, {
        ...(typeof record.schedule === 'string' && record.schedule.trim()
          ? { schedule: record.schedule.trim() }
          : {}),
        ...(typeof record.description === 'string' ? { description: record.description } : {}),
      });
    }
  } catch {
    // A missing or unreadable package.json declares no schedules.
  }
  return jobs;
}
