import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

import type { ModuleManifest } from '@webstir-io/module-contract';
import type {
  TestModule,
  RunnerSummary,
  TestRunResult,
  RuntimeFilter,
} from '@webstir-io/webstir-testing';
import type { BuildTargetKind, WorkspaceDescriptor } from './types.ts';

import { compileTestModules } from './compile-tests.ts';
import { materializeRepoLocalWorkspaceDependencies } from './external-workspace.ts';
import { loadProvider } from './providers.ts';
import {
  applyRuntimeFilter,
  describeRuntimeFilter,
  normalizeRuntimeFilter,
} from './runtime-filter.ts';
import { createWorkspaceRuntimeEnv } from './runtime.ts';
import { run as runFrontendTests } from './testing-runtime.ts';
import { readWorkspaceDescriptor } from './workspace.ts';
import {
  createDefaultProviderRegistry as createPublishedProviderRegistry,
  discoverTestManifest,
} from '@webstir-io/webstir-testing';

export interface RunTestOptions {
  readonly workspaceRoot: string;
  readonly rawArgs: readonly string[];
  readonly env?: Record<string, string | undefined>;
  readonly quietInstall?: boolean;
}

export interface TestCommandResult {
  readonly workspace: WorkspaceDescriptor;
  readonly runtime: 'all' | 'frontend' | 'backend';
  readonly builtTargets: readonly BuildTargetKind[];
  readonly summary: RunnerSummary;
  readonly filterMessage?: string;
  readonly hadFailures: boolean;
}

export async function runTest(options: RunTestOptions): Promise<TestCommandResult> {
  await materializeRepoLocalWorkspaceDependencies(options.workspaceRoot, {
    installStdio: options.quietInstall ? 'pipe' : 'inherit',
  });
  const runtime = parseRuntimeFlag(options.rawArgs, options.env);
  const workspace = await readWorkspaceDescriptor(options.workspaceRoot);
  const builtTargets = selectBuildTargets(workspace.mode, runtime);

  for (const target of builtTargets) {
    const provider = await loadProvider(target);
    const result = await provider.build({
      workspaceRoot: workspace.root,
      env: createWorkspaceRuntimeEnv(
        workspace.root,
        target === 'backend' ? 'test' : 'build',
        options.env,
      ),
      incremental: false,
    });

    if (target === 'backend' && result.manifest.module) {
      await persistBackendManifest(workspace.root, result.manifest.module);
    }
  }

  const manifest = await discoverTestManifest(workspace.root);
  const filteredManifest = applyRuntimeFilter(manifest, runtime);
  const filterMessage =
    describeRuntimeFilter(runtime, manifest.modules.length, filteredManifest.modules.length) ??
    undefined;
  await compileTestModules(workspace.root, filteredManifest.modules);
  const summary = await executeTestRun(filteredManifest.modules, workspace.root);

  return {
    workspace,
    runtime: runtime ?? 'all',
    builtTargets,
    summary,
    filterMessage,
    hadFailures: summary.failed > 0,
  };
}

export function formatFailedTests(results: readonly TestRunResult[]): string[] {
  return results
    .filter((result) => !result.passed)
    .map(
      (result) =>
        `${result.file}: ${result.name}${result.message ? ` — ${firstLine(result.message)}` : ''}`,
    );
}

async function executeTestRun(
  modules: readonly TestModule[],
  workspaceRoot: string,
): Promise<RunnerSummary> {
  const registry = createPublishedProviderRegistry();
  const grouped = new Map<TestModule['runtime'], TestModule[]>();

  for (const module of modules) {
    const list = grouped.get(module.runtime);
    if (list) {
      list.push(module);
    } else {
      grouped.set(module.runtime, [module]);
    }
  }

  let summary = createEmptySummary();

  for (const [runtime, runtimeModules] of grouped) {
    const provider =
      runtime === 'frontend'
        ? { id: '@webstir-io/webstir/frontend-runtime', runTests: runFrontendTests }
        : registry.get(runtime);
    if (!provider) {
      continue;
    }

    const files = runtimeModules
      .map((module) => module.compiledPath)
      .filter((compiledPath): compiledPath is string => typeof compiledPath === 'string');
    const runtimeSummary = await withRuntimeEnv(
      runtime,
      workspaceRoot,
      async () => await provider.runTests(files),
    );
    summary = {
      passed: summary.passed + runtimeSummary.passed,
      failed: summary.failed + runtimeSummary.failed,
      total: summary.total + runtimeSummary.total,
      durationMs: summary.durationMs + runtimeSummary.durationMs,
      results: [...summary.results, ...runtimeSummary.results],
    };
  }

  return summary;
}

async function withRuntimeEnv<T>(
  runtime: TestModule['runtime'],
  workspaceRoot: string,
  callback: () => Promise<T>,
): Promise<T> {
  if (runtime !== 'backend') {
    return await callback();
  }

  const previous = new Map<string, string | undefined>();
  const overrides: Record<string, string> = {
    WEBSTIR_WORKSPACE_ROOT: workspaceRoot,
    WEBSTIR_BACKEND_BUILD_ROOT: path.join(workspaceRoot, 'build', 'backend'),
    WEBSTIR_BACKEND_TEST_ENTRY: path.join(workspaceRoot, 'build', 'backend', 'index.js'),
    WEBSTIR_BACKEND_TEST_MANIFEST: path.join(workspaceRoot, '.webstir', 'backend-manifest.json'),
  };

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }

  try {
    return await callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function createEmptySummary(): RunnerSummary {
  return {
    passed: 0,
    failed: 0,
    total: 0,
    durationMs: 0,
    results: [],
  };
}

function selectBuildTargets(
  mode: WorkspaceDescriptor['mode'],
  runtime: RuntimeFilter,
): BuildTargetKind[] {
  if (runtime === 'frontend') {
    if (mode === 'spa' || mode === 'ssg' || mode === 'full') {
      return ['frontend'];
    }

    return [];
  }

  if (runtime === 'backend') {
    if (mode === 'api' || mode === 'full') {
      return ['backend'];
    }

    return [];
  }

  if (mode === 'spa' || mode === 'ssg') {
    return ['frontend'];
  }

  if (mode === 'api') {
    return ['backend'];
  }

  return ['frontend', 'backend'];
}

function parseRuntimeFlag(
  rawArgs: readonly string[],
  env: Record<string, string | undefined> = process.env,
): RuntimeFilter {
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === '--runtime' || arg === '-r') {
      return normalizeRuntimeFilter(rawArgs[index + 1] ?? null);
    }

    if (arg.startsWith('--runtime=')) {
      return normalizeRuntimeFilter(arg.slice('--runtime='.length));
    }
  }

  return normalizeRuntimeFilter(env.WEBSTIR_TEST_RUNTIME);
}

async function persistBackendManifest(
  workspaceRoot: string,
  manifest: ModuleManifest,
): Promise<void> {
  const webstirDir = path.join(workspaceRoot, '.webstir');
  await mkdir(webstirDir, { recursive: true });
  await writeFile(
    path.join(webstirDir, 'backend-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
}

function firstLine(message: string): string {
  return message.split(/\r?\n/, 1)[0] ?? message;
}
