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

// Optional adapters live under a secondary export for teams using ts-rest
import { fromTsRestRoute, fromTsRestRouter } from '@webstir-io/module-contract/ts-rest';
```

- `ModuleProvider` remains the build-time contract (`metadata`, `resolveWorkspace`, `build`).
- `moduleManifestSchema` / `routeDefinitionSchema` / `viewDefinitionSchema` model the runtime manifest that orchestrators ingest; the package publishes matching JSON schema under `schema/`.
- `defineRoute`, `defineView`, and `createModule` give providers ergonomic helpers with strong TypeScript inference.
- `RequestContext` and `SSRContext` describe what the orchestrator supplies to route and view handlers.
- `fromTsRestRoute` converts an `@ts-rest/core` route contract into a Webstir `RouteSpec`, and `fromTsRestRouter` adapts an entire ts-rest router tree at once.
- Routes and views support optional SSG metadata: `renderMode?: 'ssg' | 'ssr' | 'spa'`, `staticPaths?: string[]`, and a reserved `ssg?: { revalidateSeconds?: number }` bag for future incremental/static revalidation hints.

> Install `@ts-rest/core` to use the adapters; it's published as an optional peer dependency of this package.

## Schema References

`SchemaReference` objects describe how a manifest entry maps back to the typed schema that produced it. Webstir modules emit these references in `route.input`, `route.output`, and `view` definitions so downstream tooling can point developers to the right file when something fails validation.

Format:
- `kind` &mdash; schema system. Supported values: `zod` (default), `json-schema`, `ts-rest`.
- `name` &mdash; PascalCase identifier that matches the exported symbol or schema `$id`.
- `source` &mdash; optional module specifier (usually a workspace-relative path like `src/backend/routes/accounts.ts` or a package entry such as `@demo/contracts/accounts.ts`).

Naming & source guidance:
- Keep `name` stable across builds. Use the TypeScript identifier for `zod`, the `$id` (or filename) for JSON Schema, and the router key for ts-rest adapters.
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

const getAccount = defineRoute<RequestContext, typeof paramsSchema, undefined, undefined, typeof responseSchema>({
  definition: {
    name: 'getAccount',
    method: 'GET',
    path: '/accounts/:id',
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
    middlewares: [],
    routes: [getAccount.definition],
    views: [accountView.definition]
  },
  routes: [getAccount],
  views: [accountView]
});
```

### ts-rest Router Example

```ts
import { initContract } from '@ts-rest/core';
import { fromTsRestRouter, type RequestContext } from '@webstir-io/module-contract/ts-rest';
import { z } from 'zod';

const c = initContract();

const accountsRouter = c.router({
  list: c.query({
    path: '/accounts',
    method: 'GET',
    responses: {
      200: z.object({
        data: z.array(z.object({ id: z.string(), email: z.string().email() }))
      })
    }
  }),
  detail: c.query({
    path: '/accounts/:id',
    method: 'GET',
    pathParams: z.object({ id: z.string().uuid() }),
    responses: {
      200: z.object({ id: z.string().uuid(), email: z.string().email() }),
      404: z.null()
    }
  })
});

const routeSpecs = fromTsRestRouter<RequestContext>({
  router: accountsRouter,
  baseName: 'accounts',
  createRoute: ({ keyPath, appRoute }) => ({
    handler: async (ctx) => {
      if (keyPath.at(-1) === 'detail') {
        const account = await ctx.db.accounts.findById(ctx.params.id);
        return account
          ? { status: 200, body: account }
          : { status: 404, errors: [{ code: 'not_found', message: 'Account missing' }] };
      }

      const accounts = await ctx.db.accounts.list();
      return { status: 200, body: { data: accounts } };
    },
    successStatus: appRoute.method === 'GET' ? 200 : undefined
  })
});

// routeSpecs is a RouteSpec[] ready to feed into createModule({ routes: routeSpecs })
```

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
npm install
npm run clean          # remove dist/schema artifacts
npm run build          # compiles TypeScript, regenerates schema/*.schema.json
npm run test           # type-checks the Accounts example module
# Release helper (bumps version, pushes tags to trigger release workflow)
npm run release -- patch
```

- The `schema/` folder contains `*-definition.schema.json` files derived from the exported Zod schemas. Commit them with contract changes.
- Ensure CI runs `npm ci`, `npm run clean`, `npm run build`, `npm run test`, and `npm run smoke` before publish.

## License

MIT © Webstir
