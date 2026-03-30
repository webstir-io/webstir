import { expect, test } from 'bun:test';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { packageRoot, repoRoot } from '../src/paths.ts';
import { copyDemoWorkspace, removeDemoWorkspace } from '../test-support/demo-workspace.ts';

function buildEnv(overrides: Record<string, string | undefined> = {}): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
      continue;
    }

    env[key] = value;
  }

  return env;
}

async function connectClient(envOverrides: Record<string, string | undefined> = {}): Promise<{
  readonly client: Client;
  readonly transport: StdioClientTransport;
}> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(packageRoot, 'src', 'cli.ts'), 'mcp'],
    cwd: repoRoot,
    env: buildEnv(envOverrides),
    stderr: 'pipe',
  });
  const client = new Client({
    name: 'webstir-test-client',
    version: '1.0.0',
  });
  await client.connect(transport);
  return {
    client,
    transport,
  };
}

test('MCP server exposes the stable Webstir tool subset', async () => {
  const { client, transport } = await connectClient();

  try {
    const result = await client.listTools();
    expect(result.tools.map((tool) => tool.name)).toEqual([
      'list_operations',
      'inspect_workspace',
      'validate_workspace',
      'repair_workspace',
      'repair_dry_run',
      'scaffold_page',
      'scaffold_route',
      'update_route_contract',
      'scaffold_job',
    ]);

    const invalidResult = await client.callTool({
      name: 'scaffold_route',
      arguments: {
        workspace: '/tmp/webstir-invalid-mcp',
        name: 'sample',
        responseSchema: {
          name: 'SampleResponse',
        },
      },
    });
    expect(invalidResult.isError).toBe(true);
    expect(JSON.stringify(invalidResult.content)).toContain('Unrecognized key');
    expect(JSON.stringify(invalidResult.content)).toContain('responseSchema');
  } finally {
    await transport.close();
  }
});

test('MCP inspect_workspace preserves structured output when inspection is unhealthy', async () => {
  const copiedWorkspace = await copyDemoWorkspace('api', 'webstir-mcp-inspect-api-');
  const { client, transport } = await connectClient({
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
  });

  try {
    await rm(path.join(copiedWorkspace.workspaceRoot, 'Errors.404.html'), { force: true });

    const result = await client.callTool({
      name: 'inspect_workspace',
      arguments: {
        workspace: copiedWorkspace.workspaceRoot,
      },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeTruthy();
    const content = result.structuredContent as {
      command: string;
      success: boolean;
      doctor: { healthy: boolean };
      backend?: { manifest: { name: string } };
    };
    expect(content.command).toBe('inspect');
    expect(content.success).toBe(false);
    expect(content.doctor.healthy).toBe(false);
    expect(content.backend?.manifest.name).toBe('webstir-demo-api');
  } finally {
    await transport.close();
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('MCP scaffold_page uses a typed input contract and creates the page', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-mcp-page-spa-');
  const { client, transport } = await connectClient();

  try {
    const result = await client.callTool({
      name: 'scaffold_page',
      arguments: {
        workspace: copiedWorkspace.workspaceRoot,
        name: 'about',
      },
    });

    expect(result.isError).toBeFalsy();
    const content = result.structuredContent as {
      command: string;
      goal: string;
      success: boolean;
      scaffold?: { target: string };
    };
    expect(content.command).toBe('agent');
    expect(content.goal).toBe('scaffold-page');
    expect(content.success).toBe(true);
    expect(content.scaffold?.target).toBe('about');
    expect(
      existsSync(
        path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'pages', 'about', 'index.html'),
      ),
    ).toBe(true);
  } finally {
    await transport.close();
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('MCP scaffold_route keeps the route creation flow narrow and typed', async () => {
  const copiedWorkspace = await copyDemoWorkspace('api', 'webstir-mcp-route-api-');
  const { client, transport } = await connectClient({
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
  });

  try {
    const result = await client.callTool({
      name: 'scaffold_route',
      arguments: {
        workspace: copiedWorkspace.workspaceRoot,
        name: 'session-sign-in',
        method: 'POST',
        path: '/session/sign-in',
        summary: 'Sign in through a server-handled form',
        interaction: 'mutation',
      },
    });

    expect(result.isError).toBeFalsy();
    const content = result.structuredContent as {
      command: string;
      goal: string;
      success: boolean;
      scaffold?: { target: string };
      inspect?: { manifest: { routes?: Array<Record<string, unknown>> } };
    };
    expect(content.command).toBe('agent');
    expect(content.goal).toBe('scaffold-route');
    expect(content.success).toBe(true);
    expect(content.scaffold?.target).toBe('POST /session/sign-in');

    const packageJson = JSON.parse(
      await readFile(path.join(copiedWorkspace.workspaceRoot, 'package.json'), 'utf8'),
    ) as {
      webstir?: { moduleManifest?: { routes?: Array<Record<string, unknown>> } };
    };
    const route = packageJson.webstir?.moduleManifest?.routes?.find(
      (entry) => entry.method === 'POST' && entry.path === '/session/sign-in',
    );
    expect(route).toMatchObject({
      name: 'session-sign-in',
      method: 'POST',
      path: '/session/sign-in',
      summary: 'Sign in through a server-handled form',
      interaction: 'mutation',
    });
    expect(Array.isArray(content.inspect?.manifest.routes)).toBe(true);
  } finally {
    await transport.close();
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('MCP update_route_contract enriches an existing route contract without redefining the route', async () => {
  const copiedWorkspace = await copyDemoWorkspace('api', 'webstir-mcp-route-contract-api-');
  const { client, transport } = await connectClient({
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
  });

  try {
    await client.callTool({
      name: 'scaffold_route',
      arguments: {
        workspace: copiedWorkspace.workspaceRoot,
        name: 'session-sign-in',
        method: 'POST',
        path: '/session/sign-in',
        summary: 'Sign in through a server-handled form',
        interaction: 'mutation',
      },
    });

    const result = await client.callTool({
      name: 'update_route_contract',
      arguments: {
        workspace: copiedWorkspace.workspaceRoot,
        method: 'POST',
        path: '/session/sign-in',
        session: 'required',
        sessionWrite: true,
        formUrlEncoded: true,
        csrf: true,
        fragmentTarget: 'session-panel',
        fragmentSelector: '#session-panel',
        fragmentMode: 'replace',
        responseSchema: {
          name: 'SessionSignInResponse',
          source: './src/backend/schemas/session.ts',
        },
        responseStatus: 200,
      },
    });

    expect(result.isError).toBeFalsy();
    const content = result.structuredContent as {
      command: string;
      success: boolean;
      scaffold?: { target: string };
      inspect?: { manifest: { routes?: Array<Record<string, unknown>> } };
    };
    expect(content.command).toBe('update-route-contract');
    expect(content.success).toBe(true);
    expect(content.scaffold?.target).toBe('POST /session/sign-in');

    const packageJson = JSON.parse(
      await readFile(path.join(copiedWorkspace.workspaceRoot, 'package.json'), 'utf8'),
    ) as {
      webstir?: { moduleManifest?: { routes?: Array<Record<string, unknown>> } };
    };
    const route = packageJson.webstir?.moduleManifest?.routes?.find(
      (entry) => entry.method === 'POST' && entry.path === '/session/sign-in',
    );
    expect(route).toMatchObject({
      name: 'session-sign-in',
      summary: 'Sign in through a server-handled form',
      interaction: 'mutation',
      session: {
        mode: 'required',
        write: true,
      },
      form: {
        contentType: 'application/x-www-form-urlencoded',
        csrf: true,
      },
      fragment: {
        target: 'session-panel',
        selector: '#session-panel',
        mode: 'replace',
      },
      output: {
        status: 200,
        body: {
          kind: 'zod',
          name: 'SessionSignInResponse',
          source: './src/backend/schemas/session.ts',
        },
      },
    });
    expect(Array.isArray(content.inspect?.manifest.routes)).toBe(true);
  } finally {
    await transport.close();
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('MCP update_route_contract allows partial fragment and response updates', async () => {
  const copiedWorkspace = await copyDemoWorkspace('api', 'webstir-mcp-route-contract-partial-api-');
  const { client, transport } = await connectClient({
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
  });

  try {
    await client.callTool({
      name: 'scaffold_route',
      arguments: {
        workspace: copiedWorkspace.workspaceRoot,
        name: 'session-sign-in',
        method: 'POST',
        path: '/session/sign-in',
        summary: 'Sign in through a server-handled form',
        interaction: 'mutation',
      },
    });

    const initialUpdate = await client.callTool({
      name: 'update_route_contract',
      arguments: {
        workspace: copiedWorkspace.workspaceRoot,
        method: 'POST',
        path: '/session/sign-in',
        fragmentTarget: 'session-panel',
        responseSchema: {
          name: 'SessionSignInResponse',
          source: './src/backend/schemas/session.ts',
        },
      },
    });
    expect(initialUpdate.isError).toBeFalsy();

    const partialUpdate = await client.callTool({
      name: 'update_route_contract',
      arguments: {
        workspace: copiedWorkspace.workspaceRoot,
        method: 'POST',
        path: '/session/sign-in',
        fragmentMode: 'replace',
        responseStatus: 200,
      },
    });

    expect(partialUpdate.isError).toBeFalsy();
    const packageJson = JSON.parse(
      await readFile(path.join(copiedWorkspace.workspaceRoot, 'package.json'), 'utf8'),
    ) as {
      webstir?: { moduleManifest?: { routes?: Array<Record<string, unknown>> } };
    };
    const route = packageJson.webstir?.moduleManifest?.routes?.find(
      (entry) => entry.method === 'POST' && entry.path === '/session/sign-in',
    );
    expect(route).toMatchObject({
      fragment: {
        target: 'session-panel',
        mode: 'replace',
      },
      output: {
        status: 200,
        body: {
          kind: 'zod',
          name: 'SessionSignInResponse',
          source: './src/backend/schemas/session.ts',
        },
      },
    });
  } finally {
    await transport.close();
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('MCP scaffold_job uses typed job fields instead of raw CLI args', async () => {
  const copiedWorkspace = await copyDemoWorkspace('api', 'webstir-mcp-job-api-');
  const { client, transport } = await connectClient({
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
  });

  try {
    const result = await client.callTool({
      name: 'scaffold_job',
      arguments: {
        workspace: copiedWorkspace.workspaceRoot,
        name: 'session-cleanup',
        schedule: '0 0 * * *',
        description: 'Clear expired sessions',
        priority: 5,
      },
    });

    expect(result.isError).toBeFalsy();
    const content = result.structuredContent as {
      command: string;
      goal: string;
      success: boolean;
      scaffold?: { target: string };
    };
    expect(content.command).toBe('agent');
    expect(content.goal).toBe('scaffold-job');
    expect(content.success).toBe(true);
    expect(content.scaffold?.target).toBe('session-cleanup');
    expect(
      existsSync(
        path.join(
          copiedWorkspace.workspaceRoot,
          'src',
          'backend',
          'jobs',
          'session-cleanup',
          'index.ts',
        ),
      ),
    ).toBe(true);

    const packageJson = JSON.parse(
      await readFile(path.join(copiedWorkspace.workspaceRoot, 'package.json'), 'utf8'),
    ) as {
      webstir?: { moduleManifest?: { jobs?: Array<Record<string, unknown>> } };
    };
    const job = packageJson.webstir?.moduleManifest?.jobs?.find(
      (entry) => entry.name === 'session-cleanup',
    );
    expect(job).toMatchObject({
      name: 'session-cleanup',
      schedule: '0 0 * * *',
      description: 'Clear expired sessions',
      priority: 5,
    });
  } finally {
    await transport.close();
    await removeDemoWorkspace(copiedWorkspace);
  }
});
