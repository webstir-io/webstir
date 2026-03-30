import { createRequire } from 'node:module';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { runAgentScaffoldJob, runAgentScaffoldPage, runAgentScaffoldRoute } from '../agent.ts';
import { runUpdateRouteContract } from '../add-backend.ts';
import { runBackendInspect } from '../backend-inspect.ts';
import { runCliJson, type JsonCliResult } from './run-cli-json.ts';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version?: string };
const httpMethodSchema = z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const routeInteractionSchema = z.enum(['navigation', 'mutation']);
const sessionModeSchema = z.enum(['optional', 'required']);
const fragmentModeSchema = z.enum(['replace', 'append', 'prepend']);
const schemaReferenceSchema = z
  .object({
    kind: z.enum(['zod', 'json-schema', 'ts-rest']).optional(),
    name: z.string().min(1),
    source: z.string().min(1).optional(),
  })
  .strict();

const workspaceSchema = z
  .object({
    workspace: z.string().min(1),
  })
  .strict();

const scaffoldPageSchema = z
  .object({
    workspace: z.string().min(1),
    name: z.string().min(1),
  })
  .strict();

const scaffoldRouteSchema = z
  .object({
    workspace: z.string().min(1),
    name: z.string().min(1),
    method: httpMethodSchema.optional(),
    path: z.string().min(1).optional(),
    summary: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    tags: z.array(z.string().min(1)).optional(),
    interaction: routeInteractionSchema.optional(),
  })
  .strict();

const updateRouteContractSchema = z
  .object({
    workspace: z.string().min(1),
    method: httpMethodSchema,
    path: z.string().min(1),
    session: sessionModeSchema.nullable().optional(),
    sessionWrite: z.boolean().nullable().optional(),
    formUrlEncoded: z.boolean().nullable().optional(),
    csrf: z.boolean().nullable().optional(),
    fragmentTarget: z.string().min(1).nullable().optional(),
    fragmentSelector: z.string().min(1).nullable().optional(),
    fragmentMode: fragmentModeSchema.nullable().optional(),
    paramsSchema: schemaReferenceSchema.nullable().optional(),
    querySchema: schemaReferenceSchema.nullable().optional(),
    bodySchema: schemaReferenceSchema.nullable().optional(),
    headersSchema: schemaReferenceSchema.nullable().optional(),
    responseSchema: schemaReferenceSchema.nullable().optional(),
    responseStatus: z.number().int().min(100).max(599).nullable().optional(),
    responseHeadersSchema: schemaReferenceSchema.nullable().optional(),
  })
  .strict();

const scaffoldJobSchema = z
  .object({
    workspace: z.string().min(1),
    name: z.string().min(1),
    schedule: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    priority: z.union([z.number().int(), z.string().min(1)]).optional(),
  })
  .strict();

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'webstir',
    version: getPackageVersion(),
  });

  server.registerTool(
    'list_operations',
    {
      title: 'List Operations',
      description: 'List stable Webstir operations and their machine-readable metadata.',
    },
    async () => toToolResult(await runCliJson(['operations', '--json'])),
  );

  server.registerTool(
    'inspect_workspace',
    {
      title: 'Inspect Workspace',
      description: 'Run unified Webstir inspection for the selected workspace.',
      inputSchema: workspaceSchema,
    },
    async ({ workspace }) =>
      toToolResult(await runCliJson(['inspect', '--json', '--workspace', workspace])),
  );

  server.registerTool(
    'validate_workspace',
    {
      title: 'Validate Workspace',
      description: 'Run doctor and tests for the selected workspace.',
      inputSchema: workspaceSchema,
    },
    async ({ workspace }) =>
      toToolResult(await runCliJson(['agent', 'validate', '--json', '--workspace', workspace])),
  );

  server.registerTool(
    'repair_workspace',
    {
      title: 'Repair Workspace',
      description: 'Apply scaffold-managed repair actions and re-check workspace health.',
      inputSchema: workspaceSchema,
    },
    async ({ workspace }) =>
      toToolResult(await runCliJson(['agent', 'repair', '--json', '--workspace', workspace])),
  );

  server.registerTool(
    'repair_dry_run',
    {
      title: 'Repair Dry Run',
      description: 'Report scaffold-managed repair actions without mutating the workspace.',
      inputSchema: workspaceSchema,
    },
    async ({ workspace }) =>
      toToolResult(await runCliJson(['repair', '--dry-run', '--json', '--workspace', workspace])),
  );

  server.registerTool(
    'scaffold_page',
    {
      title: 'Scaffold Page',
      description: 'Create a frontend page through the stable Webstir scaffold flow.',
      inputSchema: scaffoldPageSchema,
    },
    async (input) =>
      toStructuredToolResult({
        command: 'agent',
        ...(await runAgentScaffoldPage({
          workspaceRoot: input.workspace,
          pageName: input.name,
        })),
      }),
  );

  server.registerTool(
    'scaffold_route',
    {
      title: 'Scaffold Route',
      description: 'Create a backend route through the stable Webstir scaffold flow.',
      inputSchema: scaffoldRouteSchema,
    },
    async (input) =>
      toStructuredToolResult({
        command: 'agent',
        ...(await runAgentScaffoldRoute({
          workspaceRoot: input.workspace,
          name: input.name,
          method: input.method,
          path: input.path,
          summary: input.summary,
          description: input.description,
          tags: input.tags,
          interaction: input.interaction,
        })),
      }),
  );

  server.registerTool(
    'update_route_contract',
    {
      title: 'Update Route Contract',
      description:
        'Enrich an existing backend route with session, form, fragment, and request or response contract metadata.',
      inputSchema: updateRouteContractSchema,
    },
    async (input) => {
      const scaffold = await runUpdateRouteContract({
        workspaceRoot: input.workspace,
        method: input.method,
        path: input.path,
        sessionMode: input.session,
        sessionWrite: input.sessionWrite,
        formUrlEncoded: input.formUrlEncoded,
        formCsrf: input.csrf,
        fragmentTarget: input.fragmentTarget,
        fragmentSelector: input.fragmentSelector,
        fragmentMode: input.fragmentMode,
        paramsSchema: formatNullableSchemaReference(input.paramsSchema),
        querySchema: formatNullableSchemaReference(input.querySchema),
        bodySchema: formatNullableSchemaReference(input.bodySchema),
        headersSchema: formatNullableSchemaReference(input.headersSchema),
        responseSchema: formatNullableSchemaReference(input.responseSchema),
        responseStatus: input.responseStatus,
        responseHeadersSchema: formatNullableSchemaReference(input.responseHeadersSchema),
      });
      const inspect = await runBackendInspect({
        workspaceRoot: input.workspace,
      });

      return toStructuredToolResult({
        command: 'update-route-contract',
        success: true,
        scaffold,
        inspect,
      });
    },
  );

  server.registerTool(
    'scaffold_job',
    {
      title: 'Scaffold Job',
      description: 'Create a backend job through the stable Webstir scaffold flow.',
      inputSchema: scaffoldJobSchema,
    },
    async (input) =>
      toStructuredToolResult({
        command: 'agent',
        ...(await runAgentScaffoldJob({
          workspaceRoot: input.workspace,
          name: input.name,
          schedule: input.schedule,
          description: input.description,
          priority: input.priority,
        })),
      }),
  );

  return server;
}

export async function runMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function getPackageVersion(): string {
  if (typeof pkg.version === 'string' && pkg.version.trim().length > 0) {
    return pkg.version;
  }

  throw new Error('Missing version in orchestrator package.json for MCP server.');
}

function formatSchemaReference(
  value: z.infer<typeof schemaReferenceSchema> | undefined,
): string | undefined {
  if (!value) {
    return undefined;
  }

  return `${value.kind ?? 'zod'}:${value.name}${value.source ? `@${value.source}` : ''}`;
}

function formatNullableSchemaReference(
  value: z.infer<typeof schemaReferenceSchema> | null | undefined,
): string | null | undefined {
  if (value === null) {
    return null;
  }
  return formatSchemaReference(value);
}

function toStructuredToolResult(data: Record<string, unknown>): {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: Record<string, unknown>;
  isError?: boolean;
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
    ...(data.success === false ? { isError: true } : {}),
  };
}

function toToolResult(result: JsonCliResult): {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
} {
  const text =
    result.data !== undefined
      ? JSON.stringify(result.data, null, 2)
      : [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n\n');

  return {
    content: [{ type: 'text', text }],
    ...(result.data !== undefined ? { structuredContent: result.data } : {}),
    ...(result.exitCode !== 0 ? { isError: true } : {}),
  };
}
