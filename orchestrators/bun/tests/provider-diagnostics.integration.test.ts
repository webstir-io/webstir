import { expect, test } from 'bun:test';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { packageRoot, repoRoot } from '../src/paths.ts';
import {
  copyDemoWorkspace,
  removeDemoWorkspace,
  type DemoWorkspaceCopy,
} from '../test-support/demo-workspace.ts';

const backendTypecheckSkipped = {
  WEBSTIR_BACKEND_TYPECHECK: 'skip',
};

function decodeOutput(buffer: Uint8Array | undefined): string {
  return new TextDecoder().decode(buffer ?? new Uint8Array());
}

function runCli(
  args: readonly string[],
  envOverrides: Record<string, string | undefined> = {},
): {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
} {
  const processResult = Bun.spawnSync({
    cmd: [process.execPath, path.join(packageRoot, 'src', 'cli.ts'), ...args],
    cwd: repoRoot,
    env: {
      ...process.env,
      ...envOverrides,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return {
    stdout: decodeOutput(processResult.stdout),
    stderr: decodeOutput(processResult.stderr),
    exitCode: processResult.exitCode,
  };
}

async function createInvalidManifestWorkspace(prefix: string): Promise<DemoWorkspaceCopy> {
  const copiedWorkspace = await copyDemoWorkspace('full', prefix);
  const packageJsonPath = path.join(copiedWorkspace.workspaceRoot, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
    webstir?: {
      moduleManifest?: Record<string, unknown>;
    };
  };
  packageJson.webstir ??= {};
  packageJson.webstir.moduleManifest ??= {};
  packageJson.webstir.moduleManifest.services = 'invalid';
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
  return copiedWorkspace;
}

function buildEnv(overrides: Record<string, string | undefined> = {}): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  return env;
}

async function connectClient(
  envOverrides: Record<string, string | undefined> = {},
): Promise<{ readonly client: Client; readonly transport: StdioClientTransport }> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(packageRoot, 'src', 'cli.ts'), 'mcp'],
    cwd: repoRoot,
    env: buildEnv(envOverrides),
    stderr: 'pipe',
  });
  const client = new Client({
    name: 'webstir-provider-diagnostics-test-client',
    version: '1.0.0',
  });
  await client.connect(transport);
  return { client, transport };
}

test('provider error diagnostics fail direct test and backend-inspect commands', async () => {
  const copiedWorkspace = await createInvalidManifestWorkspace(
    'webstir-provider-diagnostics-direct-',
  );

  try {
    const testResult = runCli(
      ['test', '--workspace', copiedWorkspace.workspaceRoot],
      backendTypecheckSkipped,
    );
    expect(testResult.exitCode).toBe(1);
    expect(testResult.stderr).toContain('backend test reported 1 error diagnostic');
    expect(testResult.stderr).toContain('module manifest validation failed');

    const inspectResult = runCli(
      ['backend-inspect', '--json', '--workspace', copiedWorkspace.workspaceRoot],
      backendTypecheckSkipped,
    );
    expect(inspectResult.exitCode).toBe(1);
    expect(inspectResult.stderr).toContain('backend inspect reported 1 error diagnostic');
    expect(inspectResult.stderr).toContain('module manifest validation failed');
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('provider error diagnostics make every composed truth surface unhealthy', async () => {
  const copiedWorkspace = await createInvalidManifestWorkspace(
    'webstir-provider-diagnostics-composed-',
  );

  try {
    const doctorResult = runCli(
      ['doctor', '--json', '--workspace', copiedWorkspace.workspaceRoot],
      backendTypecheckSkipped,
    );
    expect(doctorResult.exitCode).toBe(1);
    const doctor = JSON.parse(doctorResult.stdout) as {
      healthy: boolean;
      checks: Array<{ id: string; status: string; detail?: string }>;
      issues: Array<{ code: string; message: string }>;
    };
    expect(doctor.healthy).toBe(false);
    expect(doctor.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'backend-inspect', status: 'fail' })]),
    );
    expect(doctor.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'backend_inspect_failed' })]),
    );

    const inspectResult = runCli(
      ['inspect', '--json', '--workspace', copiedWorkspace.workspaceRoot],
      backendTypecheckSkipped,
    );
    expect(inspectResult.exitCode).toBe(1);
    const inspect = JSON.parse(inspectResult.stdout) as {
      success: boolean;
      steps: Array<{ id: string; status: string }>;
    };
    expect(inspect.success).toBe(false);
    expect(inspect.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'doctor', status: 'failed' }),
        expect.objectContaining({ id: 'backend-inspect', status: 'failed' }),
      ]),
    );

    const validateResult = runCli(
      ['agent', 'validate', '--json', '--workspace', copiedWorkspace.workspaceRoot],
      backendTypecheckSkipped,
    );
    expect(validateResult.exitCode).toBe(1);
    const validate = JSON.parse(validateResult.stdout) as {
      success: boolean;
      steps: Array<{ id: string; status: string }>;
    };
    expect(validate.success).toBe(false);
    expect(validate.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'doctor', status: 'failed' }),
        expect.objectContaining({ id: 'test', status: 'skipped' }),
      ]),
    );
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('MCP validate_workspace fails on provider error diagnostics', async () => {
  const copiedWorkspace = await createInvalidManifestWorkspace('webstir-provider-diagnostics-mcp-');
  let transport: StdioClientTransport | undefined;

  try {
    const connected = await connectClient(backendTypecheckSkipped);
    transport = connected.transport;
    const result = await connected.client.callTool({
      name: 'validate_workspace',
      arguments: {
        workspace: copiedWorkspace.workspaceRoot,
      },
    });

    expect(result.isError).toBe(true);
    const content = result.structuredContent as {
      success: boolean;
      doctor: { healthy: boolean };
      steps: Array<{ id: string; status: string }>;
    };
    expect(content.success).toBe(false);
    expect(content.doctor.healthy).toBe(false);
    expect(content.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'doctor', status: 'failed' }),
        expect.objectContaining({ id: 'test', status: 'skipped' }),
      ]),
    );
  } finally {
    await transport?.close();
    await removeDemoWorkspace(copiedWorkspace);
  }
});
