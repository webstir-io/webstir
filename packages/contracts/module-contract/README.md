# @webstir-io/module-contract

TypeScript interfaces, helper utilities, and JSON schema describing Webstir modules and providers. The contract covers build-time provider APIs and the runtime surface (contexts, manifests, routes, views) that providers expose to the orchestrator.

## Status

- Experimental contract for the Webstir ecosystem — shapes and helpers may change as providers and orchestrator behavior are refined.
- Expect breaking changes across early versions; pin carefully if you integrate it outside Webstir itself.

## Install

```bash
npm install @webstir-io/module-contract
```

## Provided Types

```ts
import {
  ModuleProvider,
  ModuleBuildResult,
  moduleManifestSchema,
  routeDefinitionSchema,
  viewDefinitionSchema,
  defineRoute,
  defineView,
  createModule,
  CONTRACT_VERSION,
  type RequestContext,
  type SSRContext,
} from '@webstir-io/module-contract';
```

- `ModuleProvider` remains the build-time contract (`metadata`, `resolveWorkspace`, `build`).
- `moduleManifestSchema` / `routeDefinitionSchema` / `viewDefinitionSchema` model the runtime manifest that orchestrators ingest; the package publishes matching JSON schema under `schema/`.
- `defineRoute`, `defineView`, and `createModule` give providers ergonomic helpers with strong TypeScript inference.
- `RequestContext` and `SSRContext` describe what the orchestrator supplies to route and view handlers.
- Routes and views support optional SSG metadata: `renderMode?: 'ssg' | 'ssr' | 'spa'`, `staticPaths?: string[]`, and a reserved `ssg?: { revalidateSeconds?: number }` bag for future incremental/static revalidation hints.
- Modules can declare `requestHooks?: { id, phase, order }[]`, and routes can opt into them with `requestHooks?: { id }[]`.
- Routes can also declare progressive-enhancement metadata with `interaction?: 'navigation' | 'mutation'`, optional `session`/`flash` metadata, optional form-level `session`/`flash` metadata, and an optional `fragment` target for partial updates.
- Route `output` can describe a single response case or a `responses: [...]` list when native and enhanced flows diverge.
- Route handlers may now return normal document/json bodies, targeted fragment updates, or redirects through the shared result contract, with `RouteNavigationResult` and `RouteMutationResult` aliases for the common progressive-enhancement patterns.

> Requires Zod 4.6.6 or later. Upgrade application schemas to Zod 4. Framework-owned manifest, render-program and flash collections accept at most 10,000 items per array; this does not impose a limit on application-defined data schemas.

## Schema References

`SchemaReference` objects describe how a manifest entry maps back to the typed schema that produced it. Webstir modules emit these references in `route.input`, `route.output`, and `view` definitions so downstream tooling can point developers to the right file when something fails validation.

Format:
- `kind` &mdash; schema system. Supported values: `zod` (default), `json-schema`, `ts-rest`.
- `name` &mdash; PascalCase identifier that matches the exported symbol or schema `$id`.
- `source` &mdash; optional module specifier (usually a workspace-relative path like `src/backend/routes/accounts.ts` or a package entry such as `@demo/contracts/accounts.ts`).

Naming & source guidance:
- Keep `name` stable across builds. Use the TypeScript identifier for `zod`, the `$id` (or filename) for JSON Schema, and the router key for ts-rest metadata.
- Use `source` whenever the schema lives outside the generated manifest (for example, in `src/shared/contracts/`), and prefer workspace-relative paths so the CLI can resolve them after scaffolding.
- When emitting references from the CLI, serialize the tuple as `kind:name@source` (drop `kind:` for `zod` and omit `@source` when not needed). This is the same string accepted by `--*-schema` flags on `webstir add-route`.
- Keep `kind`/`name` unique per file to avoid ambiguity when generators pre-populate manifest entries.

## Usage Example

```ts
import { createModule, defineRoute, defineView, RequestContext, SSRContext } from '@webstir-io/module-contract';
import { z } from 'zod';

const paramsSchema = z.object({ id: z.string().uuid() });
const responseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email()
});
const viewDataSchema = z.object({ account: responseSchema });
const updateAccountEmailSchema = z.object({ email: z.string().email() });

function isEnhancedRequest(request: unknown): boolean {
  if (!request || typeof request !== 'object') {
    return false;
  }

  const headers = (request as { headers?: Record<string, string | string[] | undefined> }).headers;
  const header = headers?.['x-webstir-client-nav'];
  return header === '1' || (Array.isArray(header) && header.includes('1'));
}

const getAccount = defineRoute<RequestContext, typeof paramsSchema, undefined, undefined, typeof responseSchema>({
  definition: {
    name: 'getAccount',
    method: 'GET',
    path: '/accounts/:id',
    requestHooks: [{ id: 'resolve-session' }, { id: 'audit-log' }],
    session: {
      mode: 'optional'
    },
    flash: {
      consume: ['account-email-updated']
    },
    input: {
      params: { kind: 'zod', name: 'AccountRouteParams', source: 'src/backend/server/routes/accounts.ts' }
    },
    output: {
      body: { kind: 'zod', name: 'AccountRouteResponse', source: 'src/backend/server/routes/accounts.ts' },
      status: 200
    }
  },
  schemas: {
    params: paramsSchema,
    response: responseSchema
  },
  handler: async (ctx) => ({
    status: 200,
    body: await ctx.db.accounts.findById(ctx.params.id)
  })
});

const updateAccountEmail = defineRoute<RequestContext, typeof paramsSchema, undefined, typeof updateAccountEmailSchema, typeof responseSchema>({
  definition: {
    name: 'updateAccountEmail',
    method: 'POST',
    path: '/accounts/:id/email',
    interaction: 'mutation',
    requestHooks: [{ id: 'resolve-session' }, { id: 'audit-log' }],
    session: {
      mode: 'required',
      write: true
    },
    form: {
      contentType: 'application/x-www-form-urlencoded',
      csrf: true,
      session: {
        mode: 'required',
        write: true
      },
      flash: {
        publish: [{ key: 'account-email-updated', level: 'success', when: 'success' }]
      }
    },
    fragment: {
      target: 'account-email',
      mode: 'replace'
    },
    input: {
      params: { kind: 'zod', name: 'AccountRouteParams', source: 'src/backend/server/routes/accounts.ts' },
      body: { kind: 'zod', name: 'UpdateAccountEmailInput', source: 'src/backend/server/routes/accounts.ts' }
    },
    output: {
      responses: [
        {
          status: 200,
          body: { kind: 'zod', name: 'AccountRouteResponse', source: 'src/backend/server/routes/accounts.ts' },
          fragment: {
            target: 'account-email',
            mode: 'replace'
          }
        },
        {
          redirect: {
            status: 303
          }
        }
      ]
    }
  },
  schemas: {
    params: paramsSchema,
    body: updateAccountEmailSchema,
    response: responseSchema
  },
  handler: async (ctx) => {
    const account = await ctx.db.accounts.updateEmail(ctx.params.id, ctx.body.email);
    if (isEnhancedRequest(ctx.request)) {
      return {
        status: 200,
        fragment: {
          target: 'account-email',
          mode: 'replace',
          body: account
        }
      };
    }

    return {
      status: 303,
      redirect: {
        location: `/accounts/${ctx.params.id}`
      }
    };
  }
});

const accountView = defineView<SSRContext, typeof paramsSchema, typeof viewDataSchema>({
  definition: {
    name: 'AccountView',
    path: '/accounts/:id',
    params: { kind: 'zod', name: 'AccountViewParams', source: 'src/backend/views/account.ts' },
    data: { kind: 'zod', name: 'AccountViewData', source: 'src/backend/views/account.ts' },
    // Optional SSG hints for frontend providers
    renderMode: 'ssg',
    staticPaths: ['/accounts/demo']
  },
  params: paramsSchema,
  data: viewDataSchema,
  load: async (ctx) => ({ account: await ctx.env.api.fetchAccount(ctx.params.id) })
});

export const accountsModule = createModule({
  manifest: {
    contractVersion: CONTRACT_VERSION,
    name: '@demo/accounts',
    version: '0.0.1',
    kind: 'backend',
    capabilities: ['auth', 'db', 'views'],
    // Optional: pass-through metadata for providers
    assets: [],
    requestHooks: [
      {
        id: 'resolve-session',
        phase: 'beforeAuth',
        order: 10
      },
      {
        id: 'audit-log',
        phase: 'afterHandler',
        order: 90
      }
    ],
    routes: [getAccount.definition, updateAccountEmail.definition],
    views: [accountView.definition]
  },
  routes: [getAccount, updateAccountEmail],
  views: [accountView]
});
```

Use `output.responses` when a route may return different enhanced and baseline shapes from the same handler:

```ts
output: {
  responses: [
    {
      status: 200,
      body: { kind: 'zod', name: 'AccountRouteResponse' },
      fragment: {
        target: 'account-email',
        mode: 'replace'
      }
    },
    {
      redirect: {
        status: 303
      }
    }
  ]
};
```

Fragment-capable handlers can still return partial updates directly:

```ts
return {
  status: 200,
  fragment: {
    target: 'account-email',
    mode: 'replace',
    body: {
      id: ctx.params.id,
      email: 'updated@example.com'
    }
  }
};
```

### Native Route Example

```ts
import { defineRoute, type RequestContext } from '@webstir-io/module-contract';
import { z } from 'zod';

const params = z.object({ id: z.string().uuid() });
const account = z.object({ id: z.string().uuid(), email: z.email() });

const detail = defineRoute<RequestContext, typeof params, undefined, undefined, typeof account>({
  definition: { name: 'accounts.detail', method: 'GET', path: '/accounts/:id' },
  schemas: { params, response: account },
  handler: async (ctx) => ({
    status: 200,
    body: { id: ctx.params.id, email: 'account@example.com' },
  }),
});
```

Use native `defineRoute` definitions in `createModule({ routes: [detail], ... })`. The ts-rest adapter helpers, adapter option types and `/ts-rest` export have been removed. Schema references may still use the `ts-rest` metadata kind.

When authoring a provider:

1. Populate `metadata` with id, version, and CLI compatibility info.
2. Use `createModule`/`defineRoute`/`defineView` to declare runtime capabilities with Zod-powered validation.
3. Return absolute filesystem paths in `ModuleArtifact.path` from the build step.
4. Emit `ModuleDiagnostic`s for recoverable issues and include the module manifest in `ModuleBuildResult.manifest.module`.

## Community & Support

- Code of Conduct: https://github.com/webstir-io/.github/blob/main/CODE_OF_CONDUCT.md
- Contributing guidelines: https://github.com/webstir-io/.github/blob/main/CONTRIBUTING.md
- Security policy and disclosure process: https://github.com/webstir-io/.github/blob/main/SECURITY.md
- Support expectations and contact channels: https://github.com/webstir-io/.github/blob/main/SUPPORT.md

## Maintainer Workflow

```bash
bun install
bun run clean          # remove dist/schema artifacts
bun run build          # compiles TypeScript, regenerates schema/*.schema.json
bun run test           # type-checks the Accounts example module
# From the repository root, describe the change for the next release
bun run changeset
```

- The `schema/` folder contains `*-definition.schema.json` files derived from the exported Zod schemas. Commit them with contract changes.
- Merging the "Version packages" pull request publishes the contract, backend, frontend, and CLI together.

## License

MIT © Webstir
